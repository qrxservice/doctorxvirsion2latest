import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, menuItemsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

const LOCATIONS    = ["header", "footer", "both", "hidden"] as const;
const MENU_TYPES   = ["internal", "external", "custom", "category", "blog", "tool"] as const;
const VISIBILITIES = ["public", "logged-in", "doctor", "assistant", "admin"] as const;
const FOOTER_GROUPS = ["quick-links", "services", "resources", "legal", "contact"] as const;

function serialize(m: typeof menuItemsTable.$inferSelect) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

function normalize<T extends readonly string[]>(arr: T, value: unknown, fallback: T[number]): T[number] {
  return arr.includes(value as T[number]) ? (value as T[number]) : fallback;
}

// Allow http(s) absolute URLs, relative paths starting with /, or # (parent items)
function isSafeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (!t || t === "#") return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\/(?!\/)/.test(t)) return true;
  return false;
}

// Allowed visibilities given a role
function allowedVis(role: string | null): string[] {
  if (role === "admin")     return ["public", "logged-in", "doctor", "assistant", "admin"];
  if (role === "doctor")    return ["public", "logged-in", "doctor"];
  if (role === "assistant") return ["public", "logged-in", "assistant"];
  if (role === "patient")   return ["public", "logged-in"];
  return ["public"];
}

// ─── GET /menu-items ──────────────────────────────────────────────────────────
// Public (active only, visibility-filtered) or admin (?all=true, all items).
router.get("/menu-items", async (req, res): Promise<void> => {
  const wantAll = req.query.all === "true";
  const locationFilter = req.query.location as string | undefined;

  let rows = await db.select().from(menuItemsTable).orderBy(asc(menuItemsTable.displayOrder));

  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  } else {
    // Active items only, not hidden, filtered by visibility
    rows = rows.filter(m => m.isActive && m.location !== "hidden");

    let role: string | null = null;
    try { role = (await getActor(req.headers.authorization)).role; } catch { /* unauthenticated */ }

    const allowed = allowedVis(role);
    rows = rows.filter(m => allowed.includes(m.visibility ?? "public"));
  }

  if (locationFilter) {
    rows = rows.filter(m => m.location === locationFilter || m.location === "both");
  }

  res.json(rows.map(serialize));
});

// ─── POST /menu-items/reorder ─────────────────────────────────────────────────
// Body: [{ id, displayOrder }]
router.post("/menu-items/reorder", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const items = req.body as { id: number; displayOrder: number }[];
  if (!Array.isArray(items)) { res.status(400).json({ error: "Expected array" }); return; }

  await Promise.all(
    items.map(({ id, displayOrder }) =>
      db.update(menuItemsTable).set({ displayOrder }).where(eq(menuItemsTable.id, id)),
    ),
  );
  res.json({ ok: true });
});

// ─── POST /menu-items ─────────────────────────────────────────────────────────
router.post("/menu-items", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const {
    label, titleBn, url = "#", location, footerGroup, menuType,
    visibility, parentId, displayOrder, openInNewTab, isNoFollow, isActive = true,
  } = req.body;

  if (!label) { res.status(400).json({ error: "Label required" }); return; }
  if (!isSafeUrl(url)) {
    res.status(400).json({ error: "URL must be http(s), a path starting with /, or #" });
    return;
  }

  const [item] = await db.insert(menuItemsTable).values({
    label,
    titleBn: titleBn || null,
    url: (url as string).trim() || "#",
    location:    normalize(LOCATIONS,    location,    "header"),
    footerGroup: normalize(FOOTER_GROUPS, footerGroup, null as never) as string | null,
    menuType:    normalize(MENU_TYPES,   menuType,    "custom"),
    visibility:  normalize(VISIBILITIES, visibility,  "public"),
    parentId:    typeof parentId === "number" ? parentId : null,
    displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
    openInNewTab: typeof openInNewTab === "boolean" ? openInNewTab : false,
    isNoFollow:   typeof isNoFollow   === "boolean" ? isNoFollow   : false,
    isActive,
  }).returning();

  await writeAudit(actor, "create", "menu_item", item.id, label);
  res.status(201).json(serialize(item));
});

// ─── PATCH /menu-items/:id ────────────────────────────────────────────────────
router.patch("/menu-items/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(String(req.params.id));
  const {
    label, titleBn, url, location, footerGroup, menuType,
    visibility, parentId, displayOrder, openInNewTab, isNoFollow, isActive,
  } = req.body;

  const updates: Record<string, unknown> = {};
  if (label       !== undefined) updates.label       = label;
  if (titleBn     !== undefined) updates.titleBn     = titleBn || null;
  if (url         !== undefined) {
    if (!isSafeUrl(url)) {
      res.status(400).json({ error: "URL must be http(s), a path starting with /, or #" });
      return;
    }
    updates.url = (url as string).trim() || "#";
  }
  if (location    !== undefined) updates.location    = normalize(LOCATIONS,     location,    "header");
  if (footerGroup !== undefined) updates.footerGroup = FOOTER_GROUPS.includes(footerGroup as typeof FOOTER_GROUPS[number]) ? footerGroup : null;
  if (menuType    !== undefined) updates.menuType    = normalize(MENU_TYPES,    menuType,    "custom");
  if (visibility  !== undefined) updates.visibility  = normalize(VISIBILITIES,  visibility,  "public");
  if (parentId    !== undefined) updates.parentId    = typeof parentId === "number" ? parentId : null;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (openInNewTab !== undefined) updates.openInNewTab = openInNewTab;
  if (isNoFollow   !== undefined) updates.isNoFollow   = isNoFollow;
  if (isActive     !== undefined) updates.isActive     = isActive;

  const [item] = await db.update(menuItemsTable).set(updates).where(eq(menuItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  await writeAudit(actor, "update", "menu_item", id);
  res.json(serialize(item));
});

// ─── DELETE /menu-items/:id ───────────────────────────────────────────────────
router.delete("/menu-items/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(String(req.params.id));
  // Detach children before deleting parent
  await db.update(menuItemsTable).set({ parentId: null }).where(eq(menuItemsTable.parentId, id));
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, id));
  await writeAudit(actor, "delete", "menu_item", id);
  res.sendStatus(204);
});

export default router;
