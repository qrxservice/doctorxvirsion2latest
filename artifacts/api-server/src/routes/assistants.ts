import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { writeAudit, type Actor } from "../lib/admin";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();

function actorOf(user: { id: number; role: string; name: string | null; doctorId: number | null }): Actor {
  return { userId: user.id, role: user.role, name: user.name ?? null, doctorId: user.doctorId ?? null };
}

async function getAuthUser(authHeader: string | undefined) {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user ?? null;
  } catch {
    return null;
  }
}

router.get("/assistants", async (req, res): Promise<void> => {
  const doctor = await getAuthUser(req.headers.authorization);
  if (!doctor || doctor.role !== "doctor") {
    res.status(403).json({ error: "Only doctors can manage assistants" });
    return;
  }
  const assistants = await db.select().from(usersTable)
    .where(and(eq(usersTable.role, "assistant"), eq(usersTable.doctorId, doctor.doctorId ?? -1)));
  res.json(assistants.map(a => ({
    id: a.id, name: a.name, email: a.email, doctorId: a.doctorId,
    createdAt: a.createdAt?.toISOString(),
  })));
});

router.post("/assistants", async (req, res): Promise<void> => {
  const doctor = await getAuthUser(req.headers.authorization);
  if (!doctor || doctor.role !== "doctor") {
    res.status(403).json({ error: "Only doctors can create assistants" });
    return;
  }
  if (!doctor.doctorId) {
    res.status(400).json({ error: "Doctor profile not linked" });
    return;
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email and password required" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }
  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [assistant] = await db.insert(usersTable).values({
    name, email, password: await hashPassword(password), role: "assistant", doctorId: doctor.doctorId,
  }).returning();
  await writeAudit(actorOf(doctor), "create", "assistant", assistant.id, assistant.email);
  res.status(201).json({
    id: assistant.id, name: assistant.name, email: assistant.email,
    doctorId: assistant.doctorId, createdAt: assistant.createdAt?.toISOString(),
  });
});

router.delete("/assistants/:id", async (req, res): Promise<void> => {
  const doctor = await getAuthUser(req.headers.authorization);
  if (!doctor || doctor.role !== "doctor") {
    res.status(403).json({ error: "Only doctors can remove assistants" });
    return;
  }
  const id = parseInt(req.params.id);
  const [assistant] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!assistant || assistant.role !== "assistant" || assistant.doctorId !== doctor.doctorId) {
    res.status(404).json({ error: "Assistant not found" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  await writeAudit(actorOf(doctor), "delete", "assistant", id, assistant.email);
  res.json({ success: true });
});

router.patch("/assistants/:id/permissions", async (req, res): Promise<void> => {
  const doctor = await getAuthUser(req.headers.authorization);
  if (!doctor || doctor.role !== "doctor") {
    res.status(403).json({ error: "Only doctors can update assistant permissions" });
    return;
  }
  const id = parseInt(req.params.id);
  const [assistant] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!assistant || assistant.role !== "assistant" || assistant.doctorId !== doctor.doctorId) {
    res.status(404).json({ error: "Assistant not found" });
    return;
  }
  const { canViewTemplates } = req.body;
  const permissions: Record<string, boolean> = {};
  if (typeof canViewTemplates === "boolean") permissions.canViewTemplates = canViewTemplates;
  await db.update(usersTable).set({ permissions: JSON.stringify(permissions) }).where(eq(usersTable.id, id));
  await writeAudit(actorOf(doctor), "update", "assistant", id, `permissions:${JSON.stringify(permissions)}`);
  res.json({ id, permissions });
});

router.post("/assistants/:id/reset-password", async (req, res): Promise<void> => {
  const doctor = await getAuthUser(req.headers.authorization);
  if (!doctor || doctor.role !== "doctor") {
    res.status(403).json({ error: "Only doctors can reset assistant passwords" });
    return;
  }
  const id = parseInt(req.params.id);
  const { newPassword } = req.body;
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [assistant] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!assistant || assistant.role !== "assistant" || assistant.doctorId !== doctor.doctorId) {
    res.status(404).json({ error: "Assistant not found" });
    return;
  }
  await db.update(usersTable).set({ password: await hashPassword(newPassword) }).where(eq(usersTable.id, id));
  await writeAudit(actorOf(doctor), "reset-password", "assistant", id, assistant.email);
  res.json({ message: "Assistant password has been reset." });
});

export default router;
