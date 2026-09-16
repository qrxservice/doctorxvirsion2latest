import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, videoPromotionsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(v: typeof videoPromotionsTable.$inferSelect) {
  return {
    ...v,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

// Public — returns active promos; ?all=true (admin only) returns all
router.get("/video-promotions", async (req, res): Promise<void> => {
  const wantAll = req.query.all === "true";
  let rows = await db.select().from(videoPromotionsTable).orderBy(asc(videoPromotionsTable.displayOrder));

  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  } else {
    rows = rows.filter(v => v.isActive);
    rows.sort((a, b) => (b.priority - a.priority) || (a.displayOrder - b.displayOrder));
  }

  const position = req.query.position as string | undefined;
  if (position) rows = rows.filter(v => v.position === position);

  res.json(rows.map(serialize));
});

// Admin — create
router.post("/video-promotions", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const {
    title, videoUrl, thumbnailUrl, position = "homepage_hero",
    isActive = true, displayOrder = 0, priority = 0,
    desktopWidth, desktopHeight, mobileWidth, mobileHeight,
  } = req.body as Record<string, unknown>;

  if (!title) { res.status(400).json({ error: "Title required" }); return; }

  const [row] = await db.insert(videoPromotionsTable).values({
    title: title as string,
    videoUrl: (videoUrl as string) ?? null,
    thumbnailUrl: (thumbnailUrl as string) ?? null,
    position: (position as string),
    isActive: Boolean(isActive),
    displayOrder: Number(displayOrder) || 0,
    priority: Number(priority) || 0,
    desktopWidth: desktopWidth != null ? Number(desktopWidth) : null,
    desktopHeight: desktopHeight != null ? Number(desktopHeight) : null,
    mobileWidth: mobileWidth != null ? Number(mobileWidth) : null,
    mobileHeight: mobileHeight != null ? Number(mobileHeight) : null,
  }).returning();

  await writeAudit(actor, "create", "video_promotion", row.id, title as string);
  res.status(201).json(serialize(row));
});

// Admin — update
router.patch("/video-promotions/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(req.params.id);
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  const scalar = [
    "title", "videoUrl", "thumbnailUrl", "position",
    "isActive", "displayOrder", "priority",
    "desktopWidth", "desktopHeight", "mobileWidth", "mobileHeight",
  ];
  for (const f of scalar) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  const [row] = await db.update(videoPromotionsTable).set(updates).where(eq(videoPromotionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  await writeAudit(actor, "update", "video_promotion", id);
  res.json(serialize(row));
});

// Admin — delete
router.delete("/video-promotions/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(req.params.id);
  await db.delete(videoPromotionsTable).where(eq(videoPromotionsTable.id, id));
  await writeAudit(actor, "delete", "video_promotion", id);
  res.sendStatus(204);
});

export default router;
