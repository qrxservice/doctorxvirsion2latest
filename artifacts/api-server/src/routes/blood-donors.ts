import { Router, type IRouter } from "express";
import { eq, and, or, sql, desc } from "drizzle-orm";
import {
  db, usersTable, bloodDonorRequestsTable, emergencyBloodRequestsTable,
  notificationsTable, bloodDonorConversationsTable, bloodDonorMessagesTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { notify, notifyAdmins } from "../lib/notify";

const router: IRouter = Router();

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function getOptionalUser(auth: string | undefined) {
  if (!auth) return null;
  try { return verifyAuthToken(auth); } catch { return null; }
}

function safeDonorProfile(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    bloodGroup: user.bloodGroup,
    country: user.country,
    division: user.division,
    district: user.district,
    area: user.area,
    donorStatus: user.donorStatus,
    lastDonationDate: user.lastDonationDate,
    profilePicture: user.profilePicture,
  };
}

// ─── Public: Search Donors ───────────────────────────────────────────────────

router.get("/blood-donors", async (req, res): Promise<void> => {
  const { bloodGroup, country, division, district, area } = req.query as Record<string, string>;

  const conditions = [
    eq(usersTable.isDonor, "true"),
    eq(usersTable.donorStatus, "available"),
  ];
  if (bloodGroup && BLOOD_GROUPS.includes(bloodGroup)) conditions.push(eq(usersTable.bloodGroup, bloodGroup));
  if (country) conditions.push(eq(usersTable.country, country));
  if (division) conditions.push(eq(usersTable.division, division));
  if (district) conditions.push(eq(usersTable.district, district));
  if (area) conditions.push(eq(usersTable.area, area));

  const donors = await db.select().from(usersTable).where(and(...conditions)).limit(100);
  res.json({ donors: donors.map(safeDonorProfile) });
});

// ─── Public: Nearby Donors ───────────────────────────────────────────────────

router.get("/blood-donors/nearby", async (req, res): Promise<void> => {
  const { bloodGroup, country, division, district, area } = req.query as Record<string, string>;

  const conditions = [
    eq(usersTable.isDonor, "true"),
    eq(usersTable.donorStatus, "available"),
  ];
  if (bloodGroup && BLOOD_GROUPS.includes(bloodGroup)) conditions.push(eq(usersTable.bloodGroup, bloodGroup));

  const donors = await db.select().from(usersTable).where(and(...conditions)).limit(200);

  const scored = donors.map(d => {
    let score = 0;
    if (area && d.area && d.area.toLowerCase() === area.toLowerCase()) score = 4;
    else if (district && d.district && d.district.toLowerCase() === district.toLowerCase()) score = 3;
    else if (division && d.division && d.division.toLowerCase() === division.toLowerCase()) score = 2;
    else if (country && d.country && d.country.toLowerCase() === country.toLowerCase()) score = 1;
    return { ...d, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  res.json({ donors: scored.slice(0, 50).map(d => safeDonorProfile(d)) });
});

// ─── Auth: Send Blood Request ────────────────────────────────────────────────

router.post("/blood-requests", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Login required to request blood" }); return; }

  const { donorId, bloodGroup, message } = req.body;
  if (!donorId || !bloodGroup) { res.status(400).json({ error: "donorId and bloodGroup required" }); return; }
  if (claims.userId === parseInt(donorId)) { res.status(400).json({ error: "Cannot request blood from yourself" }); return; }

  const [donor] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, parseInt(donorId)),
    eq(usersTable.isDonor, "true"),
    eq(usersTable.donorStatus, "available"),
  ));
  if (!donor) { res.status(404).json({ error: "Donor not found or not available" }); return; }

  const existing = await db.select({ id: bloodDonorRequestsTable.id })
    .from(bloodDonorRequestsTable)
    .where(and(
      eq(bloodDonorRequestsTable.requesterId, claims.userId),
      eq(bloodDonorRequestsTable.donorId, parseInt(donorId)),
      eq(bloodDonorRequestsTable.status, "pending"),
    ));
  if (existing.length > 0) { res.status(409).json({ error: "You already have a pending request to this donor" }); return; }

  const [request] = await db.insert(bloodDonorRequestsTable).values({
    requesterId: claims.userId,
    donorId: parseInt(donorId),
    bloodGroup,
    message: message ?? null,
    status: "pending",
  }).returning();

  const [requester] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, claims.userId));
  await notify(
    parseInt(donorId),
    "blood_request",
    "🩸 Blood Request Received",
    `${requester?.name ?? "Someone"} needs ${bloodGroup} blood. Open Blood Requests to respond.`,
    request.id,
  );

  res.status(201).json(request);
});

