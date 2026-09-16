import { Router, type IRouter } from "express";
import { eq, or, and, desc } from "drizzle-orm";
import { db, chatConversationsTable, chatMessagesTable, doctorConnectionsTable, usersTable, doctorsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getDoctorFromAuth(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) return null;
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
    return doc ?? null;
  } catch { return null; }
}

async function getConversationForDoctor(convId: number, doctorId: number) {
  if (!Number.isInteger(convId)) return null;
  const [conv] = await db.select().from(chatConversationsTable).where(eq(chatConversationsTable.id, convId));
  if (!conv) return null;
  if (conv.doctor1Id !== doctorId && conv.doctor2Id !== doctorId) return null;
  return conv;
}

async function areFriends(doctorId1: number, doctorId2: number): Promise<boolean> {
  const [conn] = await db.select().from(doctorConnectionsTable).where(
    and(
      or(
        and(eq(doctorConnectionsTable.requesterDoctorId, doctorId1), eq(doctorConnectionsTable.receiverDoctorId, doctorId2)),
        and(eq(doctorConnectionsTable.requesterDoctorId, doctorId2), eq(doctorConnectionsTable.receiverDoctorId, doctorId1))
      ),
      eq(doctorConnectionsTable.status, "accepted")
    )
  );
  return !!conn;
}

router.get("/chat/conversations", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const convs = await db.select().from(chatConversationsTable).where(
    or(eq(chatConversationsTable.doctor1Id, doc.id), eq(chatConversationsTable.doctor2Id, doc.id))
  ).orderBy(desc(chatConversationsTable.lastMessageAt));

  const enriched = await Promise.all(convs.map(async c => {
    const otherId = c.doctor1Id === doc.id ? c.doctor2Id : c.doctor1Id;
    const [other] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, otherId));
    const [lastMsg] = await db.select().from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.conversationId, c.id), eq(chatMessagesTable.isDeleted, false)))
      .orderBy(desc(chatMessagesTable.createdAt)).limit(1);
    const unreadCount = (await db.select().from(chatMessagesTable).where(
      and(eq(chatMessagesTable.conversationId, c.id), eq(chatMessagesTable.isRead, false), eq(chatMessagesTable.isDeleted, false))
    )).filter(m => m.senderDoctorId !== doc.id).length;
    return { ...c, otherDoctor: other ? { id: other.id, name: other.name, photoUrl: other.photoUrl, onlineStatus: other.onlineStatus } : null, lastMessage: lastMsg ?? null, unreadCount };
  }));
  res.json(enriched);
});

router.post("/chat/conversations", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { otherDoctorId } = req.body;
  if (!otherDoctorId) { res.status(400).json({ error: "otherDoctorId required" }); return; }
  const ok = await areFriends(doc.id, otherDoctorId);
  if (!ok) { res.status(403).json({ error: "You must be friends to chat" }); return; }
  const existing = await db.select().from(chatConversationsTable).where(
    or(
      and(eq(chatConversationsTable.doctor1Id, doc.id), eq(chatConversationsTable.doctor2Id, otherDoctorId)),
      and(eq(chatConversationsTable.doctor1Id, otherDoctorId), eq(chatConversationsTable.doctor2Id, doc.id))
    )
  );
  if (existing.length > 0) { res.json(existing[0]); return; }
  const [conv] = await db.insert(chatConversationsTable).values({ doctor1Id: doc.id, doctor2Id: otherDoctorId }).returning();
  res.status(201).json(conv);
});

router.get("/chat/:conversationId/messages", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const convId = parseInt(req.params.conversationId);
  const conv = await getConversationForDoctor(convId, doc.id);
  if (!conv) { res.status(403).json({ error: "Not a participant in this conversation" }); return; }
  const page = parseInt((req.query.page as string) || "1");
  const limit = 50;
  const offset = (page - 1) * limit;
  const messages = await db.select().from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.conversationId, convId), eq(chatMessagesTable.isDeleted, false)))
    .orderBy(desc(chatMessagesTable.createdAt)).limit(limit).offset(offset);
  await db.update(chatMessagesTable).set({ isRead: true }).where(
    and(eq(chatMessagesTable.conversationId, convId), eq(chatMessagesTable.isRead, false))
  );
  res.json(messages.reverse());
});

router.post("/chat/:conversationId/messages", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const convId = parseInt(req.params.conversationId);
  const conv = await getConversationForDoctor(convId, doc.id);
  if (!conv) { res.status(403).json({ error: "Not a participant in this conversation" }); return; }
  const { message, attachmentUrl, attachmentType, attachmentName, attachmentSize } = req.body;
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (attachmentUrl !== undefined && attachmentUrl !== null && (typeof attachmentUrl !== "string" || !attachmentUrl.startsWith("/objects/"))) {
    res.status(400).json({ error: "Invalid attachment reference" });
    return;
  }
  if (!trimmed && !attachmentUrl) { res.status(400).json({ error: "message or attachment required" }); return; }
  const [msg] = await db.insert(chatMessagesTable).values({
    conversationId: convId,
    senderDoctorId: doc.id,
    message: trimmed || null,
    attachmentUrl: attachmentUrl || null,
    attachmentType: typeof attachmentType === "string" ? attachmentType.slice(0, 100) : null,
    attachmentName: typeof attachmentName === "string" ? attachmentName.slice(0, 255) : null,
    attachmentSize: typeof attachmentSize === "number" ? attachmentSize : null,
  }).returning();
  await db.update(chatConversationsTable).set({ lastMessageAt: new Date() }).where(eq(chatConversationsTable.id, convId));
  res.status(201).json(msg);
});

router.delete("/chat/messages/:id", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const msgId = parseInt(req.params.id);
  await db.update(chatMessagesTable).set({ isDeleted: true }).where(
    and(eq(chatMessagesTable.id, msgId), eq(chatMessagesTable.senderDoctorId, doc.id))
  );
  res.json({ message: "Deleted" });
});

export default router;
