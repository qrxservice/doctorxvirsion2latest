import { sendEmail } from "../lib/messaging";
/**
 * Ambulance Dispatch System — API Routes
 * Phases 2–15: Driver portal, GPS tracking, user booking, SOS, admin command centre, revenue, security
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc, sql, ne, gte, lte } from "drizzle-orm";
import {
  db, usersTable,
  ambulanceDriversTable, ambulanceVehiclesTable, driverLocationsTable,
  ambulanceRequestsTable, ambulanceRatingsTable, ambulanceSettingsTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { notify, notifyAdmins } from "../lib/notify";
import { writeAudit } from "../lib/admin";
import { broadcastAmbulanceEvent } from "../lib/socketManager";

const router: IRouter = Router();

// ─── In-memory rate limiter (SOS / booking — prevent abuse) ──────────────────
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(windowMs: number, max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).ip ?? "unknown";
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.status(429).json({ error: "Too many requests. Please wait and try again." });
      return;
    }
    next();
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireAuth(req: any, res: any): { userId: number; role: string } | null {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return claims;
}

function requireRole(req: any, res: any, ...roles: string[]): { userId: number; role: string } | null {
  const claims = requireAuth(req, res);
  if (!claims) return null;
  if (!roles.includes(claims.role)) { res.status(403).json({ error: "Forbidden" }); return null; }
  return claims;
}

async function getOrCreateSettings() {
  const [existing] = await db.select().from(ambulanceSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(ambulanceSettingsTable).values({}).returning();
  return created;
}

async function enrichRequest(req: typeof ambulanceRequestsTable.$inferSelect) {
  const [driver] = req.driverId
    ? await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, req.driverId))
    : [null];
  const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone })
    .from(usersTable).where(eq(usersTable.id, req.userId));
  const loc = req.driverId
    ? (await db.select().from(driverLocationsTable).where(eq(driverLocationsTable.driverId, req.driverId!)))[0] ?? null
    : null;
  return { ...req, driver: driver ?? null, user: user ?? null, driverLocation: loc };
}

/** Midnight today (local) */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Start of current ISO week (Monday) */
function weekStart(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** First day of current month */
function monthStart(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── AMBULANCE SETTINGS (Admin) ───────────────────────────────────────────────

router.get("/ambulance/settings", async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.put("/ambulance/settings", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const settings = await getOrCreateSettings();
  const {
    commissionEnabled, commissionRate, subscriptionEnabled,
    featuredListingEnabled, driverVerificationFeeEnabled, driverVerificationFeeAmount,
    baseFareBdt, perKmRateBdt, offlineTimeoutMinutes, requestTimeoutSeconds,
  } = req.body;
  const [updated] = await db.update(ambulanceSettingsTable)
    .set({
      commissionEnabled: commissionEnabled ?? settings.commissionEnabled,
      commissionRate: commissionRate ?? settings.commissionRate,
      subscriptionEnabled: subscriptionEnabled ?? settings.subscriptionEnabled,
      featuredListingEnabled: featuredListingEnabled ?? settings.featuredListingEnabled,
      driverVerificationFeeEnabled: driverVerificationFeeEnabled ?? settings.driverVerificationFeeEnabled,
      driverVerificationFeeAmount: driverVerificationFeeAmount ?? settings.driverVerificationFeeAmount,
      baseFareBdt: baseFareBdt ?? settings.baseFareBdt,
      perKmRateBdt: perKmRateBdt ?? settings.perKmRateBdt,
      offlineTimeoutMinutes: offlineTimeoutMinutes ?? settings.offlineTimeoutMinutes,
      requestTimeoutSeconds: requestTimeoutSeconds ?? settings.requestTimeoutSeconds,
    })
    .where(eq(ambulanceSettingsTable.id, settings.id))
    .returning();
  await writeAudit({ userId: claims.userId, role: "admin", name: null, doctorId: null }, "ambulance_settings_update", "ambulance_settings", settings.id);
  res.json(updated);
});

// ─── DRIVER REGISTRATION & PROFILE ───────────────────────────────────────────

// Register as driver (creates user account with role=driver + driver profile)
router.post("/ambulance/drivers/register", async (req, res): Promise<void> => {
  const {
    name, email, password, phone,
    dateOfBirth, address, division, district, upazila, serviceRadius,
    nidNumber, nidPhoto, nidBackPhoto, selfiePhoto,
    licenceNumber, licencePhoto, licenceExpiry,
    profilePhoto,
  } = req.body;
  if (!name || !email || !password || !phone) {
    res.status(400).json({ error: "name, email, password and phone are required" }); return;
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length) { res.status(409).json({ error: "Email already registered" }); return; }

  const { hashPassword } = await import("../lib/password");
  const hashed = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({ name, email, password: hashed, role: "driver", phone }).returning();
  const [driver] = await db.insert(ambulanceDriversTable).values({
    userId: user.id, name, email, phone,
    dateOfBirth: dateOfBirth ?? null, address: address ?? null,
    division: division ?? null, district: district ?? null, upazila: upazila ?? null,
    serviceRadius: serviceRadius ? parseInt(serviceRadius) : 20,
    nidNumber: nidNumber ?? null, nidPhoto: nidPhoto ?? null,
    nidBackPhoto: nidBackPhoto ?? null, selfiePhoto: selfiePhoto ?? null,
    licenceNumber: licenceNumber ?? null, licencePhoto: licencePhoto ?? null,
    licenceExpiry: licenceExpiry ?? null,
    profilePhoto: profilePhoto ?? null,
  }).returning();

  // Create vehicle record if registration data was supplied during sign-up
  const { vehicleType, registrationNumber, model, vehicleModel, vehiclePhoto, seatingCapacity } = req.body;
  if (registrationNumber) {
    await db.insert(ambulanceVehiclesTable).values({
      driverId: driver.id,
      vehicleType: vehicleType ?? "basic",
      registrationNumber,
      model: model ?? vehicleModel ?? null,
      vehiclePhoto: vehiclePhoto ?? null,
      seatingCapacity: seatingCapacity ? parseInt(seatingCapacity) : null,
    });
  }

  await notifyAdmins("ambulance_driver_pending", "New Ambulance Driver Registration", `${name} registered as an ambulance driver and awaits approval.`, driver.id);

  // Email driver that registration was received and is awaiting approval
  sendEmail(
    email,
    "DoctorX — Driver Registration Received",
    `Hello ${name},

Your DoctorX ambulance driver registration has been received successfully.

Your application is currently pending admin approval.

You will receive another email when your application is approved or rejected.

Thank you for registering with DoctorX.

— DoctorX`
  ).catch(() => {});

  res.status(201).json({ message: "Registration submitted. Awaiting admin approval.", driverId: driver.id });
});

// Get own driver profile
router.get("/ambulance/drivers/me", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const vehicles = await db.select().from(ambulanceVehiclesTable).where(eq(ambulanceVehiclesTable.driverId, driver.id));
  const [loc] = await db.select().from(driverLocationsTable).where(eq(driverLocationsTable.driverId, driver.id));
  res.json({ ...driver, vehicles, location: loc ?? null });
});

// Update own driver profile
router.put("/ambulance/drivers/me", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const {
    name, phone, profilePhoto,
    dateOfBirth, address, division, district, upazila, serviceRadius,
    nidNumber, nidPhoto, nidBackPhoto, selfiePhoto,
    licenceNumber, licencePhoto, licenceExpiry,
  } = req.body;
  const [updated] = await db.update(ambulanceDriversTable)
    .set({
      name: name ?? driver.name,
      phone: phone ?? driver.phone,
      profilePhoto: profilePhoto ?? driver.profilePhoto,
      dateOfBirth: dateOfBirth ?? driver.dateOfBirth,
      address: address ?? driver.address,
      division: division ?? driver.division,
      district: district ?? driver.district,
      upazila: upazila ?? driver.upazila,
      serviceRadius: serviceRadius != null ? parseInt(serviceRadius) : driver.serviceRadius,
      nidNumber: nidNumber ?? driver.nidNumber,
      nidPhoto: nidPhoto ?? driver.nidPhoto,
      nidBackPhoto: nidBackPhoto ?? driver.nidBackPhoto,
      selfiePhoto: selfiePhoto ?? driver.selfiePhoto,
      licenceNumber: licenceNumber ?? driver.licenceNumber,
      licencePhoto: licencePhoto ?? driver.licencePhoto,
      licenceExpiry: licenceExpiry ?? driver.licenceExpiry,
    })
    .where(eq(ambulanceDriversTable.id, driver.id)).returning();
  res.json(updated);
});

