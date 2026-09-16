import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A single import run in the data-migration center.
export const migrationBatchesTable = pgTable("migration_batches", {
  id: serial("id").primaryKey(),
  // patients | medicines | appointments
  entityType: text("entity_type").notNull(),
  fileName: text("file_name"),
  format: text("format"),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  // completed | rolled_back
  status: text("status").notNull().default("completed"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-row pointer so a batch can be rolled back (deletes the imported entities).
export const migrationRecordsTable = pgTable("migration_records", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMigrationBatchSchema = createInsertSchema(migrationBatchesTable).omit({ id: true, createdAt: true });
export type InsertMigrationBatch = z.infer<typeof insertMigrationBatchSchema>;
export type MigrationBatch = typeof migrationBatchesTable.$inferSelect;
export type MigrationRecord = typeof migrationRecordsTable.$inferSelect;
