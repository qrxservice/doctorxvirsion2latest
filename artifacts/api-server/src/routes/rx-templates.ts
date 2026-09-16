import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, rxTemplatesTable, usersTable, appSettingsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

interface CallerInfo {
  doctorId: number | null;
  role: string;
  canViewTemplates: boolean;
}

async function getCaller(auth: string | undefined): Promise<CallerInfo | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user) return null;
    let canViewTemplates = false;
    if (user.role === "doctor") {
      canViewTemplates = true;
    } else if (user.role === "assistant" && user.permissions) {
      try {
        const p = JSON.parse(user.permissions);
        canViewTemplates = p.canViewTemplates === true;
      } catch { /* invalid json */ }
    }
    return { doctorId: user.doctorId ?? null, role: user.role, canViewTemplates };
  } catch { return null; }
}

async function isTemplateManagementEnabled(): Promise<boolean> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return settings?.doctorTemplateManagementEnabled ?? true;
}

// System default templates — authoritative backup kept in code; never removed.
// Doctors get a personal copy of each type seeded into their DB rows on first load.
const SYSTEM_DEFAULTS: Array<{ type: string; title: string; content: string }> = [
  // Dose
  { type: "dose", title: "১+০+০", content: "১+০+০" },
  { type: "dose", title: "০+১+০", content: "০+১+০" },
  { type: "dose", title: "০+০+১", content: "০+০+১" },
  { type: "dose", title: "১+০+১", content: "১+০+১" },
  { type: "dose", title: "১+১+০", content: "১+১+০" },
  { type: "dose", title: "০+১+১", content: "০+১+১" },
  { type: "dose", title: "১+১+১", content: "১+১+১" },
  { type: "dose", title: "১ চামচ দিনে ৩ বার", content: "১ চামচ দিনে ৩ বার" },
  { type: "dose", title: "প্রয়োজনে ১টি", content: "প্রয়োজনে ১টি" },
  // Timing
  { type: "timing", title: "খালি পেটে", content: "খালি পেটে" },
  { type: "timing", title: "ভরা পেটে", content: "ভরা পেটে" },
  { type: "timing", title: "রাতে ঘুমাবার আগে", content: "রাতে ঘুমাবার আগে" },
  { type: "timing", title: "প্রয়োজনে", content: "প্রয়োজনে" },
  { type: "timing", title: "সকালে খালি পেটে", content: "সকালে খালি পেটে" },
  // Duration — titles use Bengali numerals for full Bengali consistency
  { type: "duration", title: "৩ দিন",  content: "3 D"  },
  { type: "duration", title: "৫ দিন",  content: "5 D"  },
  { type: "duration", title: "৭ দিন",  content: "7 D"  },
  { type: "duration", title: "১০ দিন", content: "10 D" },
  { type: "duration", title: "১৪ দিন", content: "14 D" },
  { type: "duration", title: "৩০ দিন", content: "30 D" },
  { type: "duration", title: "১ মাস",  content: "1 M"  },
  { type: "duration", title: "২ মাস",  content: "2 M"  },
  { type: "duration", title: "৩ মাস",  content: "3 M"  },
  // C/C
  { type: "cc", title: "জ্বর, মাথাব্যথা", content: "জ্বর, মাথাব্যথা, শরীর ব্যথা" },
  { type: "cc", title: "কাশি, সর্দি", content: "কাশি, সর্দি, গলাব্যথা" },
  { type: "cc", title: "পেটব্যথা, বমি", content: "পেটব্যথা, বমি, ডায়রিয়া" },
  { type: "cc", title: "বুকে ব্যথা", content: "বুকে ব্যথা, শ্বাসকষ্ট" },
  { type: "cc", title: "ডায়াবেটিস ফলো-আপ", content: "ডায়াবেটিস নিয়মিত ফলো-আপ, রক্তের শর্করা নিয়ন্ত্রণে নেই" },
  // O/E
  { type: "oe", title: "স্বাভাবিক পরীক্ষা", content: "General condition fair. BP normal. Heart: S1S2 heard. Chest: clear. Abdomen: soft, non-tender." },
  { type: "oe", title: "জ্বরের পরীক্ষা", content: "Febrile. Temp elevated. Throat congested. Tonsils enlarged. Chest: clear." },
  // I/X
  { type: "ix", title: "CBC + Urine R/E", content: "CBC, Urine R/E" },
  { type: "ix", title: "ডায়াবেটিস প্যানেল", content: "FBS, 2hr ABF, HbA1c, Lipid Profile, Creatinine, Urine R/E" },
  { type: "ix", title: "কার্ডিয়াক প্যানেল", content: "ECG, Echocardiography, CBC, Lipid Profile, Troponin I" },
  { type: "ix", title: "লিভার ফাংশন", content: "LFT (SGPT, SGOT, Bilirubin, ALP), CBC, PT/INR" },
  // Advice
  { type: "advice", title: "Diabetic Advice", content: "নিয়মিত রক্তের শর্করা মাপুন\nচিনি ও মিষ্টি খাবার এড়িয়ে চলুন\nনিয়মিত হাঁটুন (৩০ মিনিট)\nওষুধ নিয়মিত খান, বাদ দেবেন না" },
  { type: "advice", title: "Rest and Fluid", content: "প্রচুর পানি পান করুন (দিনে ৮-১০ গ্লাস)\n২-৩ দিন বিশ্রাম নিন\nহালকা খাবার খান\nঠান্ডা পানি এড়িয়ে চলুন" },
  { type: "advice", title: "URTI Advice", content: "গরম পানি পান করুন\nলবণ গরম পানিতে গার্গল করুন\nধূলো-ধোঁয়া এড়িয়ে চলুন\nবিশ্রাম নিন" },
  { type: "advice", title: "Hypertension", content: "লবণ কম খান\nনিয়মিত BP মাপুন\nমানসিক চাপ কমান\nওষুধ প্রতিদিন নিন" },
  // Protocol
  { type: "protocol", title: "Fever Protocol", content: "Paracetamol 500mg — ১+১+১ — ৫ দিন\nমেট্রোনিডাজল ৪০০mg — ১+১+১ — ৫ দিন (প্রয়োজনে)\nপ্রচুর পানি ও বিশ্রাম" },
  { type: "protocol", title: "Gastritis Protocol", content: "Omeprazole 20mg — ০+০+১ — ১৪ দিন\nAntacid syrup — প্রয়োজনে\nমশলাদার খাবার এড়িয়ে চলুন" },
  // Follow-up
  { type: "followup", title: "2 সপ্তাহ পর", content: "2 সপ্তাহ পর ফলো-আপ করুন" },
  { type: "followup", title: "1 মাস পর", content: "1 মাস পর ফলো-আপ করুন" },
  { type: "followup", title: "3 মাস পর", content: "3 মাস পর ফলো-আপ করুন" },
  { type: "followup", title: "প্রয়োজনে আসুন", content: "প্রয়োজনে আসুন" },
  { type: "followup", title: "সুস্থ না হলে আসুন", content: "সুস্থ না হলে আসুন" },
];

