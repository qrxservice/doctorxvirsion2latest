import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, prescriptionsTable, prescriptionItemsTable, doctorsTable, usersTable, appointmentsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";
import { verifyAuthToken } from "../lib/token";
import { publicLookupLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

function makeReferenceNo(id: number, createdAt: Date): string {
  return `RX-${createdAt.getFullYear()}-${String(id).padStart(6, "0")}`;
}

// Resolve the doctor profile id from the signed token.
// Assistants share their doctor's id (users.doctorId), so they are scoped too.
async function getDoctorId(auth: string | undefined): Promise<number | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user?.doctorId ?? null;
  } catch { return null; }
}

router.get("/prescriptions", async (req, res): Promise<void> => {
  // List returns full prescription payloads (patient PHI) — scope to the caller's
  // own doctor id (assistants share it). Any ?doctorId query is ignored.
  const authDoctorId = await getDoctorId(req.headers.authorization);
  if (!authDoctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { patientPhone, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum - 1) * limitNum;

  let all = await db.select().from(prescriptionsTable);
  all = all.filter(p => p.doctorId === authDoctorId);
  if (patientPhone) all = all.filter(p => p.patientPhone === patientPhone);
  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const paged = all.slice(offset, offset + limitNum);
  const enriched = await Promise.all(paged.map(async (p) => {
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, p.doctorId));
    const items = await db.select().from(prescriptionItemsTable).where(eq(prescriptionItemsTable.prescriptionId, p.id));
    return { ...p, doctorName: doc?.name ?? null, items, createdAt: p.createdAt.toISOString() };
  }));

  res.json(enriched);
});

router.post("/prescriptions", async (req, res): Promise<void> => {
  // Prescriptions contain patient PHI: the author is always the authenticated
  // doctor (assistants share their doctor's id). The body doctorId is ignored.
  const authDoctorId = await getDoctorId(req.headers.authorization);
  if (!authDoctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { appointmentId, patientName, patientPhone, patientAge, patientGender, diagnosis, notes, items, status } = req.body;
  if (!patientName) { res.status(400).json({ error: "Required fields missing" }); return; }

  const { patientWeight, patientHeight, chiefComplaint, vitals, examination, investigations, advice, followUpDate } = req.body;
  const resolvedStatus = status === "draft" ? "draft" : status === "pending_investigation" ? "pending_investigation" : "final";
  const [presc] = await db.insert(prescriptionsTable).values({
    doctorId: authDoctorId, appointmentId: appointmentId ? parseInt(appointmentId) : null,
    status: resolvedStatus,
    patientName, patientPhone, patientAge: patientAge ? parseInt(patientAge) : null,
    patientGender, patientWeight: patientWeight ?? null, patientHeight: patientHeight ?? null,
    chiefComplaint: chiefComplaint ?? null, vitals: vitals ?? null, examination: examination ?? null,
    diagnosis, investigations: investigations ?? null, advice: advice ?? null,
    followUpDate: followUpDate ?? null, notes,
  }).returning();

  let finalPresc = presc;
  if (resolvedStatus === "final") {
    const referenceNo = makeReferenceNo(presc.id, presc.createdAt);
    [finalPresc] = await db.update(prescriptionsTable).set({ referenceNo })
      .where(eq(prescriptionsTable.id, presc.id)).returning();
  }

  const insertedItems = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      const [inserted] = await db.insert(prescriptionItemsTable).values({
        prescriptionId: presc.id, medicineId: item.medicineId ?? null,
        medicineName: item.medicineName, genericName: item.genericName ?? null,
        strength: item.strength ?? null, dosageForm: item.dosageForm ?? null,
        dose: item.dose ?? null, duration: item.duration ?? null,
        mealTiming: item.mealTiming ?? null, instruction: item.instruction ?? null,
      }).returning();
      insertedItems.push(inserted);
    }
  }

  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, authDoctorId));
  const actor = await getActor(req.headers.authorization);
  await writeAudit(actor, "create", "prescription", finalPresc.id, `${patientName} (${resolvedStatus})`);
  res.status(201).json({ ...finalPresc, doctorName: doc?.name ?? null, items: insertedItems, createdAt: finalPresc.createdAt.toISOString() });
});

