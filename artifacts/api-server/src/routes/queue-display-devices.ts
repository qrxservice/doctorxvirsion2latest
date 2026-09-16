import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, queueDisplayDevicesTable, usersTable, doctorsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

function getUserIdFromAuth(auth: string | undefined): number | null {
  return verifyAuthToken(auth)?.userId ?? null;
}

async function getDoctorByUserId(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.doctorId) return null;
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
  return doc ?? null;
}

const ALLOWED_TYPES = ["tv", "monitor", "mobile", "tablet", "custom"];
const ALLOWED_ORIENTATION = ["landscape", "portrait"];
const ALLOWED_THEMES = ["dark", "light", "teal"];
const ALLOWED_LANGUAGES = ["en", "bn"];

function sanitizeBody(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) out.name = String(body.name);
  if (body.displayType !== undefined && ALLOWED_TYPES.includes(String(body.displayType))) out.displayType = String(body.displayType);
  if (body.orientation !== undefined && ALLOWED_ORIENTATION.includes(String(body.orientation))) out.orientation = String(body.orientation);
  const dim = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(10000, Math.max(1, n))) : null; };
  const pct = (v: unknown, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(400, Math.max(25, n))) : def; };
  if (body.width !== undefined) out.width = body.width === null ? null : dim(body.width);
  if (body.height !== undefined) out.height = body.height === null ? null : dim(body.height);
  if (body.fontSize !== undefined) out.fontSize = pct(body.fontSize, 100);
  if (body.layoutSize !== undefined) out.layoutSize = pct(body.layoutSize, 100);
  if (body.fullscreen !== undefined) out.fullscreen = Boolean(body.fullscreen);
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  // Display content settings
  if (body.showPatientName !== undefined) out.showPatientName = Boolean(body.showPatientName);
  if (body.showDoctorName !== undefined) out.showDoctorName = Boolean(body.showDoctorName);
  if (body.voiceEnabled !== undefined) out.voiceEnabled = Boolean(body.voiceEnabled);
  if (body.voiceLanguage !== undefined && ALLOWED_LANGUAGES.includes(String(body.voiceLanguage))) out.voiceLanguage = String(body.voiceLanguage);
  if (body.theme !== undefined && ALLOWED_THEMES.includes(String(body.theme))) out.theme = String(body.theme);
  return out;
}

// Public: fetch a single device's display settings (TV/kiosk has no auth)
router.get("/queue-display-devices/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [device] = await db.select().from(queueDisplayDevicesTable).where(eq(queueDisplayDevicesTable.id, id));
  if (!device) { res.status(404).json({ error: "Device not found" }); return; }
  res.json(device);
});

router.get("/doctor/queue-display-devices", async (req, res): Promise<void> => {
  const userId = getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const devices = await db.select().from(queueDisplayDevicesTable)
    .where(eq(queueDisplayDevicesTable.doctorId, doc.id))
    .orderBy(queueDisplayDevicesTable.createdAt);
  res.json(devices);
});

router.post("/doctor/queue-display-devices", async (req, res): Promise<void> => {
  const userId = getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const fields = sanitizeBody(req.body);
  if (!fields.name) { res.status(400).json({ error: "name required" }); return; }
  const [device] = await db.insert(queueDisplayDevicesTable)
    .values({ doctorId: doc.id, ...fields } as typeof queueDisplayDevicesTable.$inferInsert)
    .returning();
  res.status(201).json(device);
});

router.put("/queue-display-devices/:id", async (req, res): Promise<void> => {
  const userId = getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const deviceId = parseInt(req.params.id);
  const updates = sanitizeBody(req.body);
  const [device] = await db.update(queueDisplayDevicesTable).set(updates)
    .where(and(eq(queueDisplayDevicesTable.id, deviceId), eq(queueDisplayDevicesTable.doctorId, doc.id))).returning();
  if (!device) { res.status(404).json({ error: "Device not found" }); return; }
  res.json(device);
});

router.delete("/queue-display-devices/:id", async (req, res): Promise<void> => {
  const userId = getUserIdFromAuth(req.headers.authorization);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const doc = await getDoctorByUserId(userId);
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  const deviceId = parseInt(req.params.id);
  const [deleted] = await db.delete(queueDisplayDevicesTable)
    .where(and(eq(queueDisplayDevicesTable.id, deviceId), eq(queueDisplayDevicesTable.doctorId, doc.id))).returning();
  if (!deleted) { res.status(404).json({ error: "Device not found" }); return; }
  res.status(204).send();
});

export default router;