// For each template type, seed defaults into the doctor's rows if they have none for that type.
// This runs on every GET so new types added to SYSTEM_DEFAULTS are automatically picked up.
async function seedDefaultsForDoctor(doctorId: number): Promise<void> {
  const types = [...new Set(SYSTEM_DEFAULTS.map(d => d.type))];
  for (const type of types) {
    const [existing] = await db
      .select({ id: rxTemplatesTable.id })
      .from(rxTemplatesTable)
      .where(and(eq(rxTemplatesTable.doctorId, doctorId), eq(rxTemplatesTable.type, type)))
      .limit(1);
    if (!existing) {
      const defaults = SYSTEM_DEFAULTS.filter(d => d.type === type);
      await db.insert(rxTemplatesTable).values(
        defaults.map((d, i) => ({
          doctorId,
          type: d.type,
          title: d.title,
          content: d.content,
          isBuiltin: true,
          sortOrder: i,
        }))
      );
    }
  }
}

// GET /api/rx-templates — list templates for the authenticated doctor.
// ?all=1 includes hidden templates (used by the Manage panel).
// ?type=xxx filters by type.
router.get("/rx-templates", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  const { type, all } = req.query as Record<string, string>;
  const includeHidden = all === "1";

  // Unauthenticated or assistant without canViewTemplates: return in-memory defaults only
  if (!caller?.doctorId || (caller.role === "assistant" && !caller.canViewTemplates)) {
    const builtins = SYSTEM_DEFAULTS
      .filter(t => !type || t.type === type)
      .map((t, i) => ({
        id: -(i + 1), doctorId: null, ...t, department: null,
        isFavorite: false, isHidden: false, isBuiltin: true, sortOrder: i,
        createdAt: new Date().toISOString(),
      }));
    res.json(builtins);
    return;
  }

  // Seed any missing template types for this doctor on every authenticated load
  await seedDefaultsForDoctor(caller.doctorId);

  const rows = await db.select().from(rxTemplatesTable)
    .where(
      and(
        eq(rxTemplatesTable.doctorId, caller.doctorId),
        type ? eq(rxTemplatesTable.type, type) : undefined,
        !includeHidden ? eq(rxTemplatesTable.isHidden, false) : undefined,
      )
    )
    .orderBy(rxTemplatesTable.sortOrder, rxTemplatesTable.createdAt);

  res.json(rows);
});

