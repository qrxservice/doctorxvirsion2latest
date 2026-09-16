import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bloodDonorRequestsTable = pgTable("blood_donor_requests", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull(),
  donorId: integer("donor_id").notNull(),
  bloodGroup: text("blood_group").notNull(),
  message: text("message"),
  status: text("status").notNull().default("pending"), // pending | accepted | rejected
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBloodDonorRequestSchema = createInsertSchema(bloodDonorRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBloodDonorRequest = z.infer<typeof insertBloodDonorRequestSchema>;
export type BloodDonorRequest = typeof bloodDonorRequestsTable.$inferSelect;

export const emergencyBloodRequestsTable = pgTable("emergency_blood_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  bloodGroup: text("blood_group").notNull(),
  quantity: text("quantity").notNull(),
  hospital: text("hospital").notNull(),
  city: text("city").notNull(),
  contactNumber: text("contact_number").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"), // open | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmergencyBloodRequestSchema = createInsertSchema(emergencyBloodRequestsTable).omit({ id: true, createdAt: true });
export type InsertEmergencyBloodRequest = z.infer<typeof insertEmergencyBloodRequestSchema>;
export type EmergencyBloodRequest = typeof emergencyBloodRequestsTable.$inferSelect;

// ─── Blood Donor Chat ─────────────────────────────────────────────────────────

/** One private channel created automatically when a blood request is accepted. */
export const bloodDonorConversationsTable = pgTable("blood_donor_conversations", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),   // FK → blood_donor_requests.id
  requesterId: integer("requester_id").notNull(),
  donorId: integer("donor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BloodDonorConversation = typeof bloodDonorConversationsTable.$inferSelect;

/** Messages inside a blood-donor conversation channel. */
export const bloodDonorMessagesTable = pgTable("blood_donor_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BloodDonorMessage = typeof bloodDonorMessagesTable.$inferSelect;
