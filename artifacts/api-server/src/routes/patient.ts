import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db, usersTable, appointmentsTable, prescriptionsTable, prescriptionItemsTable, doctorsTable,
  userAddressesTable, shopOrdersTable, shopOrderItemsTable, shopProductsTable,
  notificationsTable, shopWishlistTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

function getPatientUser(auth: string | undefined) {
  if (!auth) return null;
  try {
    const claims = verifyAuthToken(auth);
    if (!claims || claims.role !== "patient") return null;
    return claims;
  } catch {
    return null;
  }
}

function serializeProfile(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    phone: user.phone, dateOfBirth: user.dateOfBirth, gender: user.gender,
    bloodGroup: user.bloodGroup, address: user.address,
    country: user.country, division: user.division, district: user.district, area: user.area,
    profilePicture: user.profilePicture, emergencyContact: user.emergencyContact,
    nationality: user.nationality, preferredLanguage: user.preferredLanguage,
    isDonor: user.isDonor ?? "false",
    donorStatus: user.donorStatus ?? "inactive",
    lastDonationDate: user.lastDonationDate,
    createdAt: user.createdAt,
  };
}

// Doctor-accessible: look up a patient's profile picture and blood group by phone number.
router.get("/doctor/patient-photo", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims || claims.role === "patient") { res.status(401).json({ error: "Unauthorized" }); return; }
  const phone = (req.query.phone as string | undefined)?.trim();
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const [user] = await db.select({
    profilePicture: usersTable.profilePicture,
    bloodGroup: usersTable.bloodGroup,
  })
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);
  res.json({ profilePicture: user?.profilePicture ?? null, bloodGroup: user?.bloodGroup ?? null });
});

router.get("/patient/profile", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(serializeProfile(user));
});

router.patch("/patient/profile", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const {
    name, phone, dateOfBirth, gender, bloodGroup, address,
    country, division, district, area,
    profilePicture, emergencyContact, nationality, preferredLanguage,
    isDonor, donorStatus, lastDonationDate,
  } = req.body;
  const [updated] = await db.update(usersTable)
    .set({
      name, phone, dateOfBirth, gender, bloodGroup, address,
      country, division, district, area,
      profilePicture, emergencyContact, nationality, preferredLanguage,
      isDonor, donorStatus, lastDonationDate,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, claims.userId))
    .returning();
  res.json(serializeProfile(updated));
});

router.get("/patient/appointments", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.phone) { res.json({ appointments: [] }); return; }

  const appts = await db
    .select({
      id: appointmentsTable.id,
      patientName: appointmentsTable.patientName,
      patientPhone: appointmentsTable.patientPhone,
      appointmentDate: appointmentsTable.appointmentDate,
      appointmentTime: appointmentsTable.appointmentTime,
      serialNo: appointmentsTable.serialNo,
      status: appointmentsTable.status,
      complaint: appointmentsTable.complaint,
      trackingToken: appointmentsTable.trackingToken,
      createdAt: appointmentsTable.createdAt,
      doctorName: doctorsTable.name,
      doctorSpecialty: doctorsTable.specialtyId,
      chamberAddress: doctorsTable.chamberAddress,
    })
    .from(appointmentsTable)
    .leftJoin(doctorsTable, eq(appointmentsTable.doctorId, doctorsTable.id))
    .where(eq(appointmentsTable.patientPhone, user.phone))
    .orderBy(desc(appointmentsTable.createdAt))
    .limit(50);

  res.json({ appointments: appts });
});

