import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, advertisementsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(a: typeof advertisementsTable.$inferSelect) {
  return {
    ...a,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    startDate: a.startDate ? a.startDate.toISOString() : null,
    endDate: a.endDate ? a.endDate.toISOString() : null,
  };
}

function inWindow(a: typeof advertisementsTable.$inferSelect): boolean {
  const now = Date.now();
  if (a.startDate && a.startDate.getTime() > now) return false;
  if (a.endDate && a.endDate.getTime() < now) return false;
  return true;
}

router.get("/advertisements", async (req, res): Promise<void> => {
  const location = req.query.location as string | undefined;
  let ads = await db.select().from(advertisementsTable).where(eq(advertisementsTable.isActive, true));
  ads = ads.filter(inWindow);
  if (location) ads = ads.filter(a => a.location === location);
  ads.sort((a, b) => b.priority - a.priority);
  res.json(ads.map(serialize));
});

router.get("/admin/advertisements", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const ads = await db.select().from(advertisementsTable).orderBy(desc(advertisementsTable.priority));
  res.json(ads.map(serialize));
});

router.post("/admin/advertisements", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const {
    title, imageUrl, linkUrl, location,
    customWidth, customHeight, desktopWidth, desktopHeight, mobileWidth, mobileHeight,
    targetCountries, targetDivisions,
    priority, startDate, endDate, isActive = true,
  } = req.body;
  if (!title || !imageUrl) { res.status(400).json({ error: "Title and image required" }); return; }
  const [ad] = await db.insert(advertisementsTable).values({
    title, imageUrl, linkUrl: linkUrl ?? null,
    location: location ?? "homepage_middle",
    customWidth: customWidth ?? null, customHeight: customHeight ?? null,
    desktopWidth: desktopWidth ?? null, desktopHeight: desktopHeight ?? null,
    mobileWidth: mobileWidth ?? null, mobileHeight: mobileHeight ?? null,
    targetCountries: targetCountries ?? null, targetDivisions: targetDivisions ?? null,
    priority: typeof priority === "number" ? priority : 0,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    isActive,
  }).returning();
  await writeAudit(actor, "create", "advertisement", ad.id, title);
  res.status(201).json(serialize(ad));
});

router.patch("/admin/advertisements/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const {
    title, imageUrl, linkUrl, location,
    customWidth, customHeight, desktopWidth, desktopHeight, mobileWidth, mobileHeight,
    targetCountries, targetDivisions,
    priority, startDate, endDate, isActive,
  } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;
  if (linkUrl !== undefined) updates.linkUrl = linkUrl;
  if (location !== undefined) updates.location = location;
  if (customWidth !== undefined) updates.customWidth = customWidth;
  if (customHeight !== undefined) updates.customHeight = customHeight;
  if (desktopWidth !== undefined) updates.desktopWidth = desktopWidth;
  if (desktopHeight !== undefined) updates.desktopHeight = desktopHeight;
  if (mobileWidth !== undefined) updates.mobileWidth = mobileWidth;
  if (mobileHeight !== undefined) updates.mobileHeight = mobileHeight;
  if (targetCountries !== undefined) updates.targetCountries = targetCountries;
  if (targetDivisions !== undefined) updates.targetDivisions = targetDivisions;
  if (priority !== undefined) updates.priority = priority;
  if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
  if (isActive !== undefined) updates.isActive = isActive;
  const [ad] = await db.update(advertisementsTable).set(updates).where(eq(advertisementsTable.id, id)).returning();
  if (!ad) { res.status(404).json({ error: "Not found" }); return; }
  await writeAudit(actor, "update", "advertisement", id);
  res.json(serialize(ad));
});

// Public analytics tracking — no auth required.
router.post("/advertisements/:id/track", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const event = req.body.event as string;
  if (event !== "impression" && event !== "click") {
    res.status(400).json({ error: "event must be 'impression' or 'click'" }); return;
  }
  if (event === "impression") {
    await db.update(advertisementsTable)
      .set({ impressions: sql`impressions + 1` })
      .where(eq(advertisementsTable.id, id));
  } else {
    await db.update(advertisementsTable)
      .set({ clicks: sql`clicks + 1` })
      .where(eq(advertisementsTable.id, id));
  }
  res.sendStatus(204);
});

// Admin — reset analytics for an ad.
router.post("/admin/advertisements/:id/reset-analytics", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [ad] = await db.update(advertisementsTable)
    .set({ impressions: 0, clicks: 0 })
    .where(eq(advertisementsTable.id, id))
    .returning();
  if (!ad) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(ad));
});

router.delete("/admin/advertisements/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(advertisementsTable).where(eq(advertisementsTable.id, id));
  await writeAudit(actor, "delete", "advertisement", id);
  res.sendStatus(204);
});

export default router;
