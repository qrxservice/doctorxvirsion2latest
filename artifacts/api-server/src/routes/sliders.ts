import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, slidersTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(s: typeof slidersTable.$inferSelect) {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    startDate: s.startDate ? s.startDate.toISOString() : null,
    endDate: s.endDate ? s.endDate.toISOString() : null,
  };
}

router.get("/sliders", async (req, res): Promise<void> => {
  const position = req.query.position as string | undefined;
  const wantAll = req.query.all === "true";

  let rows = await db.select().from(slidersTable).orderBy(asc(slidersTable.displayOrder));

  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  } else {
    rows = rows.filter(s => s.isActive);
    const now = Date.now();
    rows = rows.filter(s => {
      if (s.startDate && s.startDate.getTime() > now) return false;
      if (s.endDate && s.endDate.getTime() < now) return false;
      return true;
    });
    rows.sort((a, b) => (b.priority - a.priority) || (a.displayOrder - b.displayOrder));
  }

  if (position) rows = rows.filter(s => s.position === position);
  res.json(rows.map(serialize));
});

router.post("/sliders", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const {
    title, imageUrl, linkUrl, buttonText, description, position,
    isActive = true, startDate, endDate, priority, displayOrder,
    autoPlay = true, slideInterval = 5000, showArrows = true, showDots = true,
    desktopWidth, desktopHeight, mobileWidth, mobileHeight,
    tabletWidth, tabletHeight, customWidth, customHeight,
  } = req.body;

  if (!title) { res.status(400).json({ error: "Title required" }); return; }

  const [slider] = await db.insert(slidersTable).values({
    title,
    imageUrl: imageUrl ?? null,
    linkUrl: linkUrl ?? null,
    buttonText: buttonText ?? null,
    description: description ?? null,
    position: position ?? "hero",
    isActive,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    priority: typeof priority === "number" ? priority : 0,
    displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
    autoPlay,
    slideInterval: typeof slideInterval === "number" ? slideInterval : 5000,
    showArrows,
    showDots,
    desktopWidth: desktopWidth ?? null,
    desktopHeight: desktopHeight ?? null,
    mobileWidth: mobileWidth ?? null,
    mobileHeight: mobileHeight ?? null,
    tabletWidth: tabletWidth ?? null,
    tabletHeight: tabletHeight ?? null,
    customWidth: customWidth ?? null,
    customHeight: customHeight ?? null,
  }).returning();

  await writeAudit(actor, "create", "slider", slider.id, title);
  res.status(201).json(serialize(slider));
});

router.patch("/sliders/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  const fields = [
    "title", "imageUrl", "linkUrl", "buttonText", "description", "position",
    "isActive", "priority", "displayOrder",
    "autoPlay", "slideInterval", "showArrows", "showDots",
    "desktopWidth", "desktopHeight", "mobileWidth", "mobileHeight",
    "tabletWidth", "tabletHeight", "customWidth", "customHeight",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  if (body.startDate !== undefined) updates.startDate = body.startDate ? new Date(body.startDate as string) : null;
  if (body.endDate !== undefined) updates.endDate = body.endDate ? new Date(body.endDate as string) : null;

  const [slider] = await db.update(slidersTable).set(updates).where(eq(slidersTable.id, id)).returning();
  if (!slider) { res.status(404).json({ error: "Not found" }); return; }

  await writeAudit(actor, "update", "slider", id);
  res.json(serialize(slider));
});

router.delete("/sliders/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(slidersTable).where(eq(slidersTable.id, id));
  await writeAudit(actor, "delete", "slider", id);
  res.sendStatus(204);
});

export default router;