router.get("/patient/prescriptions", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.phone) { res.json({ prescriptions: [] }); return; }

  const rxList = await db
    .select({
      id: prescriptionsTable.id,
      referenceNo: prescriptionsTable.referenceNo,
      patientName: prescriptionsTable.patientName,
      patientPhone: prescriptionsTable.patientPhone,
      patientAge: prescriptionsTable.patientAge,
      diagnosis: prescriptionsTable.diagnosis,
      chiefComplaint: prescriptionsTable.chiefComplaint,
      followUpDate: prescriptionsTable.followUpDate,
      createdAt: prescriptionsTable.createdAt,
      doctorName: doctorsTable.name,
      doctorSpecialty: doctorsTable.specialtyId,
    })
    .from(prescriptionsTable)
    .leftJoin(doctorsTable, eq(prescriptionsTable.doctorId, doctorsTable.id))
    .where(eq(prescriptionsTable.patientPhone, user.phone))
    .orderBy(desc(prescriptionsTable.createdAt))
    .limit(50);

  res.json({ prescriptions: rxList });
});

router.get("/patient/prescriptions/:id", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user || !user.phone) { res.status(403).json({ error: "Forbidden" }); return; }

  const [rx] = await db
    .select()
    .from(prescriptionsTable)
    .leftJoin(doctorsTable, eq(prescriptionsTable.doctorId, doctorsTable.id))
    .where(and(eq(prescriptionsTable.id, parseInt(req.params.id)), eq(prescriptionsTable.patientPhone, user.phone)));

  if (!rx) { res.status(404).json({ error: "Prescription not found" }); return; }

  const items = await db.select().from(prescriptionItemsTable)
    .where(eq(prescriptionItemsTable.prescriptionId, parseInt(req.params.id)));

  res.json({ prescription: rx.prescriptions, doctor: rx.doctors, items });
});

// Dashboard summary stats
router.get("/patient/stats", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  let totalAppointments = 0;
  let upcomingAppointments = 0;
  let prescriptionCount = 0;
  const today = new Date().toISOString().split("T")[0];

  if (user.phone) {
    const appts = await db.select({ status: appointmentsTable.status, appointmentDate: appointmentsTable.appointmentDate })
      .from(appointmentsTable).where(eq(appointmentsTable.patientPhone, user.phone));
    totalAppointments = appts.length;
    upcomingAppointments = appts.filter(a => a.status !== "cancelled" && a.status !== "completed" && a.appointmentDate >= today).length;

    const [{ count: rxCount }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(prescriptionsTable).where(eq(prescriptionsTable.patientPhone, user.phone));
    prescriptionCount = rxCount;
  }

  const orders = await db.select({ status: shopOrdersTable.status }).from(shopOrdersTable)
    .where(eq(shopOrdersTable.userId, user.id));
  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.status === "pending" || o.status === "confirmed" || o.status === "processing").length;

  const unreadNotifications = await db.select({ id: notificationsTable.id }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  res.json({
    totalAppointments, upcomingAppointments, totalOrders, pendingOrders,
    prescriptionCount, unreadNotifications: unreadNotifications.length,
  });
});

// ---- Saved / Shipping Addresses ----
router.get("/patient/addresses", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const addresses = await db.select().from(userAddressesTable)
    .where(eq(userAddressesTable.userId, claims.userId))
    .orderBy(desc(userAddressesTable.isDefault), desc(userAddressesTable.createdAt));
  res.json({ addresses });
});

router.post("/patient/addresses", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { label, recipientName, phone, altPhone, country, division, district, upazila, postalCode, fullAddress, isDefault } = req.body;
  if (!recipientName || !phone || !fullAddress) { res.status(400).json({ error: "recipientName, phone and fullAddress are required" }); return; }

  if (isDefault) {
    await db.update(userAddressesTable).set({ isDefault: false }).where(eq(userAddressesTable.userId, claims.userId));
  }

  const existing = await db.select({ id: userAddressesTable.id }).from(userAddressesTable).where(eq(userAddressesTable.userId, claims.userId));
  const [address] = await db.insert(userAddressesTable).values({
    userId: claims.userId, label: label || "Home", recipientName, phone, altPhone,
    country, division, district, upazila, postalCode, fullAddress,
    isDefault: isDefault ?? existing.length === 0,
  }).returning();
  res.status(201).json(address);
});