// Public verification by reference number — must precede /prescriptions/:id
router.get("/prescriptions/verify/:ref", publicLookupLimiter, async (req, res): Promise<void> => {
  const ref = Array.isArray(req.params.ref) ? req.params.ref[0] : req.params.ref;
  const [presc] = await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.referenceNo, ref));
  if (!presc || presc.status !== "final") {
    res.json({ valid: false, referenceNo: ref, doctorName: null, patientName: null, status: null, createdAt: null });
    return;
  }
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, presc.doctorId));
  res.json({
    valid: true,
    referenceNo: presc.referenceNo,
    doctorName: doc?.name ?? null,
    patientName: presc.patientName,
    status: presc.status,
    createdAt: presc.createdAt.toISOString(),
  });
});

// ---- DOCTOR PRESCRIPTION STATS (pending investigation + follow-up due) ----
router.get("/prescriptions/stats", async (req, res): Promise<void> => {
  const authDoctorId = await getDoctorId(req.headers.authorization);
  if (!authDoctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const today = new Date().toISOString().split("T")[0];
  const all = (await db.select().from(prescriptionsTable)).filter(p => p.doctorId === authDoctorId);
  const pendingInvestigation = all.filter(p => p.status === "pending_investigation").length;
  const followUpDue = all.filter(p => p.followUpDate && p.followUpDate <= today && p.status !== "draft").length;
  res.json({ pendingInvestigation, followUpDue });
});


router.get("/prescriptions/:id", async (req, res): Promise<void> => {
  // Full prescription payload contains patient PHI — scope reads to the owning
  // doctor (assistants share the doctor's id). Public access uses /verify/:ref.
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [presc] = await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.id, id));
  if (!presc) { res.status(404).json({ error: "Not found" }); return; }
  if (presc.doctorId !== doctorId) { res.status(403).json({ error: "Forbidden" }); return; }
  const items = await db.select().from(prescriptionItemsTable).where(eq(prescriptionItemsTable.prescriptionId, id));
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, presc.doctorId));
  res.json({ ...presc, doctorName: doc?.name ?? null, items, createdAt: presc.createdAt.toISOString() });
});

router.put("/prescriptions/:id", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [existing] = await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.doctorId !== doctorId) { res.status(403).json({ error: "Forbidden" }); return; }

  const { appointmentId, patientName, patientPhone, patientAge, patientGender, diagnosis, notes, items, status } = req.body;
  const { patientWeight, patientHeight, chiefComplaint, vitals, examination, investigations, advice, followUpDate } = req.body;
  const resolvedStatus = status === "draft" ? "draft" : status === "pending_investigation" ? "pending_investigation" : "final";

  const updates: Record<string, unknown> = {
    appointmentId: appointmentId ? parseInt(appointmentId) : existing.appointmentId,
    status: resolvedStatus,
    patientName: patientName ?? existing.patientName,
    patientPhone: patientPhone ?? null,
    patientAge: patientAge ? parseInt(patientAge) : null,
    patientGender: patientGender ?? null,
    patientWeight: patientWeight ?? null, patientHeight: patientHeight ?? null,
    chiefComplaint: chiefComplaint ?? null, vitals: vitals ?? null, examination: examination ?? null,
    diagnosis: diagnosis ?? null, investigations: investigations ?? null, advice: advice ?? null,
    followUpDate: followUpDate ?? null, notes: notes ?? null,
  };
  // Assign a reference number when finalizing for the first time
  if (resolvedStatus === "final" && !existing.referenceNo) {
    updates.referenceNo = makeReferenceNo(existing.id, existing.createdAt);
  }

  const [presc] = await db.update(prescriptionsTable).set(updates).where(eq(prescriptionsTable.id, id)).returning();

  await db.delete(prescriptionItemsTable).where(eq(prescriptionItemsTable.prescriptionId, id));
  const insertedItems = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      const [inserted] = await db.insert(prescriptionItemsTable).values({
        prescriptionId: id, medicineId: item.medicineId ?? null,
        medicineName: item.medicineName, genericName: item.genericName ?? null,
        strength: item.strength ?? null, dosageForm: item.dosageForm ?? null,
        dose: item.dose ?? null, duration: item.duration ?? null,
        mealTiming: item.mealTiming ?? null, instruction: item.instruction ?? null,
      }).returning();
      insertedItems.push(inserted);
    }
  }

  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, presc.doctorId));
  const actor = await getActor(req.headers.authorization);
  await writeAudit(actor, "update", "prescription", id, `${presc.patientName} (${resolvedStatus})`);
  res.json({ ...presc, doctorName: doc?.name ?? null, items: insertedItems, createdAt: presc.createdAt.toISOString() });
});