// ─── Auth: List My Blood Requests ────────────────────────────────────────────

router.get("/patient/blood-requests", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }

  const outgoing = await db.select().from(bloodDonorRequestsTable)
    .where(eq(bloodDonorRequestsTable.requesterId, claims.userId))
    .orderBy(desc(bloodDonorRequestsTable.createdAt));

  const incoming = await db.select().from(bloodDonorRequestsTable)
    .where(eq(bloodDonorRequestsTable.donorId, claims.userId))
    .orderBy(desc(bloodDonorRequestsTable.createdAt));

  const userIds = new Set([
    ...outgoing.map(r => r.donorId),
    ...incoming.map(r => r.requesterId),
  ]);

  const users = userIds.size > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, bloodGroup: usersTable.bloodGroup, phone: usersTable.phone })
        .from(usersTable).where(sql`${usersTable.id} = ANY(ARRAY[${Array.from(userIds).join(",")}]::int[])`)
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  // Load conversations for accepted requests to attach conversationId
  const acceptedIds = [
    ...outgoing.filter(r => r.status === "accepted").map(r => r.id),
    ...incoming.filter(r => r.status === "accepted").map(r => r.id),
  ];
  const convs = acceptedIds.length > 0
    ? await db.select().from(bloodDonorConversationsTable)
        .where(sql`${bloodDonorConversationsTable.requestId} = ANY(ARRAY[${acceptedIds.join(",")}]::int[])`)
    : [];
  const convByRequest = Object.fromEntries(convs.map(c => [c.requestId, c.id]));

  const enrich = (r: typeof outgoing[0], contactUserId: number, showContact: boolean) => ({
    ...r,
    conversationId: convByRequest[r.id] ?? null,
    contactUser: (showContact || r.status === "accepted")
      ? userMap[contactUserId]
      : { id: contactUserId, name: userMap[contactUserId]?.name, bloodGroup: userMap[contactUserId]?.bloodGroup },
  });

  res.json({
    incoming: incoming.map(r => enrich(r, r.requesterId, true)),
    outgoing: outgoing.map(r => enrich(r, r.donorId, true)),
  });
});

// ─── Auth: Accept / Reject Request ──────────────────────────────────────────

router.patch("/blood-requests/:id", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!["accepted", "rejected", "completed"].includes(status)) {
    res.status(400).json({ error: "status must be accepted, rejected, or completed" }); return;
  }

  const [existing] = await db.select().from(bloodDonorRequestsTable).where(eq(bloodDonorRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Request not found" }); return; }

  // Only the donor can accept/reject; either party can mark completed
  if (status !== "completed" && existing.donorId !== claims.userId) {
    res.status(403).json({ error: "Not your request to respond to" }); return;
  }
  if (status === "completed" && existing.requesterId !== claims.userId && existing.donorId !== claims.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (existing.status === "pending" && status === "completed") {
    res.status(409).json({ error: "Cannot complete a pending request" }); return;
  }
  if ((status === "accepted" || status === "rejected") && existing.status !== "pending") {
    res.status(409).json({ error: "Request already responded to" }); return;
  }

  const [updated] = await db.update(bloodDonorRequestsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(bloodDonorRequestsTable.id, id))
    .returning();

  const [donor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, existing.donorId));
  const [requester] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, existing.requesterId));

  if (status === "accepted") {
    // Auto-create private conversation channel
    const [conv] = await db.insert(bloodDonorConversationsTable).values({
      requestId: id,
      requesterId: existing.requesterId,
      donorId: existing.donorId,
    }).returning();

    // Notify requester
    await notify(
      existing.requesterId,
      "blood_request_accepted",
      "🩸 Blood Request Accepted!",
      `${donor?.name ?? "A donor"} accepted your blood request. You can now chat to arrange the donation.`,
      conv.id,
    );
    res.json({ ...updated, conversationId: conv.id }); return;
  }

  if (status === "rejected") {
    await notify(
      existing.requesterId,
      "blood_request_rejected",
      "Blood Request Declined",
      `Your blood request was declined by ${donor?.name ?? "the donor"}. Please try another donor.`,
      id,
    );
  }

  if (status === "completed") {
    const otherUserId = claims.userId === existing.requesterId ? existing.donorId : existing.requesterId;
    await notify(
      otherUserId,
      "blood_donation_completed",
      "🎉 Donation Marked Complete",
      `${claims.userId === existing.requesterId ? requester?.name : donor?.name} marked the donation as completed. Thank you!`,
      id,
    );
  }

  res.json(updated);
});