router.patch("/patient/addresses/:id", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  const { label, recipientName, phone, altPhone, country, division, district, upazila, postalCode, fullAddress, isDefault } = req.body;

  if (isDefault) {
    await db.update(userAddressesTable).set({ isDefault: false }).where(eq(userAddressesTable.userId, claims.userId));
  }

  const [updated] = await db.update(userAddressesTable).set({
    label, recipientName, phone, altPhone, country, division, district, upazila, postalCode, fullAddress,
    isDefault, updatedAt: new Date(),
  }).where(and(eq(userAddressesTable.id, id), eq(userAddressesTable.userId, claims.userId))).returning();

  if (!updated) { res.status(404).json({ error: "Address not found" }); return; }
  res.json(updated);
});

router.delete("/patient/addresses/:id", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(userAddressesTable)
    .where(and(eq(userAddressesTable.id, parseInt(req.params.id)), eq(userAddressesTable.userId, claims.userId)));
  res.json({ message: "Deleted" });
});

router.post("/patient/addresses/:id/default", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  await db.update(userAddressesTable).set({ isDefault: false }).where(eq(userAddressesTable.userId, claims.userId));
  const [updated] = await db.update(userAddressesTable).set({ isDefault: true })
    .where(and(eq(userAddressesTable.id, id), eq(userAddressesTable.userId, claims.userId))).returning();
  if (!updated) { res.status(404).json({ error: "Address not found" }); return; }
  res.json(updated);
});

// ---- My Orders (patient portal alias) ----
router.get("/patient/orders", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orders = await db.select().from(shopOrdersTable)
    .where(eq(shopOrdersTable.userId, claims.userId))
    .orderBy(desc(shopOrdersTable.createdAt));
  const ordersWithItems = await Promise.all(orders.map(async (order) => {
    const items = await db.select().from(shopOrderItemsTable).where(eq(shopOrderItemsTable.orderId, order.id));
    const itemsWithProducts = await Promise.all(items.map(async (item) => {
      const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, item.productId));
      return { ...item, product };
    }));
    return { ...order, items: itemsWithProducts };
  }));
  res.json({ orders: ordersWithItems });
});

// ---- Notifications (patient portal alias) ----
router.get("/patient/notifications", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, claims.userId))
    .orderBy(desc(notificationsTable.createdAt)).limit(50);
  const unreadCount = notifs.filter(n => !n.isRead).length;
  res.json({ notifications: notifs, unreadCount });
});

router.post("/patient/notifications/:id/read", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, parseInt(req.params.id)), eq(notificationsTable.userId, claims.userId)));
  res.json({ message: "Marked as read" });
});

router.post("/patient/notifications/read-all", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, claims.userId));
  res.json({ message: "All marked as read" });
});

// ---- Wishlist ----
router.get("/patient/wishlist", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(shopWishlistTable).where(eq(shopWishlistTable.userId, claims.userId));
  const items = await Promise.all(rows.map(async (row) => {
    const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, row.productId));
    return { id: row.id, productId: row.productId, product };
  }));
  res.json({ items });
});

router.post("/patient/wishlist", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { productId } = req.body;
  if (!productId) { res.status(400).json({ error: "productId required" }); return; }
  const existing = await db.select().from(shopWishlistTable)
    .where(and(eq(shopWishlistTable.userId, claims.userId), eq(shopWishlistTable.productId, productId)));
  if (existing.length > 0) { res.status(409).json(existing[0]); return; }
  const [row] = await db.insert(shopWishlistTable).values({ userId: claims.userId, productId }).returning();
  res.status(201).json(row);
});

router.delete("/patient/wishlist/:productId", async (req, res): Promise<void> => {
  const claims = getPatientUser(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(shopWishlistTable)
    .where(and(eq(shopWishlistTable.userId, claims.userId), eq(shopWishlistTable.productId, parseInt(req.params.productId))));
  res.json({ message: "Removed" });
});

export default router;
