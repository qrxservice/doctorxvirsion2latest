import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, appointmentsTable, queueEntriesTable, doctorsTable, usersTable, doctorNoticesTable, appSettingsTable } from "@workspace/db";
import crypto from "crypto";
import { sendEmail, sendSms } from "../lib/messaging";
import { verifyAuthToken } from "../lib/token";
import { notify } from "../lib/notify";
import { resolveCurrencyFromRequest, getDonationAmount } from "../lib/currency";
import { publicLookupLimiter } from "../lib/rate-limit";
import { broadcastQueueUpdate } from "../lib/wsManager";

const router: IRouter = Router();

async function getAuthUser(authHeader: string | undefined) {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user ?? null;
  } catch {
    return null;
  }
}

async function sendAppointmentNotification(appt: typeof appointmentsTable.$inferSelect, doctorName: string, chamberAddress: string | null) {
  const trackingUrl = `${process.env.APP_URL || "https://doctorx.com.bd"}/track?phone=${encodeURIComponent(appt.patientPhone)}`;
  if (appt.patientEmail) {
    const subject = `Appointment Confirmed — Serial #${appt.serialNo}`;
    const body = `Dear ${appt.patientName},\n\nYour appointment has been booked successfully.\n\nDoctor: Dr. ${doctorName}\nDate: ${appt.appointmentDate}\nTime: ${appt.appointmentTime || "As scheduled"}\nSerial No: ${appt.serialNo}\nChamber: ${chamberAddress || "N/A"}\n\nTrack your appointment: ${trackingUrl}\n\nThank you for using DoctorX.`;
    await sendEmail(appt.patientEmail, subject, body);
  }
  await sendSms(
    appt.patientPhone,
    `Appointment confirmed with Dr. ${doctorName} on ${appt.appointmentDate}. Serial: #${appt.serialNo}. Track: ${trackingUrl}`,
  );
}

router.get("/appointments", async (req, res): Promise<void> => {
  const { doctorId, date, status, donationPaid, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum - 1) * limitNum;

  const user = await getAuthUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  // Doctors and assistants are scoped to their own doctor's appointments; admins see all/filtered.
  let scopedDoctorId = doctorId;
  if (user.role === "doctor" || user.role === "assistant") {
    if (!user.doctorId) { res.status(403).json({ error: "No doctor profile linked" }); return; }
    scopedDoctorId = String(user.doctorId);
  } else if (user.role !== "admin") {
    res.status(403).json({ error: "Not authorized" }); return;
  }

  let all = await db.select().from(appointmentsTable);
  if (scopedDoctorId) all = all.filter(a => a.doctorId === parseInt(scopedDoctorId));
  if (date) all = all.filter(a => a.appointmentDate === date);
  if (status) all = all.filter(a => a.status === status);
  if (donationPaid !== undefined) all = all.filter(a => a.donationPaid === (donationPaid === "true"));

  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const enriched = await Promise.all(all.slice(offset, offset + limitNum).map(async (appt) => {
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, appt.doctorId));
    return { ...appt, doctorName: doc?.name ?? null, createdAt: appt.createdAt.toISOString() };
  }));

  res.json({ appointments: enriched, total: all.length, page: pageNum, limit: limitNum });
});