// Driver: toggle online/offline status
router.put("/ambulance/drivers/me/status", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  if (driver.approvalStatus !== "approved") {
    res.status(403).json({ error: "Driver not approved yet" }); return;
  }
  const { status } = req.body; // "online" | "offline"
  if (!["online", "offline"].includes(status)) {
    res.status(400).json({ error: "status must be online or offline" }); return;
  }
  const [updated] = await db.update(ambulanceDriversTable)
    .set({ onlineStatus: status, lastActiveAt: new Date() })
    .where(eq(ambulanceDriversTable.id, driver.id)).returning();
  broadcastAmbulanceEvent("driver:status_changed", { driverId: driver.id, status });
  res.json({ onlineStatus: updated.onlineStatus });
});

// Driver: update GPS location
router.put("/ambulance/drivers/me/location", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const { lat, lng, heading, speed } = req.body;
  if (lat == null || lng == null) { res.status(400).json({ error: "lat and lng required" }); return; }

  // Upsert location
  const existing = await db.select().from(driverLocationsTable).where(eq(driverLocationsTable.driverId, driver.id));
  let loc;
  if (existing.length) {
    [loc] = await db.update(driverLocationsTable)
      .set({ lat, lng, heading: heading ?? null, speed: speed ?? null })
      .where(eq(driverLocationsTable.driverId, driver.id)).returning();
  } else {
    [loc] = await db.insert(driverLocationsTable).values({ driverId: driver.id, lat, lng, heading, speed }).returning();
  }

  // Update lastActiveAt
  await db.update(ambulanceDriversTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(ambulanceDriversTable.id, driver.id));

  // Broadcast to admin and any active request room
  broadcastAmbulanceEvent("driver:location_updated", { driverId: driver.id, lat, lng, heading, speed });

  // Auto-set online if driver is sending GPS and was offline
  if (driver.onlineStatus === "offline" && driver.approvalStatus === "approved") {
    await db.update(ambulanceDriversTable).set({ onlineStatus: "online" }).where(eq(ambulanceDriversTable.id, driver.id));
  }

  res.json(loc);
});

