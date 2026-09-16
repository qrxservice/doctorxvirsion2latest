import { Router, type IRouter } from "express";
import { eq, or, and, desc, count } from "drizzle-orm";
import {
  db,
  doctorConnectionsTable,
  notificationsTable,
  usersTable,
  doctorsTable,
  patientReferralsTable,
  doctorConsultationsTable,
  chatMessagesTable,
  chatConversationsTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getDoctorFromAuth(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) return null;
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
    return doc ? { ...doc, userId: user.id } : null;
  } catch { return null; }
}

async function isConnected(doctorId1: number, doctorId2: number): Promise<boolean> {
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

// ─── Network Stats Dashboard ───────────────────────────────────────────────

router.get("/network/stats", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [connections, pendingReceived, pendingSent, referralsSent, referralsReceived, consultationsSent, consultationsReceived] = await Promise.all([
    db.select({ count: count() }).from(doctorConnectionsTable).where(
      and(or(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.receiverDoctorId, doc.id)), eq(doctorConnectionsTable.status, "accepted"))
    ),
    db.select({ count: count() }).from(doctorConnectionsTable).where(
      and(eq(doctorConnectionsTable.receiverDoctorId, doc.id), eq(doctorConnectionsTable.status, "pending"))
    ),
    db.select({ count: count() }).from(doctorConnectionsTable).where(
      and(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.status, "pending"))
    ),
    db.select({ count: count() }).from(patientReferralsTable).where(eq(patientReferralsTable.referrerDoctorId, doc.id)),
    db.select({ count: count() }).from(patientReferralsTable).where(eq(patientReferralsTable.receiverDoctorId, doc.id)),
    db.select({ count: count() }).from(doctorConsultationsTable).where(eq(doctorConsultationsTable.requesterDoctorId, doc.id)),
    db.select({ count: count() }).from(doctorConsultationsTable).where(
      and(eq(doctorConsultationsTable.consultantDoctorId, doc.id), eq(doctorConsultationsTable.status, "pending"))
    ),
  ]);

  // Count unread messages across all conversations
  const convs = await db.select().from(chatConversationsTable).where(
    or(eq(chatConversationsTable.doctor1Id, doc.id), eq(chatConversationsTable.doctor2Id, doc.id))
  );
  let unreadMessages = 0;
  for (const conv of convs) {
    const msgs = await db.select().from(chatMessagesTable).where(
      and(eq(chatMessagesTable.conversationId, conv.id), eq(chatMessagesTable.isRead, false), eq(chatMessagesTable.isDeleted, false))
    );
    unreadMessages += msgs.filter(m => m.senderDoctorId !== doc.id).length;
  }

  res.json({
    totalConnections: Number(connections[0]?.count ?? 0),
    pendingRequestsReceived: Number(pendingReceived[0]?.count ?? 0),
    pendingRequestsSent: Number(pendingSent[0]?.count ?? 0),
    referralsSent: Number(referralsSent[0]?.count ?? 0),
    referralsReceived: Number(referralsReceived[0]?.count ?? 0),
    consultationsSent: Number(consultationsSent[0]?.count ?? 0),
    consultationsPending: Number(consultationsReceived[0]?.count ?? 0),
    unreadMessages,
  });
});

// ─── Patient Referrals ─────────────────────────────────────────────────────

router.get("/referrals", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [sent, received] = await Promise.all([
    db.select().from(patientReferralsTable)
      .where(eq(patientReferralsTable.referrerDoctorId, doc.id))
      .orderBy(desc(patientReferralsTable.createdAt)),
    db.select().from(patientReferralsTable)
      .where(eq(patientReferralsTable.receiverDoctorId, doc.id))
      .orderBy(desc(patientReferralsTable.createdAt)),
  ]);

  // Enrich with doctor info
  const enrichReferral = async (r: typeof sent[0], perspective: "sent" | "received") => {
    const otherId = perspective === "sent" ? r.receiverDoctorId : r.referrerDoctorId;
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, otherId));
    return { ...r, doctor: d ? { id: d.id, name: d.name, degree: d.degree, photoUrl: d.photoUrl, isVerified: d.isVerified } : null };
  };

  const [sentEnriched, receivedEnriched] = await Promise.all([
    Promise.all(sent.map(r => enrichReferral(r, "sent"))),
    Promise.all(received.map(r => enrichReferral(r, "received"))),
  ]);

  res.json({ sent: sentEnriched, received: receivedEnriched });
});

router.post("/referrals", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { receiverDoctorId, patientName, patientPhone, patientAge, patientGender, referralReason, notes } = req.body;
  if (!receiverDoctorId || !patientName || !referralReason) {
    res.status(400).json({ error: "receiverDoctorId, patientName and referralReason are required" }); return;
  }
  if (doc.id === receiverDoctorId) { res.status(400).json({ error: "Cannot refer to yourself" }); return; }

  const connected = await isConnected(doc.id, receiverDoctorId);
  if (!connected) { res.status(403).json({ error: "You must be connected to refer a patient" }); return; }

  const [referral] = await db.insert(patientReferralsTable).values({
    referrerDoctorId: doc.id,
    receiverDoctorId,
    patientName,
    patientPhone: patientPhone || null,
    patientAge: patientAge ? Number(patientAge) : null,
    patientGender: patientGender || null,
    referralReason,
    notes: notes || null,
    status: "pending",
  }).returning();

  // Notify receiver
  const [receiverUser] = await db.select().from(usersTable).where(eq(usersTable.doctorId, receiverDoctorId));
  if (receiverUser) {
    await db.insert(notificationsTable).values({
      userId: receiverUser.id,
      type: "referral",
      title: "New Patient Referral",
      message: `Dr. ${doc.name} referred patient ${patientName} to you`,
      relatedId: referral.id,
    });
  }

  res.status(201).json(referral);
});

