import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, calculatorsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(c: typeof calculatorsTable.$inferSelect) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  let candidate = base || `calculator-${Date.now()}`;
  let n = 1;
  while (true) {
    const [existing] = await db.select().from(calculatorsTable).where(eq(calculatorsTable.slug, candidate));
    if (!existing || existing.id === ignoreId) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// Public: list published calculators (or all for admin)
router.get("/calculators", async (req, res): Promise<void> => {
  const wantAll = req.query.all === "true";
  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
    const rows = await db.select().from(calculatorsTable).orderBy(desc(calculatorsTable.createdAt));
    res.json(rows.map(serialize));
    return;
  }
  const rows = await db.select().from(calculatorsTable)
    .where(eq(calculatorsTable.status, "published"))
    .orderBy(desc(calculatorsTable.createdAt));
  res.json(rows.map(serialize));
});

// Public: get published calculator by slug
router.get("/calculators/slug/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [calc] = await db.select().from(calculatorsTable).where(eq(calculatorsTable.slug, slug));
  if (!calc || calc.status !== "published") { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(calc));
});

// Admin: get any calculator by id (including drafts)
router.get("/calculators/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [calc] = await db.select().from(calculatorsTable).where(eq(calculatorsTable.id, id));
  if (!calc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(calc));
});

// Admin: create calculator
router.post("/calculators", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const {
    title, slug, category, shortDescription, content, featuredImageUrl,
    seoTitle, metaDescription, status, schemaEnabled,
    fieldsJson, formulasJson, resultsJson, faqsJson, placementsJson,
  } = req.body;
  if (!title) { res.status(400).json({ error: "Title required" }); return; }
  const finalStatus = status === "published" ? "published" : "draft";
  const finalSlug = await uniqueSlug(slugify(slug || title));
  const [calc] = await db.insert(calculatorsTable).values({
    title,
    slug: finalSlug,
    category: category || "general",
    shortDescription: shortDescription ?? null,
    content: content ?? "",
    featuredImageUrl: featuredImageUrl || null,
    seoTitle: seoTitle ?? null,
    metaDescription: metaDescription ?? null,
    status: finalStatus,
    schemaEnabled: schemaEnabled ?? false,
    fieldsJson: fieldsJson ?? [],
    formulasJson: formulasJson ?? [],
    resultsJson: resultsJson ?? [],
    faqsJson: faqsJson ?? [],
    placementsJson: placementsJson ?? [],
  }).returning();
  await writeAudit(actor, "create", "calculator", calc.id, title);
  res.status(201).json(serialize(calc));
});

// Admin: update calculator
router.patch("/calculators/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [current] = await db.select().from(calculatorsTable).where(eq(calculatorsTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const {
    title, slug, category, shortDescription, content, featuredImageUrl,
    seoTitle, metaDescription, status, schemaEnabled,
    fieldsJson, formulasJson, resultsJson, faqsJson, placementsJson,
  } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (slug !== undefined) updates.slug = await uniqueSlug(slugify(slug || title || current.title), id);
  if (category !== undefined) updates.category = category;
  if (shortDescription !== undefined) updates.shortDescription = shortDescription;
  if (content !== undefined) updates.content = content;
  if (featuredImageUrl !== undefined) updates.featuredImageUrl = featuredImageUrl || null;
  if (seoTitle !== undefined) updates.seoTitle = seoTitle;
  if (metaDescription !== undefined) updates.metaDescription = metaDescription;
  if (status !== undefined) updates.status = status === "published" ? "published" : "draft";
  if (schemaEnabled !== undefined) updates.schemaEnabled = schemaEnabled;
  if (fieldsJson !== undefined) updates.fieldsJson = fieldsJson;
  if (formulasJson !== undefined) updates.formulasJson = formulasJson;
  if (resultsJson !== undefined) updates.resultsJson = resultsJson;
  if (faqsJson !== undefined) updates.faqsJson = faqsJson;
  if (placementsJson !== undefined) updates.placementsJson = placementsJson;
  const [calc] = await db.update(calculatorsTable).set(updates).where(eq(calculatorsTable.id, id)).returning();
  await writeAudit(actor, "update", "calculator", id);
  res.json(serialize(calc));
});

// Admin: delete calculator
router.delete("/calculators/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(calculatorsTable).where(eq(calculatorsTable.id, id));
  await writeAudit(actor, "delete", "calculator", id);
  res.sendStatus(204);
});

// Admin: seed demo BMI calculator
router.post("/calculators/seed/bmi", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const existing = await db.select().from(calculatorsTable).where(eq(calculatorsTable.slug, "bmi-calculator"));
  if (existing.length > 0) { res.json({ message: "BMI calculator already exists", calculator: serialize(existing[0]) }); return; }
  const [calc] = await db.insert(calculatorsTable).values({
    title: "BMI Calculator",
    slug: "bmi-calculator",
    category: "nutrition",
    shortDescription: "Calculate your Body Mass Index to assess your weight relative to your height.",
    content: "Body Mass Index (BMI) is a simple calculation using a person's height and weight. The formula is BMI = kg/m². A BMI of 18.5 to 24.9 is considered healthy.",
    status: "published",
    schemaEnabled: true,
    fieldsJson: [
      { id: "weight", name: "weight", label: "Weight", type: "number", placeholder: "e.g. 70", unit: "kg", required: true, defaultValue: "", sortOrder: 1 },
      { id: "height", name: "height", label: "Height", type: "number", placeholder: "e.g. 175", unit: "cm", required: true, defaultValue: "", sortOrder: 2 },
    ],
    formulasJson: [
      { id: "bmi", name: "bmi", expression: "weight / ((height / 100) * (height / 100))", unit: "kg/m²" },
    ],
    resultsJson: [
      {
        id: "bmi_result",
        title: "Your BMI",
        formulaName: "bmi",
        unit: "kg/m²",
        category: "BMI Score",
        suggestionText: "Consult your doctor if your BMI is outside the healthy range.",
        conditions: [
          { operator: "lt", value: 18.5, label: "Underweight", color: "blue", message: "You are underweight. Consider consulting a nutritionist." },
          { operator: "gte_lt", value: 18.5, value2: 25, label: "Normal weight", color: "green", message: "Great! Your BMI is in the healthy range." },
          { operator: "gte_lt", value: 25, value2: 30, label: "Overweight", color: "yellow", message: "You are overweight. Consider a balanced diet and regular exercise." },
          { operator: "gte", value: 30, label: "Obese", color: "red", message: "Your BMI indicates obesity. Please consult a healthcare provider." },
        ],
      },
    ],
    faqsJson: [
      { question: "What is BMI?", answer: "BMI (Body Mass Index) is a measure of body fat based on height and weight." },
      { question: "What is a healthy BMI?", answer: "A BMI between 18.5 and 24.9 is considered healthy for most adults." },
      { question: "Are there limitations to BMI?", answer: "Yes, BMI doesn't account for muscle mass, bone density, or fat distribution. Athletes may have high BMI despite being healthy." },
    ],
    placementsJson: ["public_tools", "main_menu"],
  }).returning();
  await writeAudit(actor, "seed", "calculator", calc.id, "BMI Calculator");
  res.status(201).json(serialize(calc));
});

export default router;