// Driver: get active request
// Returns the driver's own active trip first; if none, falls back to the most
// recent unassigned pending request so the driver can accept/reject it.
router.get("/ambulance/drivers/me/active-request", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }

  // Priority 1: driver's own active trip (any non-terminal status)
  const [active] = await db.select().from(ambulanceRequestsTable)
    .where(and(
      eq(ambulanceRequestsTable.driverId, driver.id),
      sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled')`,
    ))
    .orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(1);
  if (active) { res.json(await enrichRequest(active)); return; }

  // Priority 2: most recent unassigned pending request (visible to all online approved drivers)
  if (driver.approvalStatus === "approved" && driver.onlineStatus !== "offline") {
    const [pending] = await db.select().from(ambulanceRequestsTable)
      .where(and(
        sql`${ambulanceRequestsTable.driverId} IS NULL`,
        eq(ambulanceRequestsTable.status, "pending"),
      ))
      .orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(1);
    if (pending) { res.json(await enrichRequest(pending)); return; }
  }

  res.json(null);
});

// Driver: trip history (with optional date filters)
router.get("/ambulance/drivers/me/trips", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }

  const { from, to } = req.query as Record<string, string>;
  const conditions = [
    eq(ambulanceRequestsTable.driverId, driver.id),
    eq(ambulanceRequestsTable.status, "completed"),
  ];
  if (from) conditions.push(gte(ambulanceRequestsTable.completedAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(ambulanceRequestsTable.completedAt, toDate));
  }

  const trips = await db.select().from(ambulanceRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(ambulanceRequestsTable.completedAt)).limit(100);
  res.json(trips);
});

// Driver: dashboard stats (today / weekly / monthly breakdowns)
router.get("/ambulance/drivers/me/stats", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }

  const today = todayStart();
  const week = weekStart();
  const month = monthStart();

  const baseWhere = and(
    eq(ambulanceRequestsTable.driverId, driver.id),
    eq(ambulanceRequestsTable.status, "completed"),
  );

  const [todayRow] = await db.select({
    trips: sql<number>`count(*)::int`,
    earnings: sql<number>`coalesce(sum(actual_fare), 0)::int`,
  }).from(ambulanceRequestsTable).where(and(baseWhere!, gte(ambulanceRequestsTable.completedAt, today)));

  const [weekRow] = await db.select({
    trips: sql<number>`count(*)::int`,
    earnings: sql<number>`coalesce(sum(actual_fare), 0)::int`,
  }).from(ambulanceRequestsTable).where(and(baseWhere!, gte(ambulanceRequestsTable.completedAt, week)));

  const [monthRow] = await db.select({
    trips: sql<number>`count(*)::int`,
    earnings: sql<number>`coalesce(sum(actual_fare), 0)::int`,
  }).from(ambulanceRequestsTable).where(and(baseWhere!, gte(ambulanceRequestsTable.completedAt, month)));

  const settings = await getOrCreateSettings();
  const commissionRate = driver.commissionRate ?? (settings.commissionEnabled ? settings.commissionRate : 0);

  const gross = driver.totalEarnings;
  const commission = Math.round(gross * commissionRate / 100);
  const net = gross - commission;

  res.json({
    today: { trips: todayRow?.trips ?? 0, earnings: todayRow?.earnings ?? 0 },
    week: { trips: weekRow?.trips ?? 0, earnings: weekRow?.earnings ?? 0 },
    month: { trips: monthRow?.trips ?? 0, earnings: monthRow?.earnings ?? 0 },
    total: { trips: driver.totalTrips, earnings: driver.totalEarnings },
    commission: { rate: commissionRate, amount: commission },
    net,
    walletBalance: driver.walletBalance,
  });
});

