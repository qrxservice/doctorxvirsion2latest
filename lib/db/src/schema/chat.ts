import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatConversationsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  doctor1Id: integer("doctor1_id").notNull(),
  doctor2Id: integer("doctor2_id").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatConversationSchema = createInsertSchema(chatConversationsTable).omit({ id: true, createdAt: true });
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversationsTable.$inferSelect;

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderDoctorId: integer("sender_doctor_id").notNull(),
  message: text("message"),
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  attachmentSize: integer("attachment_size"),
  isRead: boolean("is_read").default(false),
  isDeleted: boolean("is_deleted").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
