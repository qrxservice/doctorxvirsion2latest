import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emergencyContactsTable, emergencyContactReportsTable, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getRole(auth: string | undefined): Promise<string | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user?.role ?? null;
  } catch { return null; }
}

const WRITABLE_FIELDS = [
  "category", "name", "mobileNumber", "driverName", "vehicleNumber",
  "country", "division", "district", "upazila", "area", "notes",
  "availabilityStatus", "isVerified", "isPriority", "isActive",
] as const;

// ---- ADMIN ----

router.get("/admin/emergency-contacts", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const contacts = await db.select().from(emergencyContactsTable).orderBy(emergencyContactsTable.createdAt);
  res.json(contacts);
});

router.post("/admin/emergency-contacts", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const { category, name, mobileNumber } = req.body;
  if (!category || !name || !mobileNumber) {
    res.status(400).json({ error: "category, name and mobileNumber required" }); return;
  }
  const values: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) if (req.body[f] !== undefined) values[f] = req.body[f];
  const [contact] = await db.insert(emergencyContactsTable).values(values as never).returning();
  res.status(201).json(contact);
});

router.patch("/admin/emergency-contacts/:id", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) if (req.body[f] !== undefined) updates[f] = req.body[f];
  const [contact] = await db.update(emergencyContactsTable).set(updates).where(eq(emergencyContactsTable.id, id)).returning();
  if (!contact) { res.status(404).json({ error: "Not found" }); return; }
  res.json(contact);
});

router.delete("/admin/emergency-contacts/:id", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(emergencyContactsTable).where(eq(emergencyContactsTable.id, id));
  res.json({ ok: true });
});

router.post("/admin/emergency-contacts/:id/verify", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(emergencyContactsTable).where(eq(emergencyContactsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [contact] = await db.update(emergencyContactsTable)
    .set({ isVerified: !existing.isVerified }).where(eq(emergencyContactsTable.id, id)).returning();
  res.json(contact);
});

router.get("/admin/emergency-contacts/:id/reports", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const reports = await db.select().from(emergencyContactReportsTable).where(eq(emergencyContactReportsTable.contactId, id));
  res.json(reports);
});

// ---- PUBLIC ----

router.get("/emergency-contacts", async (req, res): Promise<void> => {
  const { category, country, division, district, upazila, area } = req.query as Record<string, string>;
  let contacts = await db.select().from(emergencyContactsTable).where(eq(emergencyContactsTable.isActive, true));

  if (category && category !== "all") contacts = contacts.filter(c => c.category === category);
  if (country && country !== "all") contacts = contacts.filter(c => c.country === country);
  if (division && division !== "all") contacts = contacts.filter(c => c.division === division);
  if (district && district !== "all") contacts = contacts.filter(c => c.district === district);
  if (upazila && upazila !== "all") contacts = contacts.filter(c => c.upazila === upazila);
  if (area) {
    const q = area.toLowerCase();
    contacts = contacts.filter(c => (c.area ?? "").toLowerCase().includes(q));
  }

  // Priority contacts first, then verified, then available, then alphabetical.
  contacts.sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    const aAvail = a.availabilityStatus === "available";
    const bAvail = b.availabilityStatus === "available";
    if (aAvail !== bAvail) return aAvail ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json(contacts);
});

router.post("/emergency-contacts/:id/report", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(emergencyContactsTable).where(eq(emergencyContactsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(emergencyContactReportsTable).values({ contactId: id, reason: req.body?.reason || null });
  await db.update(emergencyContactsTable)
    .set({ reportCount: existing.reportCount + 1 }).where(eq(emergencyContactsTable.id, id));
  res.json({ ok: true });
});

export default router;