// Driver: my ratings
router.get("/ambulance/drivers/me/ratings", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const ratings = await db.select({
    id: ambulanceRatingsTable.id,
    rating: ambulanceRatingsTable.rating,
    review: ambulanceRatingsTable.review,
    createdAt: ambulanceRatingsTable.createdAt,
    requestId: ambulanceRatingsTable.requestId,
    userName: usersTable.name,
  })
    .from(ambulanceRatingsTable)
    .leftJoin(usersTable, eq(usersTable.id, ambulanceRatingsTable.userId))
    .where(eq(ambulanceRatingsTable.driverId, driver.id))
    .orderBy(desc(ambulanceRatingsTable.createdAt))
    .limit(50);
  res.json({ avgRating: driver.avgRating, ratingCount: driver.ratingCount, ratings });
});

// ─── VEHICLES ─────────────────────────────────────────────────────────────────

router.post("/ambulance/vehicles", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const { vehicleType, registrationNumber, vehiclePhoto, make, model, year, seatingCapacity } = req.body;
  if (!vehicleType || !registrationNumber) {
    res.status(400).json({ error: "vehicleType and registrationNumber required" }); return;
  }
  const [vehicle] = await db.insert(ambulanceVehiclesTable)
    .values({ driverId: driver.id, vehicleType, registrationNumber, vehiclePhoto, make, model, year, seatingCapacity: seatingCapacity ?? null }).returning();
  res.status(201).json(vehicle);
});

router.put("/ambulance/vehicles/:id", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver profile not found" }); return; }
  const vehicleId = parseInt(req.params.id);
  const [vehicle] = await db.select().from(ambulanceVehiclesTable)
    .where(and(eq(ambulanceVehiclesTable.id, vehicleId), eq(ambulanceVehiclesTable.driverId, driver.id)));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const { vehicleType, registrationNumber, vehiclePhoto, make, model, year, isActive, seatingCapacity } = req.body;
  const [updated] = await db.update(ambulanceVehiclesTable)
    .set({
      vehicleType: vehicleType ?? vehicle.vehicleType,
      registrationNumber: registrationNumber ?? vehicle.registrationNumber,
      vehiclePhoto: vehiclePhoto ?? vehicle.vehiclePhoto,
      make: make ?? vehicle.make,
      model: model ?? vehicle.model,
      year: year ?? vehicle.year,
      isActive: isActive ?? vehicle.isActive,
      seatingCapacity: seatingCapacity ?? vehicle.seatingCapacity,
    })
    .where(eq(ambulanceVehiclesTable.id, vehicleId)).returning();
  res.json(updated);
});

// ─── USER: NEARBY AMBULANCES ──────────────────────────────────────────────────

