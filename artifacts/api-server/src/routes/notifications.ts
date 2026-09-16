import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getUserIdFromAuth(auth: string | undefined): Promise<number | null> {
  return verifyAuthToken(auth)?.userId ?? null;
}

router.get("/notifications", async (req, res): Promise<void> => {
  const userId = await getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt)).limit(50);
  const unreadCount = notifs.filter(n => !n.isRead).length;
  res.json({ notifications: notifs, unreadCount });
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = await getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const notifId = parseInt(req.params.id);
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, notifId), eq(notificationsTable.userId, userId)));
  res.json({ message: "Marked as read" });
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = await getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, userId));
  res.json({ message: "All marked as read" });
});

export default router;
