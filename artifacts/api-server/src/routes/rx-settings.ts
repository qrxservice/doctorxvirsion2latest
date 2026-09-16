import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, doctorRxSettingsTable, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getDoctorId(auth: string | undefined): Promise<number | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user?.doctorId ?? null;
  } catch { return null; }
}

async function ensureSettings(doctorId: number) {
  const [existing] = await db.select().from(doctorRxSettingsTable).where(eq(doctorRxSettingsTable.doctorId, doctorId));
  if (existing) return existing;
  const [created] = await db.insert(doctorRxSettingsTable).values({ doctorId }).returning();
  return created;
}

const EDITABLE_FIELDS = [
  "headerName", "headerDegree", "headerDesignation", "headerBmdc", "hospitalName",
  "headerAddress", "headerPhone", "headerEmail", "signatureText", "signatureImage", "pageSize",
  "marginTop", "marginRight", "marginBottom", "marginLeft", "headerHeight", "footerHeight",
  "showHeader", "showQr", "showSignature", "showFooter", "footerText",
] as const;

router.get("/doctors/me/rx-settings", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const settings = await ensureSettings(doctorId);
  res.json(settings);
});

router.put("/doctors/me/rx-settings", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await ensureSettings(doctorId);

  const updates: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const [settings] = await db.update(doctorRxSettingsTable).set(updates)
    .where(eq(doctorRxSettingsTable.doctorId, doctorId)).returning();
  res.json(settings);
});

export default router;
