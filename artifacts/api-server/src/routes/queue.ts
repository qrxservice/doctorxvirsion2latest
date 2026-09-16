import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, queueEntriesTable, doctorsTable } from "@workspace/db";
import { broadcastQueueUpdate } from "../lib/wsManager";

const router: IRouter = Router();

router.get("/queue", async (req, res): Promise<void> => {
  const { doctorId, date } = req.query as Record<string, string>;
  if (!doctorId) { res.status(400).json({ error: "doctorId required" }); return; }
  const queueDate = date || new Date().toISOString().split("T")[0];

  const [doc, entries] = await Promise.all([
    db.select().from(doctorsTable).where(eq(doctorsTable.id, parseInt(doctorId))).then(r => r[0]),
    db.select().from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.doctorId, parseInt(doctorId)), eq(queueEntriesTable.queueDate, queueDate))),
  ]);

  const toEntry = (e: typeof entries[0]) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  });

  const waiting = entries.filter(e => e.status === "waiting").sort((a, b) => a.serialNo - b.serialNo);
  const serving = entries.filter(e => e.status === "serving");
  const seen = entries.filter(e => e.status === "seen");
  const skipped = entries.filter(e => e.status === "skipped");

  // Break status
  const breakUntilDate = doc?.breakUntil ? new Date(doc.breakUntil) : null;
  const isOnBreak = doc?.onlineStatus === "busy" && breakUntilDate != null && breakUntilDate > new Date();

  // Stats: first / last patient time + avg consultation time from seen entries
  const sortedByCreated = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const firstPatientTime = sortedByCreated[0]?.createdAt?.toISOString() ?? null;
  const seenSorted = [...seen].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  const lastPatientTime = seenSorted[seenSorted.length - 1]?.updatedAt?.toISOString() ?? null;

  let avgConsultationMs = 0;
  if (seenSorted.length > 1) {
    const times = seenSorted.map(e => e.updatedAt.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    avgConsultationMs = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  } else if (seenSorted.length === 1 && sortedByCreated[0]) {
    avgConsultationMs = seenSorted[0].updatedAt.getTime() - sortedByCreated[0].createdAt.getTime();
  }

  res.json({
    waiting: waiting.map(toEntry),
    serving: serving.map(toEntry),
    seen: seen.map(toEntry),
    skipped: skipped.map(toEntry),
    totalToday: entries.length,
    completed: seen.length,
    doctorStatus: doc?.onlineStatus ?? "offline",
    breakUntil: isOnBreak ? breakUntilDate!.toISOString() : null,
    avgConsultationMs,
    firstPatientTime,
    lastPatientTime,
  });
});

router.get("/queue/display", async (req, res): Promise<void> => {
  const { doctorId } = req.query as Record<string, string>;
  if (!doctorId) { res.status(400).json({ error: "doctorId required" }); return; }
  const today = new Date().toISOString().split("T")[0];

  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, parseInt(doctorId)));
  const entries = await db.select().from(queueEntriesTable)
    .where(and(eq(queueEntriesTable.doctorId, parseInt(doctorId)), eq(queueEntriesTable.queueDate, today)));

  const serving = entries.find(e => e.status === "serving");
  const waiting = entries.filter(e => e.status === "waiting").sort((a, b) => a.serialNo - b.serialNo);

  const breakUntilDate = doc?.breakUntil ? new Date(doc.breakUntil) : null;
  const isOnBreak = doc?.onlineStatus === "busy" && breakUntilDate && breakUntilDate > new Date();

  res.json({
    doctorName: doc?.name ?? "Doctor",
    doctorStatus: doc?.onlineStatus ?? "offline",
    breakUntil: isOnBreak ? breakUntilDate!.toISOString() : null,
    currentSerial: serving?.serialNo ?? null,
    currentPatientName: serving?.patientName ?? null,
    nextPatients: waiting.slice(0, 3).map(e => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
});

router.post("/queue/:id/call-next", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [entry] = await db.select().from(queueEntriesTable).where(eq(queueEntriesTable.id, id));
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(queueEntriesTable)
    .set({ status: "seen" })
    .where(and(eq(queueEntriesTable.doctorId, entry.doctorId), eq(queueEntriesTable.status, "serving")));

  const waiting = await db.select().from(queueEntriesTable)
    .where(and(eq(queueEntriesTable.doctorId, entry.doctorId), eq(queueEntriesTable.status, "waiting")));
  waiting.sort((a, b) => a.serialNo - b.serialNo);
  const next = waiting[0];
  if (!next) { res.status(404).json({ error: "No waiting patients" }); return; }
  const [updated] = await db.update(queueEntriesTable).set({ status: "serving" }).where(eq(queueEntriesTable.id, next.id)).returning();

  broadcastQueueUpdate(entry.doctorId, "queue:called");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/queue/:id/serve", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [entry] = await db.select().from(queueEntriesTable).where(eq(queueEntriesTable.id, id));
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(queueEntriesTable)
    .set({ status: "waiting" })
    .where(and(eq(queueEntriesTable.doctorId, entry.doctorId), eq(queueEntriesTable.status, "serving")));

  const [updated] = await db.update(queueEntriesTable).set({ status: "serving" }).where(eq(queueEntriesTable.id, id)).returning();

  broadcastQueueUpdate(entry.doctorId, "queue:called");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/queue/:id/seen", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [updated] = await db.update(queueEntriesTable).set({ status: "seen" }).where(eq(queueEntriesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  broadcastQueueUpdate(updated.doctorId, "queue:completed");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/queue/:id/skip", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [updated] = await db.update(queueEntriesTable).set({ status: "skipped" }).where(eq(queueEntriesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  broadcastQueueUpdate(updated.doctorId, "queue:skipped");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/queue/:id/recall", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [updated] = await db.update(queueEntriesTable).set({ status: "waiting" }).where(eq(queueEntriesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  broadcastQueueUpdate(updated.doctorId, "queue:updated");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

export default router;
