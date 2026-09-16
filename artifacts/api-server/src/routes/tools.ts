import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  toolsTable, toolCategoriesTable, toolFavoritesTable, toolUsageTable,
  usersTable, doctorsTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

const DEFAULT_CATEGORIES = [
  { name: "Calculator", slug: "calculator" },
  { name: "Drug", slug: "drug" },
  { name: "Clinical Score", slug: "clinical-score" },
  { name: "Emergency", slug: "emergency" },
  { name: "Reference", slug: "reference" },
  { name: "Custom", slug: "custom" },
];

async function ensureDefaultCategories() {
  const existing = await db.select().from(toolCategoriesTable);
  if (existing.length === 0) {
    await db.insert(toolCategoriesTable).values(
      DEFAULT_CATEGORIES.map(c => ({ ...c, isDefault: true }))
    );
  }
}
ensureDefaultCategories().catch(() => {});

async function getAuthUser(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  return user ?? null;
}

async function getDoctorId(auth: string | undefined): Promise<number | null> {
  const user = await getAuthUser(auth);
  if (!user || user.role !== "doctor") return null;
  return user.doctorId ?? null;
}

// ---- CATEGORIES ----

router.get("/tool-categories", async (_req, res): Promise<void> => {
  const cats = await db.select().from(toolCategoriesTable).orderBy(toolCategoriesTable.id);
  res.json(cats);
});

router.post("/admin/tool-categories", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const { name, slug } = req.body;
  if (!name || !slug) { res.status(400).json({ error: "name and slug required" }); return; }
  const [cat] = await db.insert(toolCategoriesTable).values({ name, slug, isDefault: false }).returning();
  res.status(201).json(cat);
});

router.delete("/admin/tool-categories/:id", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(toolCategoriesTable).where(eq(toolCategoriesTable.id, id));
  res.json({ ok: true });
});

// ---- ADMIN TOOLS ----

router.get("/admin/tools", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { search, category, department, status, type } = req.query as Record<string, string>;

  let tools = await db.select().from(toolsTable).orderBy(toolsTable.createdAt);
  const cats = await db.select().from(toolCategoriesTable);
  const catMap = new Map(cats.map(c => [c.id, c]));

  if (search) {
    const q = search.toLowerCase();
    tools = tools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      (t.shortDescription && t.shortDescription.toLowerCase().includes(q))
    );
  }
  if (category) tools = tools.filter(t => t.categoryId === parseInt(category));
  if (department && department !== "all") tools = tools.filter(t => t.department === department || t.department === "all");
  if (status) tools = tools.filter(t => t.status === status);
  if (type) tools = tools.filter(t => t.type === type);

  const enriched = tools.map(t => ({
    ...t,
    categoryName: t.categoryId ? (catMap.get(t.categoryId)?.name ?? null) : null,
  }));
  res.json({ tools: enriched, total: enriched.length });
});

router.post("/admin/tools", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const { name, slug, type, categoryId, department, shortDescription, featuredImageUrl, icon, status, version, htmlCode, cssCode, jsCode } = req.body;
  if (!name || !slug) { res.status(400).json({ error: "name and slug required" }); return; }
  const [tool] = await db.insert(toolsTable).values({
    name, slug, type: type || "html-tool",
    categoryId: categoryId ? parseInt(categoryId) : null,
    department: department || "all",
    shortDescription, featuredImageUrl, icon,
    status: status || "draft",
    version: version || "1.0",
    htmlCode: htmlCode || "", cssCode: cssCode || "", jsCode: jsCode || "",
  }).returning();
  res.status(201).json(tool);
});

router.patch("/admin/tools/:id", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const fields = ["name","slug","type","categoryId","department","shortDescription","featuredImageUrl","icon","status","version","htmlCode","cssCode","jsCode"];
  const updates: Record<string, unknown> = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (updates.categoryId !== undefined) {
    updates.categoryId = updates.categoryId ? parseInt(updates.categoryId as string) : null;
  }
  const [tool] = await db.update(toolsTable).set(updates).where(eq(toolsTable.id, id)).returning();
  if (!tool) { res.status(404).json({ error: "Not found" }); return; }
  res.json(tool);
});

router.delete("/admin/tools/:id", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(toolsTable).where(eq(toolsTable.id, id));
  res.json({ ok: true });
});

router.post("/admin/tools/:id/duplicate", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const [orig] = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
  if (!orig) { res.status(404).json({ error: "Not found" }); return; }
  const newSlug = `${orig.slug}-copy-${Date.now()}`;
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = orig;
  const [dup] = await db.insert(toolsTable).values({
    ...rest, name: `${orig.name} (Copy)`, slug: newSlug, status: "draft",
  }).returning();
  res.status(201).json(dup);
});