// POST /api/rx-templates/restore-defaults — un-hide hidden builtin rows + re-insert
// any deleted defaults. Preserves custom edits to content/title.
router.post("/rx-templates/restore-defaults", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller?.doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }

  await db.update(rxTemplatesTable)
    .set({ isHidden: false })
    .where(and(eq(rxTemplatesTable.doctorId, caller.doctorId), eq(rxTemplatesTable.isBuiltin, true)));

  const existing = await db
    .select({ type: rxTemplatesTable.type, title: rxTemplatesTable.title })
    .from(rxTemplatesTable)
    .where(eq(rxTemplatesTable.doctorId, caller.doctorId));
  const existingKeys = new Set(existing.map(r => `${r.type}::${r.title}`));

  const missing = SYSTEM_DEFAULTS.filter(d => !existingKeys.has(`${d.type}::${d.title}`));
  if (missing.length > 0) {
    await db.insert(rxTemplatesTable).values(
      missing.map((d, i) => ({
        doctorId: caller.doctorId!,
        type: d.type, title: d.title, content: d.content,
        isBuiltin: true, sortOrder: 1000 + i,
      }))
    );
  }

  res.json({ restored: true, reinserted: missing.length });
});

// POST /api/rx-templates/restore-defaults/:doctorId — admin override for any doctor.
router.post("/rx-templates/restore-defaults/:doctorId", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller || caller.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const doctorId = parseInt(req.params.doctorId);
  if (isNaN(doctorId)) { res.status(400).json({ error: "Invalid doctorId" }); return; }

  await db.update(rxTemplatesTable)
    .set({ isHidden: false })
    .where(and(eq(rxTemplatesTable.doctorId, doctorId), eq(rxTemplatesTable.isBuiltin, true)));

  const existing = await db
    .select({ type: rxTemplatesTable.type, title: rxTemplatesTable.title })
    .from(rxTemplatesTable)
    .where(eq(rxTemplatesTable.doctorId, doctorId));
  const existingKeys = new Set(existing.map(r => `${r.type}::${r.title}`));
  const missing = SYSTEM_DEFAULTS.filter(d => !existingKeys.has(`${d.type}::${d.title}`));
  if (missing.length > 0) {
    await db.insert(rxTemplatesTable).values(
      missing.map((d, i) => ({
        doctorId, type: d.type, title: d.title, content: d.content,
        isBuiltin: true, sortOrder: 1000 + i,
      }))
    );
  }

  res.json({ restored: true, reinserted: missing.length });
});

// POST /api/rx-templates — create a new custom template.
router.post("/rx-templates", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller?.doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (caller.role === "assistant") {
    res.status(403).json({ error: "Assistants cannot create templates" }); return;
  }
  const mgmtEnabled = await isTemplateManagementEnabled();
  if (!mgmtEnabled) {
    res.status(403).json({ error: "Template management is disabled by admin" }); return;
  }
  const { type, title, content, department, isFavorite } = req.body;
  if (!type || !title || !content) { res.status(400).json({ error: "type, title, content required" }); return; }
  const [tmpl] = await db.insert(rxTemplatesTable).values({
    doctorId: caller.doctorId, type, title, content,
    department: department ?? null,
    isFavorite: isFavorite ?? false,
  }).returning();
  res.status(201).json(tmpl);
});

// PUT /api/rx-templates/:id — update a template (title, content, isHidden, sortOrder, etc.)
router.put("/rx-templates/:id", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller?.doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (caller.role === "assistant") {
    res.status(403).json({ error: "Assistants cannot edit templates" }); return;
  }
  const mgmtEnabled = await isTemplateManagementEnabled();
  if (!mgmtEnabled) {
    res.status(403).json({ error: "Template management is disabled by admin" }); return;
  }
  const id = parseInt(req.params.id);
  const { title, content, department, isFavorite, isHidden, sortOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (department !== undefined) updates.department = department;
  if (isFavorite !== undefined) updates.isFavorite = isFavorite;
  if (isHidden !== undefined) updates.isHidden = isHidden;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  const [tmpl] = await db.update(rxTemplatesTable).set(updates)
    .where(and(eq(rxTemplatesTable.id, id), eq(rxTemplatesTable.doctorId, caller.doctorId))).returning();
  if (!tmpl) { res.status(404).json({ error: "Not found" }); return; }
  res.json(tmpl);
});

// DELETE /api/rx-templates/:id — delete a template. Builtin rows can be deleted; use
// "Restore Defaults" to bring them back.
router.delete("/rx-templates/:id", async (req, res): Promise<void> => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller?.doctorId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (caller.role === "assistant") {
    res.status(403).json({ error: "Assistants cannot delete templates" }); return;
  }
  const mgmtEnabled = await isTemplateManagementEnabled();
  if (!mgmtEnabled) {
    res.status(403).json({ error: "Template management is disabled by admin" }); return;
  }
  const id = parseInt(req.params.id);
  await db.delete(rxTemplatesTable).where(and(eq(rxTemplatesTable.id, id), eq(rxTemplatesTable.doctorId, caller.doctorId)));
  res.json({ message: "Deleted" });
});

export default router;