// Public: list available drivers with their location (for map)
router.get("/ambulance/available", async (req, res): Promise<void> => {
  const { vehicleType, lat, lng } = req.query as Record<string, string>;
  let drivers = await db.select({
    driver: ambulanceDriversTable,
    location: driverLocationsTable,
    vehicle: ambulanceVehiclesTable,
  })
    .from(ambulanceDriversTable)
    .leftJoin(driverLocationsTable, eq(driverLocationsTable.driverId, ambulanceDriversTable.id))
    .leftJoin(ambulanceVehiclesTable, and(
      eq(ambulanceVehiclesTable.driverId, ambulanceDriversTable.id),
      eq(ambulanceVehiclesTable.isActive, true),
    ))
    .where(and(
      eq(ambulanceDriversTable.approvalStatus, "approved"),
      eq(ambulanceDriversTable.onlineStatus, "online"),
    ));

  if (vehicleType) drivers = drivers.filter(d => d.vehicle?.vehicleType === vehicleType);

  // Sort by distance if user location provided
  if (lat && lng) {
    const userLat = parseFloat(lat), userLng = parseFloat(lng);
    drivers = drivers
      .filter(d => d.location)
      .map(d => {
        const dlat = (d.location!.lat - userLat) * 111.32;
        const dlng = (d.location!.lng - userLng) * 111.32 * Math.cos(userLat * Math.PI / 180);
        return { ...d, distanceKm: Math.sqrt(dlat * dlat + dlng * dlng) };
      })
      .sort((a: any, b: any) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  }

  // Deduplicate (one row per driver — multiple vehicles)
  const seen = new Set<number>();
  const unique = drivers.filter(d => { if (seen.has(d.driver.id)) return false; seen.add(d.driver.id); return true; });

  res.json(unique.map(d => ({
    id: d.driver.id,
    name: d.driver.name,
    phone: d.driver.phone,
    profilePhoto: d.driver.profilePhoto,
    avgRating: d.driver.avgRating,
    ratingCount: d.driver.ratingCount,
    totalTrips: d.driver.totalTrips,
    vehicleType: d.vehicle?.vehicleType ?? "basic",
    registrationNumber: d.vehicle?.registrationNumber ?? null,
    vehiclePhoto: d.vehicle?.vehiclePhoto ?? null,
    lat: d.location?.lat ?? null,
    lng: d.location?.lng ?? null,
    distanceKm: (d as any).distanceKm ?? null,
  })));
});

// ─── AMBULANCE REQUESTS ───────────────────────────────────────────────────────

// User: create request (or SOS) — rate-limited: 5 per 5 minutes per IP
router.post("/ambulance/requests", rateLimit(5 * 60 * 1000, 5), async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const settings = await getOrCreateSettings();
  const { vehicleType, pickupLat, pickupLng, pickupAddress, dropLat, dropLng, dropAddress,
    patientName, patientCondition, notes, isSos, driverId } = req.body;
  if (pickupLat == null || pickupLng == null) {
    res.status(400).json({ error: "pickupLat and pickupLng required" }); return;
  }

  const estimatedFare = settings.baseFareBdt;

  const [request] = await db.insert(ambulanceRequestsTable).values({
    userId: claims.userId,
    vehicleType: vehicleType ?? "basic",
    pickupLat, pickupLng, pickupAddress,
    dropLat: dropLat ?? null, dropLng: dropLng ?? null, dropAddress: dropAddress ?? null,
    patientName: patientName ?? null, patientCondition: patientCondition ?? null,
    notes: notes ?? null, estimatedFare,
    isSos: isSos === true || isSos === "true",
    driverId: driverId ?? null,
    currency: "BDT",
  }).returning();

  const isSosReq = request.isSos;

  if (isSosReq) {
    const availableDrivers = await db.select({ id: usersTable.id })
      .from(ambulanceDriversTable)
      .innerJoin(usersTable, eq(usersTable.id, ambulanceDriversTable.userId))
      .where(and(eq(ambulanceDriversTable.approvalStatus, "approved"), eq(ambulanceDriversTable.onlineStatus, "online")));
    for (const d of availableDrivers) {
      await notify(d.id, "sos_request", "🚨 SOS Emergency Request", `Emergency ambulance needed at ${pickupAddress ?? "unknown location"}. Respond immediately!`, request.id);
    }
    await notifyAdmins("sos_request", "🚨 SOS Emergency", `User ${claims.userId} triggered SOS at ${pickupAddress ?? `${pickupLat},${pickupLng}`}`, request.id);
    broadcastAmbulanceEvent("request:sos", { requestId: request.id, userId: claims.userId, pickupLat, pickupLng, pickupAddress });
  } else if (driverId) {
    const [targetDriver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, driverId));
    if (targetDriver) {
      await notify(targetDriver.userId, "ambulance_request", "New Ambulance Request", `You have a new ambulance request from ${pickupAddress ?? "a user"}.`, request.id);
    }
    broadcastAmbulanceEvent("request:new", { requestId: request.id, driverId, vehicleType: request.vehicleType });
  } else {
    broadcastAmbulanceEvent("request:new", { requestId: request.id, vehicleType: request.vehicleType, pickupLat, pickupLng });
    await notifyAdmins("ambulance_request", "New Ambulance Request", `User ${claims.userId} requested a ${vehicleType ?? "basic"} ambulance.`, request.id);
  }

  res.status(201).json(await enrichRequest(request));
});

// User: get own active request
router.get("/ambulance/requests/active", async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const [active] = await db.select().from(ambulanceRequestsTable)
    .where(and(eq(ambulanceRequestsTable.userId, claims.userId),
      sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled')`))
    .orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(1);
  if (!active) { res.json(null); return; }
  res.json(await enrichRequest(active));
});

// User: booking history
router.get("/ambulance/requests/history", async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const history = await db.select().from(ambulanceRequestsTable)
    .where(eq(ambulanceRequestsTable.userId, claims.userId))
    .orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(50);
  res.json(history);
});

