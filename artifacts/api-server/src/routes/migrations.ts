import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db, migrationBatchesTable, migrationRecordsTable,
  medicinesTable, appointmentsTable,
} from "@workspace/db";
import { getActor, writeAudit, type Actor } from "../lib/admin";

const router: IRouter = Router();

const SUPPORTED = ["medicines", "appointments", "patients"];

// Importers must be admin (full access) or a doctor/assistant (scoped to own doctorId).
function canImport(actor: Actor): boolean {
  if (actor.role === "admin") return true;
  if ((actor.role === "doctor" || actor.role === "assistant") && actor.doctorId != null) return true;
  return false;
}

/** Collapse spaces, dashes, underscores and lowercase — e.g. "Brand Name" → "brandname" */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/**
 * Flexible column lookup across a parsed spreadsheet row.
 * Tries, in order: exact key, lowercase, UPPERCASE, and finally a normalized
 * comparison that strips spaces/dashes/underscores so "Brand Name",
 * "brand_name", "brandName" and "BRAND NAME" all resolve to the same value.
 */
function str(row: Record<string, unknown>, ...keys: string[]): string | null {
  // Build a normalized → value lookup once per row call (cheap for small rows).
  const normMap = new Map<string, unknown>();
  for (const k of Object.keys(row)) {
    normMap.set(normalizeKey(k), row[k]);
  }
  for (const k of keys) {
    const v =
      row[k] ??
      row[k.toLowerCase()] ??
      row[k.toUpperCase()] ??
      normMap.get(normalizeKey(k));
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

router.get("/admin/migrations", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (!canImport(actor)) { res.status(403).json({ error: "Forbidden" }); return; }
  let rows = await db.select().from(migrationBatchesTable);
  // Non-admins only see their own import batches.
  if (actor.role !== "admin") rows = rows.filter(r => r.createdByUserId === actor.userId);
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/admin/migrations", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (!canImport(actor)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { entityType, fileName, format, rows } = req.body as {
    entityType: string; fileName?: string; format?: string; rows: Record<string, unknown>[];
  };
  if (!SUPPORTED.includes(entityType)) {
    res.status(400).json({ error: `Unsupported entityType. Supported: ${SUPPORTED.join(", ")}` });
    return;
  }
  if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
  // Doctors/assistants are scoped to their own doctorId; admins may set it per-row.
  const scopeDoctorId = actor.role === "admin" ? null : actor.doctorId;

  const [batch] = await db.insert(migrationBatchesTable).values({
    entityType, fileName: fileName ?? null, format: format ?? null,
    totalRows: rows.length, createdByUserId: actor.userId,
  }).returning();

  const errors: string[] = [];
  const duplicates: string[] = [];
  let imported = 0;

  if (entityType === "medicines") {
    const existing = await db.select().from(medicinesTable);
    const seen = new Set(existing.map(m => `${(m.brandName || "").toLowerCase()}|${(m.strength || "").toLowerCase()}`));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const brandName = str(row, "brandName", "brand_name", "brand", "name");
      if (!brandName) { errors.push(`Row ${i + 1}: missing brandName`); continue; }
      const strength = str(row, "strength");
      const key = `${brandName.toLowerCase()}|${(strength || "").toLowerCase()}`;
      if (seen.has(key)) { duplicates.push(`${brandName} ${strength || ""}`.trim()); continue; }
      seen.add(key);
      const [m] = await db.insert(medicinesTable).values({
        brandName,
        genericName: str(row, "genericName", "generic_name", "generic"),
        strength,
        dosageForm: str(row, "dosageForm", "dosage_form", "form"),
        manufacturer: str(row, "manufacturer", "company"),
      }).returning();
      await db.insert(migrationRecordsTable).values({ batchId: batch.id, entityType, entityId: m.id });
      imported++;
    }
  } else if (entityType === "appointments") {
    const existing = await db.select().from(appointmentsTable);
    const seen = new Set(existing.map(a => `${a.patientPhone}|${a.appointmentDate}|${a.doctorId}`));
    const serialMax = new Map<string, number>();
    for (const a of existing) {
      const k = `${a.doctorId}|${a.appointmentDate}`;
      serialMax.set(k, Math.max(serialMax.get(k) ?? 0, a.serialNo));
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const doctorIdRaw = str(row, "doctorId", "doctor_id");
      const patientName = str(row, "patientName", "patient_name", "name");
      const patientPhone = str(row, "patientPhone", "patient_phone", "phone");
      const appointmentDate = str(row, "appointmentDate", "appointment_date", "date");
      if (!patientName || !patientPhone || !appointmentDate || (scopeDoctorId == null && !doctorIdRaw)) {
        errors.push(`Row ${i + 1}: missing doctorId/patientName/patientPhone/appointmentDate`);
        continue;
      }
      const doctorId = scopeDoctorId ?? parseInt(doctorIdRaw!);
      if (Number.isNaN(doctorId)) { errors.push(`Row ${i + 1}: invalid doctorId`); continue; }
      const dupKey = `${patientPhone}|${appointmentDate}|${doctorId}`;
      if (seen.has(dupKey)) { duplicates.push(`${patientName} ${appointmentDate}`); continue; }
      seen.add(dupKey);
      const serialKey = `${doctorId}|${appointmentDate}`;
      const serialRaw = str(row, "serialNo", "serial_no", "serial");
      let serialNo = serialRaw ? parseInt(serialRaw) : NaN;
      if (Number.isNaN(serialNo)) { serialNo = (serialMax.get(serialKey) ?? 0) + 1; }
      serialMax.set(serialKey, Math.max(serialMax.get(serialKey) ?? 0, serialNo));
      const ageRaw = str(row, "patientAge", "patient_age", "age");
      const [appt] = await db.insert(appointmentsTable).values({
        doctorId, patientName, patientPhone, appointmentDate, serialNo,
        patientEmail: str(row, "patientEmail", "patient_email", "email"),
        patientAge: ageRaw ? parseInt(ageRaw) : null,
        patientGender: str(row, "patientGender", "patient_gender", "gender"),
        complaint: str(row, "complaint", "chiefComplaint"),
        appointmentTime: str(row, "appointmentTime", "appointment_time", "time"),
        status: str(row, "status") ?? "completed",
        bookingSource: "migration",
      }).returning();
      await db.insert(migrationRecordsTable).values({ batchId: batch.id, entityType, entityId: appt.id });
      imported++;
    }
  } else if (entityType === "patients") {
    // Patients have no dedicated table — represent each as a lightweight completed
    // appointment so they surface in the doctor's patient list. Dedup by phone+doctor.
    const existing = await db.select().from(appointmentsTable);
    const existingKeys = new Set(existing.map(a => `${a.patientPhone}|${a.doctorId}`));
    const seen = new Set<string>();
    const serialMax = new Map<string, number>();
    const today = new Date().toISOString().slice(0, 10);
    for (const a of existing) {
      const k = `${a.doctorId}|${a.appointmentDate}`;
      serialMax.set(k, Math.max(serialMax.get(k) ?? 0, a.serialNo));
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const doctorIdRaw = str(row, "doctorId", "doctor_id");
      const patientName = str(row, "patientName", "patient_name", "name");
      const patientPhone = str(row, "patientPhone", "patient_phone", "phone");
      if (!patientName || !patientPhone || (scopeDoctorId == null && !doctorIdRaw)) {
        errors.push(`Row ${i + 1}: missing doctorId/patientName/patientPhone`);
        continue;
      }
      const doctorId = scopeDoctorId ?? parseInt(doctorIdRaw!);
      if (Number.isNaN(doctorId)) { errors.push(`Row ${i + 1}: invalid doctorId`); continue; }
      const dupKey = `${patientPhone}|${doctorId}`;
      if (existingKeys.has(dupKey) || seen.has(dupKey)) { duplicates.push(`${patientName} (${patientPhone})`); continue; }
      seen.add(dupKey);
      const appointmentDate = str(row, "appointmentDate", "appointment_date", "date") ?? today;
      const serialKey = `${doctorId}|${appointmentDate}`;
      const serialNo = (serialMax.get(serialKey) ?? 0) + 1;
      serialMax.set(serialKey, serialNo);
      const ageRaw = str(row, "patientAge", "patient_age", "age");
      const [appt] = await db.insert(appointmentsTable).values({
        doctorId, patientName, patientPhone, appointmentDate, serialNo,
        patientEmail: str(row, "patientEmail", "patient_email", "email"),
        patientAge: ageRaw ? parseInt(ageRaw) : null,
        patientGender: str(row, "patientGender", "patient_gender", "gender"),
        status: "completed",
        bookingSource: "migration",
      }).returning();
      await db.insert(migrationRecordsTable).values({ batchId: batch.id, entityType, entityId: appt.id });
      imported++;
    }
  }

  const skipped = rows.length - imported;
  const [updated] = await db.update(migrationBatchesTable)
    .set({ importedRows: imported, skippedRows: skipped })
    .where(eq(migrationBatchesTable.id, batch.id)).returning();
  await writeAudit(actor, "import", "migration", updated.id, `${entityType}: ${imported} imported, ${skipped} skipped`);

  res.status(200).json({
    batchId: updated.id, totalRows: rows.length, importedRows: imported, skippedRows: skipped,
    duplicates, errors,
  });
});

router.post("/admin/migrations/:id/rollback", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (!canImport(actor)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [batch] = await db.select().from(migrationBatchesTable).where(eq(migrationBatchesTable.id, id));
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }
  // Non-admins can only roll back their own batches.
  if (actor.role !== "admin" && batch.createdByUserId !== actor.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (batch.status === "rolled_back") { res.status(400).json({ error: "Already rolled back" }); return; }

  const records = await db.select().from(migrationRecordsTable).where(eq(migrationRecordsTable.batchId, id));
  for (const r of records) {
    if (r.entityType === "medicines") {
      await db.delete(medicinesTable).where(eq(medicinesTable.id, r.entityId));
    } else if (r.entityType === "appointments" || r.entityType === "patients") {
      await db.delete(appointmentsTable).where(eq(appointmentsTable.id, r.entityId));
    }
  }
  await db.delete(migrationRecordsTable).where(eq(migrationRecordsTable.batchId, id));
  const [updated] = await db.update(migrationBatchesTable)
    .set({ status: "rolled_back" }).where(eq(migrationBatchesTable.id, id)).returning();
  await writeAudit(actor, "rollback", "migration", id, `Removed ${records.length} records`);
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

export default router;
