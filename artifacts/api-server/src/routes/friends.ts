import { Router, type IRouter } from "express";
import { eq, or, and } from "drizzle-orm";
import { db, doctorConnectionsTable, notificationsTable, usersTable, doctorsTable } from "@workspace/db";
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

router.get("/friends", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const conns = await db.select().from(doctorConnectionsTable).where(
    and(
      or(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.receiverDoctorId, doc.id)),
      eq(doctorConnectionsTable.status, "accepted")
    )
  );
  const friendIds = conns.map(c => c.requesterDoctorId === doc.id ? c.receiverDoctorId : c.requesterDoctorId);
  const friends = friendIds.length > 0
    ? await Promise.all(friendIds.map(id => db.select().from(doctorsTable).where(eq(doctorsTable.id, id)).then(r => r[0])))
    : [];
  res.json(friends.filter(Boolean).map(f => ({ id: f.id, name: f.name, degree: f.degree, photoUrl: f.photoUrl, onlineStatus: f.onlineStatus, specialtyId: f.specialtyId })));
});

router.get("/friend-requests", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const received = await db.select().from(doctorConnectionsTable).where(
    and(eq(doctorConnectionsTable.receiverDoctorId, doc.id), eq(doctorConnectionsTable.status, "pending"))
  );
  const sent = await db.select().from(doctorConnectionsTable).where(
    and(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.status, "pending"))
  );
  const receivedWithDoctors = await Promise.all(received.map(async r => {
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, r.requesterDoctorId));
    return { ...r, doctor: d ? { id: d.id, name: d.name, degree: d.degree, photoUrl: d.photoUrl } : null };
  }));
  res.json({ received: receivedWithDoctors, sent });
});

router.post("/doctors/:id/friend-request", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const receiverId = parseInt(req.params.id);
  if (doc.id === receiverId) { res.status(400).json({ error: "Cannot add yourself" }); return; }
  const existing = await db.select().from(doctorConnectionsTable).where(
    or(
      and(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.receiverDoctorId, receiverId)),
      and(eq(doctorConnectionsTable.requesterDoctorId, receiverId), eq(doctorConnectionsTable.receiverDoctorId, doc.id))
    )
  );
  if (existing.length > 0) { res.status(409).json({ error: "Request already exists", status: existing[0].status }); return; }
  const [conn] = await db.insert(doctorConnectionsTable).values({ requesterDoctorId: doc.id, receiverDoctorId: receiverId, status: "pending" }).returning();
  const [receiver] = await db.select().from(usersTable).where(eq(usersTable.doctorId, receiverId));
  if (receiver) {
    await db.insert(notificationsTable).values({
      userId: receiver.id, type: "friend_request",
      title: "New Friend Request", message: `Dr. ${doc.name} sent you a friend request`, relatedId: conn.id,
    });
  }
  res.status(201).json(conn);
});

router.post("/friends/:id/accept", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const connId = parseInt(req.params.id);
  const [conn] = await db.update(doctorConnectionsTable).set({ status: "accepted" })
    .where(and(eq(doctorConnectionsTable.id, connId), eq(doctorConnectionsTable.receiverDoctorId, doc.id))).returning();
  if (!conn) { res.status(404).json({ error: "Request not found" }); return; }
  const [requester] = await db.select().from(usersTable).where(eq(usersTable.doctorId, conn.requesterDoctorId));
  if (requester) {
    await db.insert(notificationsTable).values({
      userId: requester.id, type: "friend_accepted",
      title: "Friend Request Accepted", message: `Dr. ${doc.name} accepted your friend request`, relatedId: conn.id,
    });
  }
  res.json(conn);
});

router.post("/friends/:id/reject", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const connId = parseInt(req.params.id);
  await db.delete(doctorConnectionsTable).where(eq(doctorConnectionsTable.id, connId));
  res.status(204).end();
});

router.delete("/friends/:id/cancel", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.status(401).json({ error: "Not authenticated" }); return; }
  const connId = parseInt(req.params.id);
  const [conn] = await db.select().from(doctorConnectionsTable).where(
    and(eq(doctorConnectionsTable.id, connId), eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.status, "pending"))
  );
  if (!conn) { res.status(404).json({ error: "Pending request not found" }); return; }
  await db.delete(doctorConnectionsTable).where(eq(doctorConnectionsTable.id, connId));
  res.status(204).end();
});

router.get("/doctors/:id/connection-status", async (req, res): Promise<void> => {
  const doc = await getDoctorFromAuth(req.headers.authorization);
  if (!doc) { res.json({ status: "none" }); return; }
  const targetId = parseInt(req.params.id);
  const [conn] = await db.select().from(doctorConnectionsTable).where(
    or(
      and(eq(doctorConnectionsTable.requesterDoctorId, doc.id), eq(doctorConnectionsTable.receiverDoctorId, targetId)),
      and(eq(doctorConnectionsTable.requesterDoctorId, targetId), eq(doctorConnectionsTable.receiverDoctorId, doc.id))
    )
  );
  if (!conn) { res.json({ status: "none" }); return; }
  if (conn.status === "accepted") { res.json({ status: "accepted", connectionId: conn.id }); return; }
  if (conn.requesterDoctorId === doc.id) { res.json({ status: "pending_sent", connectionId: conn.id }); return; }
  res.json({ status: "pending_received", connectionId: conn.id });
});

export default router;
