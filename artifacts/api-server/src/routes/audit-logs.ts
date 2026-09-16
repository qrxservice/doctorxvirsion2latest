import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { getActor } from "../lib/admin";

const router: IRouter = Router();

router.get("/admin/audit-logs", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const page = parseInt((req.query.page as string) || "1");
  const limit = 100;
  const entityType = req.query.entityType as string | undefined;
  const action = req.query.action as string | undefined;

  let rows = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt));
  if (entityType) rows = rows.filter(r => r.entityType === entityType);
  if (action) rows = rows.filter(r => r.action === action);
  const paged = rows.slice((page - 1) * limit, page * limit);
  res.json(paged.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

export default router;