// Get single request
router.get("/ambulance/requests/:id", async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const [request] = await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.id, parseInt(req.params.id)));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  const isOwner = request.userId === claims.userId;
  const driver = request.driverId ? (await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, request.driverId)))[0] : null;
  const isDriver = driver?.userId === claims.userId;
  if (!isOwner && !isDriver && claims.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(await enrichRequest(request));
});

// Driver: accept request
router.put("/ambulance/requests/:id/accept", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver || driver.approvalStatus !== "approved") { res.status(403).json({ error: "Not authorized" }); return; }
  const requestId = parseInt(req.params.id);
  const [request] = await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.id, requestId));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.status !== "pending") { res.status(409).json({ error: "Request already accepted or closed" }); return; }

  const [busy] = await db.select().from(ambulanceRequestsTable)
    .where(and(eq(ambulanceRequestsTable.driverId, driver.id),
      sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled')`));
  if (busy) { res.status(409).json({ error: "You already have an active trip" }); return; }

  const [updated] = await db.update(ambulanceRequestsTable)
    .set({ driverId: driver.id, status: "accepted", acceptedAt: new Date() })
    .where(eq(ambulanceRequestsTable.id, requestId)).returning();
  await db.update(ambulanceDriversTable).set({ onlineStatus: "busy" }).where(eq(ambulanceDriversTable.id, driver.id));

  await notify(request.userId, "ambulance_accepted", "Ambulance On The Way", `Your ambulance request has been accepted. Driver: ${driver.name}, Phone: ${driver.phone}`, requestId);
  broadcastAmbulanceEvent("request:accepted", { requestId, driverId: driver.id, driverName: driver.name, driverPhone: driver.phone });
  res.json(await enrichRequest(updated));
});

// Driver: reject request
router.put("/ambulance/requests/:id/reject", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver"); if (!claims) return;
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  broadcastAmbulanceEvent("request:driver_rejected", { requestId: parseInt(req.params.id), driverId: driver.id });
  res.json({ ok: true });
});

// Driver: update request status (en_route | arrived | in_progress | completed)
router.put("/ambulance/requests/:id/status", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "driver", "admin"); if (!claims) return;
  const requestId = parseInt(req.params.id);
  const [request] = await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.id, requestId));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  if (claims.role === "driver") {
    const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.userId, claims.userId));
    if (!driver || request.driverId !== driver.id) { res.status(403).json({ error: "Not your request" }); return; }
  }

  const { status, actualFare, distanceKm } = req.body;
  const validStatuses = ["en_route", "arrived", "in_progress", "completed", "cancelled"];
  if (!validStatuses.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  const updates: Partial<typeof ambulanceRequestsTable.$inferInsert> = { status };
  if (status === "arrived") updates.arrivedAt = new Date();
  if (status === "completed") {
    updates.completedAt = new Date();
    if (actualFare) updates.actualFare = actualFare;
    if (distanceKm) updates.distanceKm = distanceKm;
  }

  const [updated] = await db.update(ambulanceRequestsTable).set(updates).where(eq(ambulanceRequestsTable.id, requestId)).returning();

  if (status === "completed" && request.driverId) {
    await db.update(ambulanceDriversTable)
      .set({ onlineStatus: "online", totalTrips: sql`${ambulanceDriversTable.totalTrips} + 1`,
        totalEarnings: actualFare ? sql`${ambulanceDriversTable.totalEarnings} + ${actualFare}` : ambulanceDriversTable.totalEarnings })
      .where(eq(ambulanceDriversTable.id, request.driverId));
    await notify(request.userId, "ambulance_completed", "Trip Completed", "Your ambulance trip has been completed. Please rate your experience.", requestId);
  }

  broadcastAmbulanceEvent(`request:${status}`, { requestId, driverId: request.driverId });
  res.json(await enrichRequest(updated));
});

// User or driver: cancel request
router.put("/ambulance/requests/:id/cancel", async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const requestId = parseInt(req.params.id);
  const [request] = await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.id, requestId));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  const isOwner = request.userId === claims.userId;
  const driver = request.driverId ? (await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, request.driverId)))[0] : null;
  const isDriver = driver?.userId === claims.userId;
  if (!isOwner && !isDriver && claims.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  if (["completed", "cancelled"].includes(request.status)) { res.status(409).json({ error: "Cannot cancel a finished request" }); return; }

  const { reason } = req.body;
  const [updated] = await db.update(ambulanceRequestsTable)
    .set({ status: "cancelled", cancellationReason: reason ?? null, cancelledBy: claims.role })
    .where(eq(ambulanceRequestsTable.id, requestId)).returning();

  if (request.driverId) {
    await db.update(ambulanceDriversTable).set({ onlineStatus: "online" }).where(eq(ambulanceDriversTable.id, request.driverId));
    // notify() takes a userId — use driver.userId, not request.driverId (which is the driver profile id)
    if (driver) await notify(driver.userId, "ambulance_cancelled", "Request Cancelled", `A trip request was cancelled.`, requestId);
  }
  if (isDriver || claims.role === "admin") {
    await notify(request.userId, "ambulance_cancelled", "Ambulance Cancelled", "Your ambulance request was cancelled.", requestId);
  }
  broadcastAmbulanceEvent("request:cancelled", { requestId, cancelledBy: claims.role });
  res.json(updated);
});

