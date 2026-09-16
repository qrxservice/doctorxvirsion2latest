/**
 * Assistant-scoped API endpoints.
 * All routes require a valid assistant (or doctor) JWT.
 */
import { Router, type IRouter } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db, usersTable, doctorsTable, auditLogsTable, appointmentsTable, prescriptionsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getAssistantUser(authHeader: string | undefined) {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user || (user.role !== "assistant" && user.role !== "doctor")) return null;
    return user;
  } catch { return null; }
}

/** Return the supervising doctor's current online status. */
router.get("/assistant/doctor-status", async (req, res): Promise<void> => {
  const user = await getAssistantUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doctorId = user.doctorId;
  if (!doctorId) { res.status(400).json({ error: "No doctor linked" }); return; }
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  res.json({ name: doc.name, onlineStatus: doc.onlineStatus ?? "offline" });
});

/** Recent activity log entries for this assistant's doctor domain (last 30). */
router.get("/assistant/activity", async (req, res): Promise<void> => {
  const user = await getAssistantUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doctorId = user.doctorId;
  if (!doctorId) { res.status(400).json({ error: "No doctor linked" }); return; }

  // Get all user IDs in this doctor's domain (doctor user + their assistants)
  const domainUsers = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.doctorId, doctorId));
  const domainUserIds = domainUsers.map(u => u.id);

  if (domainUserIds.length === 0) { res.json([]); return; }

  const logs = await db.select().from(auditLogsTable)
    .where(inArray(auditLogsTable.actorUserId, domainUserIds))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(30);

  res.json(logs.map(l => ({
    ...l,
    actorName: domainUsers.find(u => u.id === l.actorUserId)?.name ?? null,
    createdAt: l.createdAt.toISOString(),
  })));
});

/** Quick stats summary for today's appointments and pending items. */
router.get("/assistant/stats", async (req, res): Promise<void> => {
  const user = await getAssistantUser(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doctorId = user.doctorId;
  if (!doctorId) { res.status(400).json({ error: "No doctor linked" }); return; }

  const today = new Date().toISOString().split("T")[0];

  const [todayAppts, allPrescriptions] = await Promise.all([
    db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.doctorId, doctorId), eq(appointmentsTable.appointmentDate, today))),
    db.select().from(prescriptionsTable).where(eq(prescriptionsTable.doctorId, doctorId)),
  ]);

  const pendingInvestigation = allPrescriptions.filter(p => p.status === "pending_investigation").length;
  const followUpDue = allPrescriptions.filter(p =>
    p.followUpDate && p.followUpDate <= today && p.status === "final"
  ).length;
  const reportsReceivedToday = todayAppts.filter(a => a.labReportUrl && a.labReportUrl.length > 0).length;

  res.json({ pendingInvestigation, followUpDue, reportsReceivedToday });
});

export default router;