// ─── Auth: Blood Donor Conversations ─────────────────────────────────────────

/** List all conversations the current user is part of (requester or donor). */
router.get("/blood-conversations", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }

  const convs = await db.select().from(bloodDonorConversationsTable)
    .where(or(
      eq(bloodDonorConversationsTable.requesterId, claims.userId),
      eq(bloodDonorConversationsTable.donorId, claims.userId),
    ))
    .orderBy(desc(bloodDonorConversationsTable.createdAt));

  if (!convs.length) { res.json({ conversations: [] }); return; }

  // Enrich with other-party name + blood request info
  const peerIds = convs.map(c => c.requesterId === claims.userId ? c.donorId : c.requesterId);
  const requestIds = convs.map(c => c.requestId);

  const [peers, requests, unreadRows] = await Promise.all([
    db.select({ id: usersTable.id, name: usersTable.name, bloodGroup: usersTable.bloodGroup })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${[...new Set(peerIds)].join(",")}]::int[])`),
    db.select().from(bloodDonorRequestsTable)
      .where(sql`${bloodDonorRequestsTable.id} = ANY(ARRAY[${requestIds.join(",")}]::int[])`),
    db.select({
      conversationId: bloodDonorMessagesTable.conversationId,
      count: sql<number>`count(*)::int`,
    })
      .from(bloodDonorMessagesTable)
      .where(and(
        eq(bloodDonorMessagesTable.isRead, false),
        sql`${bloodDonorMessagesTable.conversationId} = ANY(ARRAY[${convs.map(c => c.id).join(",")}]::int[])`,
        sql`${bloodDonorMessagesTable.senderId} != ${claims.userId}`,
      ))
      .groupBy(bloodDonorMessagesTable.conversationId),
  ]);

  const peerMap = Object.fromEntries(peers.map(p => [p.id, p]));
  const reqMap = Object.fromEntries(requests.map(r => [r.id, r]));
  const unreadMap = Object.fromEntries(unreadRows.map(r => [r.conversationId, r.count]));

  const result = convs.map(c => ({
    ...c,
    peer: peerMap[c.requesterId === claims.userId ? c.donorId : c.requesterId],
    bloodRequest: reqMap[c.requestId],
    unreadCount: unreadMap[c.id] ?? 0,
  }));

  res.json({ conversations: result });
});

/** Get messages in a conversation (authenticated, must be a participant). */
router.get("/blood-conversations/:id/messages", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }

  const convId = parseInt(req.params.id);
  const [conv] = await db.select().from(bloodDonorConversationsTable).where(eq(bloodDonorConversationsTable.id, convId));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (conv.requesterId !== claims.userId && conv.donorId !== claims.userId) {
    res.status(403).json({ error: "Not a participant" }); return;
  }

  // Mark incoming unread messages as read
  await db.update(bloodDonorMessagesTable)
    .set({ isRead: true })
    .where(and(
      eq(bloodDonorMessagesTable.conversationId, convId),
      eq(bloodDonorMessagesTable.isRead, false),
      sql`${bloodDonorMessagesTable.senderId} != ${claims.userId}`,
    ));

  const messages = await db.select().from(bloodDonorMessagesTable)
    .where(eq(bloodDonorMessagesTable.conversationId, convId))
    .orderBy(bloodDonorMessagesTable.createdAt)
    .limit(200);

  res.json({ messages, conversationId: convId });
});

/** Send a message in a conversation. */
router.post("/blood-conversations/:id/messages", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }

  const convId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

  const [conv] = await db.select().from(bloodDonorConversationsTable).where(eq(bloodDonorConversationsTable.id, convId));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (conv.requesterId !== claims.userId && conv.donorId !== claims.userId) {
    res.status(403).json({ error: "Not a participant" }); return;
  }

  const [msg] = await db.insert(bloodDonorMessagesTable).values({
    conversationId: convId,
    senderId: claims.userId,
    message: message.trim(),
  }).returning();

  // Notify the other party
  const recipientId = conv.requesterId === claims.userId ? conv.donorId : conv.requesterId;
  const [sender] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, claims.userId));
  await notify(
    recipientId,
    "blood_chat_message",
    `💬 New message from ${sender?.name ?? "your contact"}`,
    message.trim().length > 80 ? message.trim().slice(0, 80) + "…" : message.trim(),
    convId,
  );

  res.status(201).json(msg);
});

// ─── Public: Emergency Blood Request ─────────────────────────────────────────

router.post("/emergency-blood-requests", async (req, res): Promise<void> => {
  const claims = getOptionalUser(req.headers.authorization);

  const { bloodGroup, quantity, hospital, city, contactNumber, notes } = req.body;
  if (!bloodGroup || !quantity || !hospital || !city || !contactNumber) {
    res.status(400).json({ error: "bloodGroup, quantity, hospital, city, and contactNumber are required" }); return;
  }

  const [request] = await db.insert(emergencyBloodRequestsTable).values({
    userId: claims?.userId ?? null,
    bloodGroup, quantity, hospital, city, contactNumber,
    notes: notes ?? null,
    status: "open",
  }).returning();

  const matchingDonors = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.isDonor, "true"),
      eq(usersTable.donorStatus, "available"),
      eq(usersTable.bloodGroup, bloodGroup),
    )).limit(50);

  if (matchingDonors.length > 0) {
    await db.insert(notificationsTable).values(
      matchingDonors.map(d => ({
        userId: d.id,
        type: "emergency_blood_request",
        title: `🚨 Emergency: ${bloodGroup} Blood Needed`,
        message: `Urgent ${bloodGroup} blood needed at ${hospital}, ${city}. Contact: ${contactNumber}`,
        relatedId: request.id,
      }))
    );
  }

  await notifyAdmins(
    "emergency_blood_request",
    `Emergency Blood Request: ${bloodGroup}`,
    `${bloodGroup} blood needed at ${hospital}, ${city}. Contact: ${contactNumber}`,
    request.id,
  );

  res.status(201).json({ ...request, donorsNotified: matchingDonors.length });
});

// ─── Admin: Blood Donor Stats ─────────────────────────────────────────────────

router.get("/admin/blood-donors", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims || claims.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const donors = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    phone: usersTable.phone, bloodGroup: usersTable.bloodGroup,
    country: usersTable.country, division: usersTable.division,
    district: usersTable.district, area: usersTable.area,
    isDonor: usersTable.isDonor, donorStatus: usersTable.donorStatus,
    lastDonationDate: usersTable.lastDonationDate,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.isDonor, "true"));

  const total = donors.length;
  const active = donors.filter(d => d.donorStatus === "available").length;
  res.json({ donors, stats: { total, active } });
});

router.patch("/admin/blood-donors/:userId/disable", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims || claims.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const userId = parseInt(req.params.userId);
  const [updated] = await db.update(usersTable)
    .set({ isDonor: "false", donorStatus: "inactive", updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, isDonor: usersTable.isDonor, donorStatus: usersTable.donorStatus });

  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(updated);
});

router.get("/admin/emergency-blood-requests", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims || claims.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const requests = await db.select().from(emergencyBloodRequestsTable)
    .orderBy(sql`${emergencyBloodRequestsTable.createdAt} DESC`).limit(200);
  res.json({ requests });
});

router.patch("/admin/emergency-blood-requests/:id/close", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims || claims.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const id = parseInt(req.params.id);
  const [updated] = await db.update(emergencyBloodRequestsTable)
    .set({ status: "closed" })
    .where(eq(emergencyBloodRequestsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

export default router;