router.patch("/referrals/:id/status", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const referralId = parseInt(req.params.id);
  const { status } = req.body;
  if (!["pending", "reviewed", "closed"].includes(status)) {
    res.status(400).json({ error: "Invalid status" }); return;
  }
  const [updated] = await db.update(patientReferralsTable)
    .set({ status })
    .where(and(eq(patientReferralsTable.id, referralId), eq(patientReferralsTable.receiverDoctorId, doc.id)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Referral not found" }); return; }
  res.json(updated);
});

// ─── Specialist Consultations ──────────────────────────────────────────────

router.get("/consultations", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [sent, received] = await Promise.all([
    db.select().from(doctorConsultationsTable)
      .where(eq(doctorConsultationsTable.requesterDoctorId, doc.id))
      .orderBy(desc(doctorConsultationsTable.createdAt)),
    db.select().from(doctorConsultationsTable)
      .where(eq(doctorConsultationsTable.consultantDoctorId, doc.id))
      .orderBy(desc(doctorConsultationsTable.createdAt)),
  ]);

  const enrichConsultation = async (c: typeof sent[0], perspective: "sent" | "received") => {
    const otherId = perspective === "sent" ? c.consultantDoctorId : c.requesterDoctorId;
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, otherId));
    return { ...c, doctor: d ? { id: d.id, name: d.name, degree: d.degree, photoUrl: d.photoUrl, isVerified: d.isVerified } : null };
  };

  const [sentEnriched, receivedEnriched] = await Promise.all([
    Promise.all(sent.map(c => enrichConsultation(c, "sent"))),
    Promise.all(received.map(c => enrichConsultation(c, "received"))),
  ]);

  res.json({ sent: sentEnriched, received: receivedEnriched });
});

router.post("/consultations", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { consultantDoctorId, patientInfo, caseNotes, attachmentUrl, attachmentType, attachmentName, attachmentSize } = req.body;
  if (!consultantDoctorId || !caseNotes) {
    res.status(400).json({ error: "consultantDoctorId and caseNotes are required" }); return;
  }
  if (doc.id === consultantDoctorId) { res.status(400).json({ error: "Cannot consult yourself" }); return; }

  const connected = await isConnected(doc.id, consultantDoctorId);
  if (!connected) { res.status(403).json({ error: "You must be connected to request consultation" }); return; }

  if (attachmentUrl !== undefined && attachmentUrl !== null && (typeof attachmentUrl !== "string" || !attachmentUrl.startsWith("/objects/"))) {
    res.status(400).json({ error: "Invalid attachment reference" }); return;
  }

  const [consultation] = await db.insert(doctorConsultationsTable).values({
    requesterDoctorId: doc.id,
    consultantDoctorId,
    patientInfo: patientInfo || null,
    caseNotes,
    attachmentUrl: attachmentUrl || null,
    attachmentType: typeof attachmentType === "string" ? attachmentType.slice(0, 100) : null,
    attachmentName: typeof attachmentName === "string" ? attachmentName.slice(0, 255) : null,
    attachmentSize: typeof attachmentSize === "number" ? attachmentSize : null,
    status: "pending",
  }).returning();

  // Notify consultant
  const [consultantUser] = await db.select().from(usersTable).where(eq(usersTable.doctorId, consultantDoctorId));
  if (consultantUser) {
    await db.insert(notificationsTable).values({
      userId: consultantUser.id,
      type: "consultation_request",
      title: "Second Opinion Request",
      message: `Dr. ${doc.name} is requesting your second opinion on a case`,
      relatedId: consultation.id,
    });
  }

  res.status(201).json(consultation);
});

router.patch("/consultations/:id", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const consultationId = parseInt(req.params.id);
  const { responseNotes, status } = req.body;

  // Must be the consultant to respond
  const [existing] = await db.select().from(doctorConsultationsTable)
    .where(and(eq(doctorConsultationsTable.id, consultationId), eq(doctorConsultationsTable.consultantDoctorId, doc.id)));
  if (!existing) { res.status(404).json({ error: "Consultation not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (responseNotes !== undefined) updateData.responseNotes = responseNotes;
  if (status && ["pending", "reviewed", "closed"].includes(status)) updateData.status = status;
  if (!Object.keys(updateData).length) { res.status(400).json({ error: "Nothing to update" }); return; }

  const [updated] = await db.update(doctorConsultationsTable).set(updateData).where(eq(doctorConsultationsTable.id, consultationId)).returning();

  // Notify requester when responded
  if (responseNotes || status === "reviewed") {
    const [requesterUser] = await db.select().from(usersTable).where(eq(usersTable.doctorId, existing.requesterDoctorId));
    if (requesterUser) {
      await db.insert(notificationsTable).values({
        userId: requesterUser.id,
        type: "consultation_response",
        title: "Second Opinion Received",
        message: `Dr. ${doc.name} responded to your consultation request`,
        relatedId: consultationId,
      });
    }
  }

  res.json(updated);
});

export default router;
