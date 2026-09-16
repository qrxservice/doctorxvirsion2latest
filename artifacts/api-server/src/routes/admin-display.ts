/**
 * Admin-only endpoints for monitoring live queue display connections.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, doctorsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { getActiveDisplayConnections } from "../lib/socketManager";

const router: IRouter = Router();

async function requireAdmin(auth: string | undefined): Promise<boolean> {
  const claims = verifyAuthToken(auth);
  if (!claims) return false;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  return user?.role === "admin";
}

router.get("/admin/display-connections", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req.headers.authorization))) {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const connections = getActiveDisplayConnections();

  // Enrich with doctor names and chamber info
  const enriched = await Promise.all(
    connections.map(async (c) => {
      const [doc] = await db
        .select({ name: doctorsTable.name, chamberAddress: doctorsTable.chamberAddress, onlineStatus: doctorsTable.onlineStatus })
        .from(doctorsTable)
        .where(eq(doctorsTable.id, c.doctorId));
      return {
        ...c,
        doctorName: doc?.name ?? "Unknown",
        chamberAddress: doc?.chamberAddress ?? null,
        doctorStatus: doc?.onlineStatus ?? "offline",
      };
    }),
  );

  res.json({
    connections: enriched,
    totalDisplays: enriched.reduce((s, c) => s + c.connections, 0),
    activeDoctors: enriched.length,
  });
});

export default router;
