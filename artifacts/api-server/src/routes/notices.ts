import { Router, type IRouter } from "express";
import { eq, and, lte, gte } from "drizzle-orm";
import { db, doctorNoticesTable, usersTable, doctorsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

function getDoctorIdFromAuth(auth: string | undefined): number | null {
  return verifyAuthToken(auth)?.userId ?? null;
}

async function getDoctorByUserId(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.doctorId) return null;
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
  return doc ?? null;
}

router.get("/doctors/:id/notices", async (req, res): Promise<void> => {
  const doctorId = parseInt(req.params.id);
  const notices = await db.select().from(doctorNoticesTable)
    .where(and(eq(doctorNoticesTable.doctorId, doctorId), eq(doctorNoticesTable.isActive, true)))
    .orderBy(doctorNoticesTable.createdAt);
  res.json(notices);
});

router.get("/doctor/notices", async (req, res): Promise<void> => {
  const userId = getDoctorIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const notices = await db.select().from(doctorNoticesTable)
    .where(eq(doctorNoticesTable.doctorId, doc.id))
    .orderBy(doctorNoticesTable.createdAt);
  res.json(notices);
});

router.post("/doctor/notices", async (req, res): Promise<void> => {
  const userId = getDoctorIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const { title, message, type = "general", fromDate, toDate, fromTime, toTime } = req.body;
  if (!title || !message) { res.status(400).json({ error: "title and message required" }); return; }
  const [notice] = await db.insert(doctorNoticesTable).values({ doctorId: doc.id, title, message, type, fromDate, toDate, fromTime, toTime }).returning();
  res.status(201).json(notice);
});

router.put("/doctor/notices/:id", async (req, res): Promise<void> => {
  const userId = getDoctorIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const noticeId = parseInt(req.params.id);
  const { title, message, type, fromDate, toDate, fromTime, toTime, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (message !== undefined) updates.message = message;
  if (type !== undefined) updates.type = type;
  if (fromDate !== undefined) updates.fromDate = fromDate;
  if (toDate !== undefined) updates.toDate = toDate;
  if (fromTime !== undefined) updates.fromTime = fromTime;
  if (toTime !== undefined) updates.toTime = toTime;
  if (isActive !== undefined) updates.isActive = isActive;
  const [notice] = await db.update(doctorNoticesTable).set(updates)
    .where(and(eq(doctorNoticesTable.id, noticeId), eq(doctorNoticesTable.doctorId, doc.id))).returning();
  if (!notice) { res.status(404).json({ error: "Notice not found" }); return; }
  res.json(notice);
});

router.delete("/doctor/notices/:id", async (req, res): Promise<void> => {
  const userId = getDoctorIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const noticeId = parseInt(req.params.id);
  const [deleted] = await db.delete(doctorNoticesTable)
    .where(and(eq(doctorNoticesTable.id, noticeId), eq(doctorNoticesTable.doctorId, doc.id))).returning();
  if (!deleted) { res.status(404).json({ error: "Notice not found" }); return; }
  res.status(204).send();
});

export default router;
