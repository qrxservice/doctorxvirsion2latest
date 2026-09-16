import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, adsenseSlotsTable, ADSENSE_POSITIONS, type AdsensePosition } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

/**
 * Seed all 7 positions in one bulk upsert at startup.
 * Subsequent calls are no-ops because of ON CONFLICT DO NOTHING.
 * Security note: The `code` field stores raw admin-provided HTML/JS for AdSense.
 * This is intentional — the admin role is treated as a trusted code publisher.
 * Access to PUT /admin/adsense-slots/:position is strictly guarded by admin auth.
 */
async function seedSlots() {
  await db
    .insert(adsenseSlotsTable)
    .values(ADSENSE_POSITIONS.map(pos => ({ position: pos })))
    .onConflictDoNothing();
}

// Seed once at module load so handlers never need to wait.
seedSlots().catch((err) => {
  console.error("Failed to seed adsense_slots:", err);
});

function serialize(s: typeof adsenseSlotsTable.$inferSelect) {
  return {
    id: s.id,
    position: s.position,
    code: s.code,
    enabled: s.enabled,
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Public: return all slots (frontend only renders enabled ones).
router.get("/adsense-slots", async (_req, res): Promise<void> => {
  try {
    const slots = await db.select().from(adsenseSlotsTable);
    res.json(slots.map(serialize));
  } catch (err) {
    console.error("GET /adsense-slots error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: update a single slot by position.
router.put("/admin/adsense-slots/:position", async (req, res): Promise<void> => {
  try {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const position = req.params.position as AdsensePosition;
    if (!ADSENSE_POSITIONS.includes(position)) {
      res.status(400).json({ error: `Invalid position. Must be one of: ${ADSENSE_POSITIONS.join(", ")}` });
      return;
    }

    const b = req.body ?? {};
    const updates: Partial<typeof adsenseSlotsTable.$inferInsert> = {};
    if (b.code !== undefined) updates.code = String(b.code);
    if (typeof b.enabled === "boolean") updates.enabled = b.enabled;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const [slot] = await db
      .update(adsenseSlotsTable)
      .set(updates)
      .where(eq(adsenseSlotsTable.position, position))
      .returning();

    if (!slot) {
      res.status(404).json({ error: "Slot not found" });
      return;
    }

    await writeAudit(actor, "update", "adsense_slot", slot.id);
    res.json(serialize(slot));
  } catch (err) {
    console.error("PUT /admin/adsense-slots error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