// ─── RATINGS ─────────────────────────────────────────────────────────────────

router.post("/ambulance/requests/:id/rate", async (req, res): Promise<void> => {
  const claims = requireAuth(req, res); if (!claims) return;
  const requestId = parseInt(req.params.id);
  const [request] = await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.id, requestId));
  if (!request || request.userId !== claims.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (request.status !== "completed") { res.status(400).json({ error: "Can only rate completed trips" }); return; }
  if (!request.driverId) { res.status(400).json({ error: "No driver to rate" }); return; }

  const existing = await db.select().from(ambulanceRatingsTable).where(eq(ambulanceRatingsTable.requestId, requestId));
  if (existing.length) { res.status(409).json({ error: "Already rated" }); return; }

  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ error: "rating must be 1-5" }); return; }

  const [r] = await db.insert(ambulanceRatingsTable).values({ requestId, userId: claims.userId, driverId: request.driverId, rating, review }).returning();

  const allRatings = await db.select().from(ambulanceRatingsTable).where(eq(ambulanceRatingsTable.driverId, request.driverId));
  const avg = allRatings.reduce((s, x) => s + x.rating, 0) / allRatings.length;
  await db.update(ambulanceDriversTable)
    .set({ avgRating: avg, ratingCount: allRatings.length })
    .where(eq(ambulanceDriversTable.id, request.driverId));

  res.status(201).json(r);
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// List all drivers
router.get("/admin/ambulance/drivers", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const { status } = req.query as Record<string, string>;
  const drivers = status
    ? await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.approvalStatus, status)).orderBy(desc(ambulanceDriversTable.createdAt))
    : await db.select().from(ambulanceDriversTable).orderBy(desc(ambulanceDriversTable.createdAt));

  const enriched = await Promise.all(drivers.map(async d => {
    const vehicles = await db.select().from(ambulanceVehiclesTable).where(eq(ambulanceVehiclesTable.driverId, d.id));
    const [loc] = await db.select().from(driverLocationsTable).where(eq(driverLocationsTable.driverId, d.id));
    return { ...d, vehicles, location: loc ?? null };
  }));
  res.json(enriched);
});

// Admin: approve/reject driver
router.put("/admin/ambulance/drivers/:id/approve", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const driverId = parseInt(req.params.id);
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, driverId));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  const { status, note } = req.body; // "approved" | "rejected"
  if (!["approved", "rejected"].includes(status)) { res.status(400).json({ error: "status must be approved or rejected" }); return; }

  const [updated] = await db.update(ambulanceDriversTable)
    .set({ approvalStatus: status, approvalNote: note ?? null, approvedBy: claims.userId, approvedAt: new Date() })
    .where(eq(ambulanceDriversTable.id, driverId)).returning();

  await notify(driver.userId, `ambulance_driver_${status}`,
    status === "approved" ? "Driver Account Approved" : "Driver Application Rejected",
    status === "approved" ? "Your ambulance driver account has been approved. You can now go online and accept rides." : `Your driver application was rejected. Reason: ${note ?? "No reason provided"}.`,
    driverId);

  // Email driver about approval/rejection
  sendEmail(
    driver.email,
    status === "approved"
      ? "DoctorX — Driver Account Approved"
      : "DoctorX — Driver Application Rejected",
    status === "approved"
      ? `Hello ${driver.name},

Your DoctorX ambulance driver application has been approved.

You can now log in to your driver account, go online, and accept ambulance ride requests.

Thank you for registering with DoctorX.

— DoctorX`
      : `Hello ${driver.name},

Your DoctorX ambulance driver application has been rejected.

Reason: ${note ?? "No reason provided"}.

If you believe this was a mistake, please contact DoctorX administration.

— DoctorX`
  ).catch(() => {});

  await writeAudit({ userId: claims.userId, role: "admin", name: null, doctorId: null }, `ambulance_driver_${status}`, "ambulance_drivers", driverId);
  res.json(updated);
});

