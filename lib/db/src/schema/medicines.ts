import { pgTable, text, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const medicinesTable = pgTable("medicines", {
  id: serial("id").primaryKey(),
  brandName: text("brand_name").notNull(),
  genericName: text("generic_name"),
  strength: text("strength"),
  dosageForm: text("dosage_form"),
  manufacturer: text("manufacturer"),
}, (t) => ({
  brandIdx: index("medicines_brand_idx").on(t.brandName),
  genericIdx: index("medicines_generic_idx").on(t.genericName),
}));

export const insertMedicineSchema = createInsertSchema(medicinesTable).omit({ id: true });
export type InsertMedicine = z.infer<typeof insertMedicineSchema>;
export type Medicine = typeof medicinesTable.$inferSelect;