router.post("/admin/tools/:id/publish", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(toolsTable).where(eq(toolsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const newStatus = existing.status === "published" ? "draft" : "published";
  const [tool] = await db.update(toolsTable).set({ status: newStatus }).where(eq(toolsTable.id, id)).returning();
  res.json(tool);
});

/** Import a tool from a JSON package */
router.post("/admin/tools/import", async (req, res): Promise<void> => {
  const user = await getAuthUser(req.headers.authorization);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const pkg = req.body;
  if (!pkg || !pkg.name || !pkg.slug) { res.status(400).json({ error: "Invalid package: name and slug required" }); return; }
  // Make slug unique by appending timestamp if collision
  const existing = await db.select().from(toolsTable).where(eq(toolsTable.slug, pkg.slug));
  const slug = existing.length > 0 ? `${pkg.slug}-${Date.now()}` : pkg.slug;
  const [tool] = await db.insert(toolsTable).values({
    name: pkg.name, slug,
    type: pkg.type || "html-tool",
    categoryId: pkg.categoryId ?? null,
    department: pkg.department || "all",
    shortDescription: pkg.shortDescription ?? null,
    featuredImageUrl: pkg.featuredImageUrl ?? null,
    icon: pkg.icon ?? null,
    status: "draft",
    version: pkg.version || "1.0",
    htmlCode: pkg.htmlCode || pkg.html || "",
    cssCode: pkg.cssCode || pkg.css || "",
    jsCode: pkg.jsCode || pkg.js || "",
  }).returning();
  res.status(201).json(tool);
});

// ---- PUBLIC TOOLS ----

router.get("/tools", async (req, res): Promise<void> => {
  const { search, category, department } = req.query as Record<string, string>;
  let tools = await db.select().from(toolsTable).where(eq(toolsTable.status, "published"));
  const cats = await db.select().from(toolCategoriesTable);
  const catMap = new Map(cats.map(c => [c.id, c]));

  if (search) {
    const q = search.toLowerCase();
    tools = tools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.shortDescription && t.shortDescription.toLowerCase().includes(q))
    );
  }
  if (category) tools = tools.filter(t => t.categoryId === parseInt(category));
  if (department && department !== "all") tools = tools.filter(t => t.department === department || t.department === "all");

  const enriched = tools.map(t => ({
    ...t, htmlCode: undefined, cssCode: undefined, jsCode: undefined,
    categoryName: t.categoryId ? (catMap.get(t.categoryId)?.name ?? null) : null,
  }));
  res.json(enriched);
});

// NOTE: specific doctor routes must come BEFORE /tools/:slug to avoid param clash
router.get("/doctor/tools/favorites", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const favs = await db.select().from(toolFavoritesTable).where(eq(toolFavoritesTable.doctorId, doctorId));
  const toolIds = favs.map(f => f.toolId);
  if (toolIds.length === 0) { res.json([]); return; }
  const tools = await db.select().from(toolsTable);
  const cats = await db.select().from(toolCategoriesTable);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const result = tools.filter(t => toolIds.includes(t.id) && t.status === "published").map(t => ({
    ...t, htmlCode: undefined, cssCode: undefined, jsCode: undefined,
    categoryName: t.categoryId ? (catMap.get(t.categoryId)?.name ?? null) : null,
    isFavorite: true,
  }));
  res.json(result);
});

router.get("/doctor/tools/recent", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const usages = await db.select().from(toolUsageTable)
    .where(eq(toolUsageTable.doctorId, doctorId))
    .orderBy(toolUsageTable.usedAt);
  const toolIds = [...usages].reverse().slice(0, 20).map(u => u.toolId);
  if (toolIds.length === 0) { res.json([]); return; }
  const tools = await db.select().from(toolsTable);
  const cats = await db.select().from(toolCategoriesTable);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const favs = await db.select().from(toolFavoritesTable).where(eq(toolFavoritesTable.doctorId, doctorId));
  const favSet = new Set(favs.map(f => f.toolId));
  const result = toolIds
    .map(id => tools.find(t => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t && t.status === "published")
    .map(t => ({
      ...t, htmlCode: undefined, cssCode: undefined, jsCode: undefined,
      categoryName: t.categoryId ? (catMap.get(t.categoryId)?.name ?? null) : null,
      isFavorite: favSet.has(t.id),
    }));
  res.json(result);
});

router.get("/tools/:slug", async (req, res): Promise<void> => {
  const [tool] = await db.select().from(toolsTable).where(eq(toolsTable.slug, req.params.slug));
  if (!tool) { res.status(404).json({ error: "Not found" }); return; }
  // Admins can view drafts; others only published
  const user = await getAuthUser(req.headers.authorization);
  if (tool.status !== "published" && user?.role !== "admin") {
    res.status(404).json({ error: "Not found" }); return;
  }
  const cats = await db.select().from(toolCategoriesTable);
  const catMap = new Map(cats.map(c => [c.id, c]));
  res.json({
    ...tool,
    categoryName: tool.categoryId ? (catMap.get(tool.categoryId)?.name ?? null) : null,
  });
});

// ---- DOCTOR FAVORITES ----

router.post("/tools/:id/favorite", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(403).json({ error: "Doctor role required" }); return; }
  const toolId = parseInt(req.params.id);
  await db.insert(toolFavoritesTable).values({ doctorId, toolId }).onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/tools/:id/favorite", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(403).json({ error: "Doctor role required" }); return; }
  const toolId = parseInt(req.params.id);
  await db.delete(toolFavoritesTable).where(
    and(eq(toolFavoritesTable.doctorId, doctorId), eq(toolFavoritesTable.toolId, toolId))
  );
  res.json({ ok: true });
});

// ---- DOCTOR USAGE ----

router.post("/tools/:id/use", async (req, res): Promise<void> => {
  const doctorId = await getDoctorId(req.headers.authorization);
  if (!doctorId) { res.status(403).json({ error: "Doctor role required" }); return; }
  const toolId = parseInt(req.params.id);
  // Upsert: update usedAt if already exists
  await db.insert(toolUsageTable).values({ doctorId, toolId, usedAt: new Date() })
    .onConflictDoUpdate({ target: [toolUsageTable.doctorId, toolUsageTable.toolId], set: { usedAt: new Date() } });
  res.json({ ok: true });
});

export default router;
