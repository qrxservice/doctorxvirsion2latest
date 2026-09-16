import { Router, type IRouter } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { eq, sql } from "drizzle-orm";
import { db, medicinesTable, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

async function getRole(auth: string | undefined): Promise<string | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    // Trust the persisted role, not the token's role claim.
    return user?.role ?? null;
  } catch { return null; }
}

router.get("/medicines", async (req, res): Promise<void> => {
  const { q, limit = "20" } = req.query as Record<string, string>;
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  if (!q || q.trim().length < 1) {
    const all = await db.select().from(medicinesTable).orderBy(medicinesTable.brandName).limit(limitNum);
    res.json(all);
    return;
  }

  const term = q.trim();
  const prefix = `${term}%`;
  const contains = `%${term}%`;

  // Match across brand, generic, strength and dosage form; rank prefix/brand
  // matches ahead of substring matches, then alphabetically by brand.
  const results = await db
    .select()
    .from(medicinesTable)
    .where(
      sql`(
        ${medicinesTable.brandName} ILIKE ${contains}
        OR ${medicinesTable.genericName} ILIKE ${contains}
        OR ${medicinesTable.strength} ILIKE ${contains}
        OR ${medicinesTable.dosageForm} ILIKE ${contains}
      )`,
    )
    .orderBy(
      sql`
        CASE
          WHEN ${medicinesTable.brandName} ILIKE ${prefix} THEN 0
          WHEN ${medicinesTable.genericName} ILIKE ${prefix} THEN 1
          WHEN ${medicinesTable.brandName} ILIKE ${contains} THEN 2
          WHEN ${medicinesTable.genericName} ILIKE ${contains} THEN 3
          ELSE 4
        END
      `,
      medicinesTable.brandName,
    )
    .limit(limitNum);

  res.json(results);
});

router.post("/medicines", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { brandName, genericName, strength, dosageForm, manufacturer } = req.body;
  if (!brandName) { res.status(400).json({ error: "Brand name required" }); return; }
  const [med] = await db.insert(medicinesTable).values({ brandName, genericName, strength, dosageForm, manufacturer }).returning();
  res.status(201).json(med);
});


router.post("/medicines/bulk-import", upload.single("file"), async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);

  if (role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "CSV file is required" });
    return;
  }

  try {
    const records = parse(req.file.buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];

    if (!records.length) {
      res.status(400).json({ error: "CSV file is empty" });
      return;
    }

    const requiredColumns = ["brandName", "genericName", "strength", "dosageForm", "manufacturer"];
    const headers = Object.keys(records[0]);

    if (!headers.includes("brandName")) {
      res.status(400).json({
        error: "Invalid CSV format",
        requiredColumns,
        receivedColumns: headers,
      });
      return;
    }

    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    const batchSize = 500;

    for (let start = 0; start < records.length; start += batchSize) {
      const batch = records.slice(start, start + batchSize);
      const validRows: Array<{
        brandName: string;
        genericName?: string;
        strength?: string;
        dosageForm?: string;
        manufacturer?: string;
      }> = [];

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const rowNumber = start + i + 2;

        const brandName = String(row.brandName ?? "").trim();

        if (!brandName) {
          skipped++;
          errors.push({ row: rowNumber, error: "Brand name is required" });
          continue;
        }

        validRows.push({
          brandName,
          genericName: String(row.genericName ?? "").trim() || undefined,
          strength: String(row.strength ?? "").trim() || undefined,
          dosageForm: String(row.dosageForm ?? "").trim() || undefined,
          manufacturer: String(row.manufacturer ?? "").trim() || undefined,
        });
      }

      if (!validRows.length) continue;

      for (const medicine of validRows) {
        const existing = await db
          .select({ id: medicinesTable.id })
          .from(medicinesTable)
          .where(
            sql`
              lower(trim(${medicinesTable.brandName})) = lower(trim(${medicine.brandName}))
              AND coalesce(lower(trim(${medicinesTable.genericName})), '') = coalesce(lower(trim(${medicine.genericName ?? ""})), '')
              AND coalesce(lower(trim(${medicinesTable.strength})), '') = coalesce(lower(trim(${medicine.strength ?? ""})), '')
              AND coalesce(lower(trim(${medicinesTable.dosageForm})), '') = coalesce(lower(trim(${medicine.dosageForm ?? ""})), '')
              AND coalesce(lower(trim(${medicinesTable.manufacturer})), '') = coalesce(lower(trim(${medicine.manufacturer ?? ""})), '')
            `,
          )
          .limit(1);

        if (existing.length) {
          duplicates++;
          continue;
        }

        await db.insert(medicinesTable).values(medicine);
        imported++;
      }
    }

    res.json({
      success: true,
      totalRows: records.length,
      imported,
      duplicates,
      skipped,
      errors: errors.slice(0, 100),
    });
  } catch (error) {
    console.error("Medicine bulk import failed:", error);

    res.status(500).json({
      error: "Medicine bulk import failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.put("/medicines/:id", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  const { brandName, genericName, strength, dosageForm, manufacturer } = req.body;
  if (!brandName) { res.status(400).json({ error: "Brand name required" }); return; }
  const [med] = await db
    .update(medicinesTable)
    .set({ brandName, genericName, strength, dosageForm, manufacturer })
    .where(eq(medicinesTable.id, id))
    .returning();
  if (!med) { res.status(404).json({ error: "Not found" }); return; }
  res.json(med);
});

router.delete("/medicines/:id", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(medicinesTable).where(eq(medicinesTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