router.post("/appointments", async (req, res): Promise<void> => {
  const { doctorId, patientName, patientPhone, patientEmail, patientAge, patientGender, complaint, appointmentDate, appointmentTime, bp, pulse, temp, weight, height, hb, sugar, spo2, medicalHistory, notes, labReportUrl, prescriptionUploadUrl, bookingSource } = req.body;
  if (!doctorId || !patientName || !patientPhone || !appointmentDate) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }

  // Reject bookings that fall within an active vacation / emergency-unavailable window.
  const activeNotices = await db.select().from(doctorNoticesTable)
    .where(and(eq(doctorNoticesTable.doctorId, parseInt(doctorId)), eq(doctorNoticesTable.isActive, true)));
  const blocker = activeNotices.find((n) => {
    if (n.type !== "vacation" && n.type !== "emergency_unavailable") return false;
    if (n.fromDate && appointmentDate < n.fromDate) return false;
    if (n.toDate && appointmentDate > n.toDate) return false;
    return true;
  });
  if (blocker) {
    let nextAvailableDate: string | null = null;
    if (blocker.toDate) {
      const d = new Date(`${blocker.toDate}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      nextAvailableDate = `${d.getFullYear()}-${m}-${day}`;
    }
    res.status(409).json({ error: "Doctor is unavailable on the selected date", nextAvailableDate });
    return;
  }

  const existing = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.doctorId, parseInt(doctorId)), eq(appointmentsTable.appointmentDate, appointmentDate)));
  const serialNo = existing.length + 1;
  const trackingToken = crypto.randomBytes(8).toString("hex");

  // Donation amount/paid-status is derived server-side from the live
  // app-settings config at booking time — never trust a client-supplied
  // amount. This also freezes the amount (and currency) into history if the
  // admin later changes or disables the donation setting. Currency is
  // resolved from the patient's IP, same auto-detection used everywhere else.
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  const donationActive = settings?.donationEnabled ?? false;
  const { currency: donationCurrency } = resolveCurrencyFromRequest(req);
  const donationAmount = settings ? getDonationAmount(donationCurrency, settings) : null;

  const [appt] = await db.insert(appointmentsTable).values({
    doctorId: parseInt(doctorId), patientName, patientPhone, patientEmail,
    patientAge: patientAge ? parseInt(patientAge) : null,
    patientGender, complaint,
    bp: bp || null, pulse: pulse || null, temp: temp || null,
    weight: weight || null, height: height || null,
    hb: hb || null, sugar: sugar || null, spo2: spo2 || null,
    medicalHistory: medicalHistory || null, notes: notes || null,
    labReportUrl: labReportUrl || null, prescriptionUploadUrl: prescriptionUploadUrl || null,
    bookingSource: bookingSource || "online",
    appointmentDate, appointmentTime, serialNo, status: "pending", trackingToken,
    donationPaid: donationActive,
    donationAmount: donationActive ? donationAmount : null,
    donationCurrency: donationActive ? donationCurrency : null,
    donationPaidAt: donationActive ? new Date() : null,
  }).returning();

  const today = new Date().toISOString().split("T")[0];
  if (appointmentDate === today) {
    const queueExisting = await db.select().from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.doctorId, parseInt(doctorId)), eq(queueEntriesTable.queueDate, today)));
    await db.insert(queueEntriesTable).values({
      doctorId: parseInt(doctorId), appointmentId: appt.id, patientName, patientPhone,
      serialNo: queueExisting.length + 1, status: "waiting", queueDate: today,
    });
  }

  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, parseInt(doctorId)));
  await sendAppointmentNotification(appt, doc?.name ?? "Doctor", doc?.chamberAddress ?? null);

  // In-app notification to the doctor
  if (doc) {
    const [docUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.doctorId, doc.id));
    if (docUser) {
      notify(docUser.id, "appointment", "New Appointment Booked",
        `${patientName} booked an appointment for ${appointmentDate}. Serial #${appt.serialNo}.`, appt.id
      ).catch(() => {});
    }
  }

  res.status(201).json({ ...appt, doctorName: doc?.name ?? null, createdAt: appt.createdAt.toISOString() });
});

router.get("/appointments/track", publicLookupLimiter, async (req, res): Promise<void> => {
  const { phone, doctorId } = req.query as Record<string, string>;
  if (!phone) { res.status(400).json({ error: "Phone required" }); return; }

  let appts = await db.select().from(appointmentsTable).where(eq(appointmentsTable.patientPhone, phone));
  if (doctorId) appts = appts.filter(a => a.doctorId === parseInt(doctorId));

  const result = await Promise.all(appts.map(async (appt) => {
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, appt.doctorId));
    const serving = await db.select().from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.doctorId, appt.doctorId), eq(queueEntriesTable.status, "serving")));
    const waiting = await db.select().from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.doctorId, appt.doctorId), eq(queueEntriesTable.status, "waiting"), eq(queueEntriesTable.queueDate, appt.appointmentDate)));
    const currentSerial = serving[0]?.serialNo ?? null;
    const myQueue = waiting.find(w => w.appointmentId === appt.id);
    const patientsAhead = myQueue ? waiting.filter(w => w.serialNo < myQueue.serialNo).length : 0;
    const breakUntilDate = doc?.breakUntil ? new Date(doc.breakUntil) : null;
    const isOnBreak = doc?.onlineStatus === "busy" && breakUntilDate != null && breakUntilDate > new Date();
    return {
      id: appt.id, serialNo: appt.serialNo, status: appt.status,
      doctorName: doc?.name ?? "Unknown", appointmentDate: appt.appointmentDate,
      currentServingSerial: currentSerial, patientsAhead, waitingCount: waiting.length,
      doctorStatus: doc?.onlineStatus ?? "offline",
      breakUntil: isOnBreak ? breakUntilDate!.toISOString() : null,
    };
  }));

  res.json({ appointments: result });
});

