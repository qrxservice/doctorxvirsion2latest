import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, doctorAvailabilityTable, usersTable, doctorsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getDoctorFromAuth(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) return null;
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
    return doc ?? null;
  } catch { return null; }
}

router.get("/doctors/:id/availability", async (req, res): Promise<void> => {
  const doctorId = parseInt(req.params.id);
  const slots = await db.select().from(doctorAvailabilityTable).where(eq(doctorAvailabilityTable.doctorId, doctorId));
  res.json(slots);
});

router.get("/doctor/availability", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const slots = await db.select().from(doctorAvailabilityTable).where(eq(doctorAvailabilityTable.doctorId, doc.id));
  res.json(slots);
});

router.post("/doctor/availability", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { dayOfWeek, startTime, endTime, breakStart, breakEnd, maxAppointments, isAvailable } = req.body;
  if (dayOfWeek === undefined || !startTime || !endTime) { res.status(400).json({ error: "dayOfWeek, startTime, endTime required" }); return; }
  const existing = await db.select().from(doctorAvailabilityTable).where(and(eq(doctorAvailabilityTable.doctorId, doc.id), eq(doctorAvailabilityTable.dayOfWeek, dayOfWeek)));
  if (existing.length > 0) {
    const [updated] = await db.update(doctorAvailabilityTable).set({ startTime, endTime, breakStart, breakEnd, maxAppointments, isAvailable }).where(and(eq(doctorAvailabilityTable.doctorId, doc.id), eq(doctorAvailabilityTable.dayOfWeek, dayOfWeek))).returning();
    res.json(updated);
  } else {
    const [slot] = await db.insert(doctorAvailabilityTable).values({ doctorId: doc.id, dayOfWeek, startTime, endTime, breakStart, breakEnd, maxAppointments, isAvailable: isAvailable ?? true }).returning();
    res.status(201).json(slot);
  }
});

router.delete("/doctor/availability/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(doctorAvailabilityTable).where(eq(doctorAvailabilityTable.id, id));
  res.status(204).send();
});

export default router;
