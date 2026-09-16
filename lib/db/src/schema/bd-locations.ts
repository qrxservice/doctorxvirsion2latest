import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const bdDivisionsTable = pgTable("doctorx_bd_divisions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bnName: text("bn_name"),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bdDistrictsTable = pgTable("doctorx_bd_districts", {
  id: serial("id").primaryKey(),
  divisionId: integer("division_id")
    .notNull()
    .references(() => bdDivisionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bnName: text("bn_name"),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bdUpazilasTable = pgTable("doctorx_bd_upazilas", {
  id: serial("id").primaryKey(),
  districtId: integer("district_id")
    .notNull()
    .references(() => bdDistrictsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bnName: text("bn_name"),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
