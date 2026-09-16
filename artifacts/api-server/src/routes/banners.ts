import { Router, type IRouter } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db, bannersTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(b: typeof bannersTable.$inferSelect) {
  return {
    ...b,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    startDate: b.startDate ? b.startDate.toISOString() : null,
    endDate: b.endDate ? b.endDate.toISOString() : null,
  };
}

router.get("/banners", async (req, res): Promise<void> => {
  const position = req.query.position as string | undefined;
  const wantAll = req.query.all === "true";

  let rows = await db.select().from(bannersTable).orderBy(asc(bannersTable.displayOrder));

  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  } else {
    rows = rows.filter(b => b.isActive);
    const now = Date.now();
    rows = rows.filter(b => {
      if (b.startDate && b.startDate.getTime() > now) return false;
      if (b.endDate && b.endDate.getTime() < now) return false;
      return true;
    });
    rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }
  if (position) rows = rows.filter(b => b.position === position);
  res.json(rows.map(serialize));
});

router.post("/banners", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const {
    title, imageUrl, linkUrl, description, position, size,
    customWidth, customHeight, desktopWidth, desktopHeight, mobileWidth, mobileHeight,
    targetCountries, targetDivisions,
    displayOrder, priority, startDate, endDate, isActive = true,
  } = req.body;
  if (!title) { res.status(400).json({ error: "Title required" }); return; }
  const [banner] = await db.insert(bannersTable).values({
    title, imageUrl, linkUrl, description: description ?? null,
    position: position ?? "homepage_top", size: size ?? "medium",
    customWidth: customWidth ?? null, customHeight: customHeight ?? null,
    desktopWidth: desktopWidth ?? null, desktopHeight: desktopHeight ?? null,
    mobileWidth: mobileWidth ?? null, mobileHeight: mobileHeight ?? null,
    targetCountries: targetCountries ?? null, targetDivisions: targetDivisions ?? null,
    displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
    priority: typeof priority === "number" ? priority : 0,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    isActive,
  }).returning();
  await writeAudit(actor, "create", "banner", banner.id, title);
  res.status(201).json(serialize(banner));
});

router.patch("/banners/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const {
    title, imageUrl, linkUrl, description, position, size,
    customWidth, customHeight, desktopWidth, desktopHeight, mobileWidth, mobileHeight,
    targetCountries, targetDivisions,
    displayOrder, priority, startDate, endDate, isActive,
  } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;
  if (linkUrl !== undefined) updates.linkUrl = linkUrl;
  if (description !== undefined) updates.description = description;
  if (position !== undefined) updates.position = position;
  if (size !== undefined) updates.size = size;
  if (customWidth !== undefined) updates.customWidth = customWidth;
  if (customHeight !== undefined) updates.customHeight = customHeight;
  if (desktopWidth !== undefined) updates.desktopWidth = desktopWidth;
  if (desktopHeight !== undefined) updates.desktopHeight = desktopHeight;
  if (mobileWidth !== undefined) updates.mobileWidth = mobileWidth;
  if (mobileHeight !== undefined) updates.mobileHeight = mobileHeight;
  if (targetCountries !== undefined) updates.targetCountries = targetCountries;
  if (targetDivisions !== undefined) updates.targetDivisions = targetDivisions;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (priority !== undefined) updates.priority = priority;
  if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
  if (isActive !== undefined) updates.isActive = isActive;
  const [banner] = await db.update(bannersTable).set(updates).where(eq(bannersTable.id, id)).returning();
  if (!banner) { res.status(404).json({ error: "Not found" }); return; }
  await writeAudit(actor, "update", "banner", id);
  res.json(serialize(banner));
});

// Public analytics tracking endpoint — no auth required.
router.post("/banners/:id/track", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const event = req.body.event as string;
  if (event !== "impression" && event !== "click") {
    res.status(400).json({ error: "event must be 'impression' or 'click'" }); return;
  }
  if (event === "impression") {
    await db.update(bannersTable)
      .set({ impressions: sql`impressions + 1` })
      .where(eq(bannersTable.id, id));
  } else {
    await db.update(bannersTable)
      .set({ clicks: sql`clicks + 1` })
      .where(eq(bannersTable.id, id));
  }
  res.sendStatus(204);
});

// Admin — reset analytics counters for a banner.
router.post("/banners/:id/reset-analytics", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [banner] = await db.update(bannersTable)
    .set({ impressions: 0, clicks: 0 })
    .where(eq(bannersTable.id, id))
    .returning();
  if (!banner) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(banner));
});

router.delete("/banners/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(bannersTable).where(eq(bannersTable.id, id));
  await writeAudit(actor, "delete", "banner", id);
  res.sendStatus(204);
});

export default router;