// ---- ADMIN PRESCRIPTION REPOSITORY (admin-only, searches across all doctors) ----
router.get("/admin/prescriptions", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { doctorId, departmentId, countryId, locationId, patientName, patientPhone, referenceNo, dateFrom, dateTo, page = "1", limit = "20" } =
    req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 200);

  const doctors = await db.select().from(doctorsTable);
  const docById = new Map(doctors.map(d => [d.id, d]));

  let all = await db.select().from(prescriptionsTable);
  if (doctorId) all = all.filter(p => p.doctorId === parseInt(doctorId));
  if (departmentId) all = all.filter(p => docById.get(p.doctorId)?.departmentId === parseInt(departmentId));
  if (countryId) all = all.filter(p => docById.get(p.doctorId)?.countryId === parseInt(countryId));
  if (locationId) all = all.filter(p => docById.get(p.doctorId)?.locationId === parseInt(locationId));
  if (patientName) all = all.filter(p => (p.patientName || "").toLowerCase().includes(patientName.toLowerCase()));
  if (patientPhone) all = all.filter(p => (p.patientPhone || "").includes(patientPhone));
  if (referenceNo) all = all.filter(p => (p.referenceNo || "").toLowerCase().includes(referenceNo.toLowerCase()));
  if (dateFrom) all = all.filter(p => p.createdAt.toISOString().slice(0, 10) >= dateFrom);
  if (dateTo) all = all.filter(p => p.createdAt.toISOString().slice(0, 10) <= dateTo);
  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const total = all.length;
  const paged = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  const prescriptions = await Promise.all(paged.map(async (p) => {
    const items = await db.select().from(prescriptionItemsTable).where(eq(prescriptionItemsTable.prescriptionId, p.id));
    return { ...p, doctorName: docById.get(p.doctorId)?.name ?? null, items, createdAt: p.createdAt.toISOString() };
  }));
  res.json({ total, prescriptions });
});

// ---- PATIENT TIMELINE (admin sees all; doctor/assistant scoped to own patients) ----
router.get("/admin/patient-timeline", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (!actor.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!["admin", "doctor", "assistant"].includes(actor.role ?? "")) { res.status(403).json({ error: "Forbidden" }); return; }
  const phone = (req.query.phone as string | undefined)?.trim();
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const scopeDoctorId = actor.role === "admin" ? null : actor.doctorId;
  if (actor.role !== "admin" && scopeDoctorId == null) { res.status(403).json({ error: "Forbidden" }); return; }

  const doctors = await db.select().from(doctorsTable);
  const docById = new Map(doctors.map(d => [d.id, d]));

  let appts = (await db.select().from(appointmentsTable)).filter(a => a.patientPhone === phone);
  let prescs = (await db.select().from(prescriptionsTable)).filter(p => p.patientPhone === phone);
  if (scopeDoctorId !== null) {
    appts = appts.filter(a => a.doctorId === scopeDoctorId);
    prescs = prescs.filter(p => p.doctorId === scopeDoctorId);
  }

  let patientName: string | null = null;
  const events = [
    ...appts.map(a => {
      patientName ??= a.patientName;
      return {
        id: a.id, type: "appointment", date: a.createdAt.toISOString(),
        title: `Appointment — Serial #${a.serialNo}`, doctorName: docById.get(a.doctorId)?.name ?? null,
        summary: a.complaint ?? null, bp: a.bp ?? null, pulse: a.pulse ?? null, temp: a.temp ?? null,
        weight: a.weight ?? null, height: a.height ?? null, diagnosis: null,
        labReportUrl: a.labReportUrl ?? null, prescriptionUploadUrl: a.prescriptionUploadUrl ?? null,
        referenceNo: null, notes: a.notes ?? null,
      };
    }),
    ...prescs.map(p => {
      patientName ??= p.patientName;
      return {
        id: p.id, type: "prescription", date: p.createdAt.toISOString(),
        title: p.referenceNo ?? "Prescription", doctorName: docById.get(p.doctorId)?.name ?? null,
        summary: p.chiefComplaint ?? null, bp: null, pulse: null, temp: null,
        weight: p.patientWeight ?? null, height: p.patientHeight ?? null, diagnosis: p.diagnosis ?? null,
        labReportUrl: null, prescriptionUploadUrl: null, referenceNo: p.referenceNo ?? null, notes: p.notes ?? null,
      };
    }),
  ];
  events.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ patientPhone: phone, patientName, events });
});

export default router;
