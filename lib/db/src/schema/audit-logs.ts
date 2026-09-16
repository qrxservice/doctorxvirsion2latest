import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Cross-role audit trail: prescription edits and doctor/assistant/admin actions.
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id"),
  actorRole: text("actor_role"),
  actorName: text("actor_name"),
  // e.g. "create" | "update" | "delete" | "reset_password" | "import" | "rollback"
  action: text("action").notNull(),
  // e.g. "prescription" | "doctor" | "assistant" | "appointment" | "advertisement"
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