// Admin: suspend driver
router.put("/admin/ambulance/drivers/:id/suspend", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const driverId = parseInt(req.params.id);
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, driverId));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  const { note } = req.body;

  const [updated] = await db.update(ambulanceDriversTable)
    .set({ approvalStatus: "suspended", onlineStatus: "offline", approvalNote: note ?? driver.approvalNote })
    .where(eq(ambulanceDriversTable.id, driverId)).returning();

  await notify(driver.userId, "ambulance_driver_suspended", "Driver Account Suspended",
    `Your driver account has been suspended. Reason: ${note ?? "No reason provided"}.`, driverId);
  await writeAudit({ userId: claims.userId, role: "admin", name: null, doctorId: null }, "ambulance_driver_suspended", "ambulance_drivers", driverId);
  broadcastAmbulanceEvent("driver:status_changed", { driverId, status: "offline" });
  res.json(updated);
});

// Admin: reactivate driver
router.put("/admin/ambulance/drivers/:id/reactivate", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const driverId = parseInt(req.params.id);
  const [driver] = await db.select().from(ambulanceDriversTable).where(eq(ambulanceDriversTable.id, driverId));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }

  const [updated] = await db.update(ambulanceDriversTable)
    .set({ approvalStatus: "approved", approvalNote: null })
    .where(eq(ambulanceDriversTable.id, driverId)).returning();

  await notify(driver.userId, "ambulance_driver_reactivated", "Driver Account Reactivated",
    "Your driver account has been reactivated. You can now go online and accept rides.", driverId);
  await writeAudit({ userId: claims.userId, role: "admin", name: null, doctorId: null }, "ambulance_driver_reactivated", "ambulance_drivers", driverId);
  res.json(updated);
});

// Admin: all requests
router.get("/admin/ambulance/requests", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const { status, limit = "50" } = req.query as Record<string, string>;
  const requests = status
    ? await db.select().from(ambulanceRequestsTable).where(eq(ambulanceRequestsTable.status, status)).orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(parseInt(limit))
    : await db.select().from(ambulanceRequestsTable).orderBy(desc(ambulanceRequestsTable.requestedAt)).limit(parseInt(limit));
  const enriched = await Promise.all(requests.map(enrichRequest));
  res.json(enriched);
});

// Admin: live map data (all drivers with location)
router.get("/admin/ambulance/map", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const drivers = await db.select({
    driver: ambulanceDriversTable,
    location: driverLocationsTable,
  })
    .from(ambulanceDriversTable)
    .leftJoin(driverLocationsTable, eq(driverLocationsTable.driverId, ambulanceDriversTable.id))
    .where(eq(ambulanceDriversTable.approvalStatus, "approved"));

  const activeRequests = await db.select().from(ambulanceRequestsTable)
    .where(sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled')`)
    .orderBy(desc(ambulanceRequestsTable.requestedAt));

  res.json({
    drivers: drivers.map(d => ({
      id: d.driver.id,
      name: d.driver.name,
      phone: d.driver.phone,
      onlineStatus: d.driver.onlineStatus,
      lat: d.location?.lat ?? null,
      lng: d.location?.lng ?? null,
      updatedAt: d.location?.updatedAt ?? null,
    })),
    activeRequests,
  });
});

// Admin: dashboard stats
router.get("/admin/ambulance/stats", async (req, res): Promise<void> => {
  const claims = requireRole(req, res, "admin"); if (!claims) return;
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(eq(ambulanceDriversTable.approvalStatus, "approved"));
  const [available] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(and(eq(ambulanceDriversTable.approvalStatus, "approved"), eq(ambulanceDriversTable.onlineStatus, "online")));
  const [busy] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(and(eq(ambulanceDriversTable.approvalStatus, "approved"), eq(ambulanceDriversTable.onlineStatus, "busy")));
  const [offline] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(and(eq(ambulanceDriversTable.approvalStatus, "approved"), eq(ambulanceDriversTable.onlineStatus, "offline")));
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(eq(ambulanceDriversTable.approvalStatus, "pending"));
  const [suspended] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceDriversTable).where(eq(ambulanceDriversTable.approvalStatus, "suspended"));
  const [activeTrips] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceRequestsTable).where(sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled','pending')`);
  const [sosRequests] = await db.select({ count: sql<number>`count(*)::int` }).from(ambulanceRequestsTable).where(and(eq(ambulanceRequestsTable.isSos, true), sql`${ambulanceRequestsTable.status} NOT IN ('completed','cancelled')`));
  res.json({
    total: total.count, available: available.count, busy: busy.count, offline: offline.count,
    pendingApproval: pending.count, suspended: suspended.count,
    activeTrips: activeTrips.count, sosPending: sosRequests.count,
  });
});

export default router;