router.get("/appointments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const user = await getAuthUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  if ((user.role === "doctor" || user.role === "assistant") && appt.doctorId !== user.doctorId) {
    res.status(404).json({ error: "Not found" }); return;
  }
  if (user.role !== "doctor" && user.role !== "assistant" && user.role !== "admin") {
    res.status(403).json({ error: "Not authorized" }); return;
  }
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, appt.doctorId));
  res.json({ ...appt, doctorName: doc?.name ?? null, createdAt: appt.createdAt.toISOString() });
});

router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const user = await getAuthUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [target] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  if ((user.role === "doctor" || user.role === "assistant") && target.doctorId !== user.doctorId) {
    res.status(404).json({ error: "Not found" }); return;
  }
  if (user.role !== "doctor" && user.role !== "assistant" && user.role !== "admin") {
    res.status(403).json({ error: "Not authorized" }); return;
  }
  const { status, appointmentDate, appointmentTime, bp, pulse, temp, weight, height, hb, sugar, spo2, medicalHistory, notes, labReportUrl, prescriptionUploadUrl, complaint } = req.body;
  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (appointmentDate !== undefined) updates.appointmentDate = appointmentDate;
  if (appointmentTime !== undefined) updates.appointmentTime = appointmentTime;
  if (bp !== undefined) updates.bp = bp;
  if (pulse !== undefined) updates.pulse = pulse;
  if (temp !== undefined) updates.temp = temp;
  if (weight !== undefined) updates.weight = weight;
  if (height !== undefined) updates.height = height;
  if (hb !== undefined) updates.hb = hb;
  if (sugar !== undefined) updates.sugar = sugar;
  if (spo2 !== undefined) updates.spo2 = spo2;
  if (medicalHistory !== undefined) updates.medicalHistory = medicalHistory;
  if (notes !== undefined) updates.notes = notes;
  if (labReportUrl !== undefined) updates.labReportUrl = labReportUrl;
  if (prescriptionUploadUrl !== undefined) updates.prescriptionUploadUrl = prescriptionUploadUrl;
  if (complaint !== undefined) updates.complaint = complaint;
  const [appt] = await db.update(appointmentsTable).set(updates).where(eq(appointmentsTable.id, id)).returning();
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, appt.doctorId));
  res.json({ ...appt, doctorName: doc?.name ?? null, createdAt: appt.createdAt.toISOString() });
});

router.post("/appointments/:id/add-to-queue", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const user = await getAuthUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  if ((user.role === "doctor" || user.role === "assistant") && appt.doctorId !== user.doctorId) {
    res.status(404).json({ error: "Not found" }); return;
  }
  if (user.role !== "doctor" && user.role !== "assistant" && user.role !== "admin") {
    res.status(403).json({ error: "Not authorized" }); return;
  }
  const today = new Date().toISOString().split("T")[0];
  const existing = await db.select().from(queueEntriesTable)
    .where(and(eq(queueEntriesTable.doctorId, appt.doctorId), eq(queueEntriesTable.queueDate, today)));
  const alreadyIn = existing.find(e => e.appointmentId === id);
  if (alreadyIn) { res.status(409).json({ error: "Already in queue" }); return; }
  const [entry] = await db.insert(queueEntriesTable).values({
    doctorId: appt.doctorId, appointmentId: id, patientName: appt.patientName,
    patientPhone: appt.patientPhone, serialNo: existing.length + 1, status: "waiting", queueDate: today,
  }).returning();
  broadcastQueueUpdate(appt.doctorId, "queue:joined");
  res.status(201).json({ ...entry, createdAt: entry.createdAt.toISOString() });
});

export default router;
