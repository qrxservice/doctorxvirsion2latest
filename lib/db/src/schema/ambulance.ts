import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Ambulance Driver Profiles ───────────────────────────────────────────────

export const ambulanceDriversTable = pgTable("ambulance_drivers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  profilePhoto: text("profile_photo"),

  // ── Personal details ────────────────────────────────────────────────────────
  dateOfBirth: text("date_of_birth"),
  address: text("address"),

  // ── Identity documents ──────────────────────────────────────────────────────
  nidNumber: text("nid_number"),
  /** Front / main NID image */
  nidPhoto: text("nid_photo"),
  /** Back side of NID */
  nidBackPhoto: text("nid_back_photo"),
  selfiePhoto: text("selfie_photo"),

  // ── Driving licence ─────────────────────────────────────────────────────────
  licenceNumber: text("licence_number"),
  licencePhoto: text("licence_photo"),
  licenceExpiry: text("licence_expiry"),

  // ── Coverage area ───────────────────────────────────────────────────────────
  division: text("division"),
  district: text("district"),
  upazila: text("upazila"),
  /** Service radius in kilometres */
  serviceRadius: integer("service_radius").default(20),

  // ── Approval workflow ───────────────────────────────────────────────────────
  /** pending | approved | rejected | suspended */
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvalNote: text("approval_note"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  // ── Operational status ──────────────────────────────────────────────────────
  /** online | offline | busy */
  onlineStatus: text("online_status").notNull().default("offline"),
  isActive: boolean("is_active").notNull().default(true),

  // ── Aggregate stats ─────────────────────────────────────────────────────────
  totalTrips: integer("total_trips").notNull().default(0),
  totalEarnings: integer("total_earnings").notNull().default(0),
  avgRating: real("avg_rating"),
  ratingCount: integer("rating_count").notNull().default(0),

  // ── Subscription (Phase 7 / future) ─────────────────────────────────────────
  planName: text("plan_name"),
  planStatus: text("plan_status"),
  planStartDate: timestamp("plan_start_date", { withTimezone: true }),
  planEndDate: timestamp("plan_end_date", { withTimezone: true }),
  autoRenew: boolean("auto_renew").default(false),

  // ── Phase 14 — future-ready architecture (not yet surfaced in UI) ────────────
  walletBalance: integer("wallet_balance").notNull().default(0),
  /** unverified | pending | verified | failed */
  verificationStatus: text("verification_status").notNull().default("unverified"),
  gpsEnabled: boolean("gps_enabled").notNull().default(true),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  /** Per-driver override commission rate; null = use global setting */
  commissionRate: real("commission_rate"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAmbulanceDriverSchema = createInsertSchema(ambulanceDriversTable).omit({
  id: true, approvalStatus: true, approvedAt: true, onlineStatus: true,
  totalTrips: true, totalEarnings: true, avgRating: true, ratingCount: true,
  walletBalance: true, verificationStatus: true, lastActiveAt: true,
  createdAt: true, updatedAt: true,
});
export type AmbulanceDriver = typeof ambulanceDriversTable.$inferSelect;
export type InsertAmbulanceDriver = z.infer<typeof insertAmbulanceDriverSchema>;

// ─── Ambulance Vehicles ───────────────────────────────────────────────────────

export const ambulanceVehiclesTable = pgTable("ambulance_vehicles", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull().references(() => ambulanceDriversTable.id, { onDelete: "cascade" }),
  /** basic | icu | ac | freezing | neonatal */
  vehicleType: text("vehicle_type").notNull().default("basic"),
  registrationNumber: text("registration_number").notNull(),
  vehiclePhoto: text("vehicle_photo"),
  make: text("make"),
  model: text("model"),
  year: text("year"),
  seatingCapacity: integer("seating_capacity"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAmbulanceVehicleSchema = createInsertSchema(ambulanceVehiclesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type AmbulanceVehicle = typeof ambulanceVehiclesTable.$inferSelect;
export type InsertAmbulanceVehicle = z.infer<typeof insertAmbulanceVehicleSchema>;

// ─── Driver GPS Locations (real-time) ────────────────────────────────────────

export const driverLocationsTable = pgTable("driver_locations", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull().references(() => ambulanceDriversTable.id, { onDelete: "cascade" }),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  heading: real("heading"),
  speed: real("speed"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDriverLocationSchema = createInsertSchema(driverLocationsTable).omit({ id: true, updatedAt: true });
export type DriverLocation = typeof driverLocationsTable.$inferSelect;
export type InsertDriverLocation = z.infer<typeof insertDriverLocationSchema>;

// ─── Ambulance Requests ───────────────────────────────────────────────────────

export const ambulanceRequestsTable = pgTable("ambulance_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  driverId: integer("driver_id").references(() => ambulanceDriversTable.id),
  vehicleId: integer("vehicle_id").references(() => ambulanceVehiclesTable.id),
  /** pending | accepted | en_route | arrived | in_progress | completed | cancelled */
  status: text("status").notNull().default("pending"),
  /** basic | icu | ac | freezing | neonatal */
  vehicleType: text("vehicle_type").notNull().default("basic"),
  isSos: boolean("is_sos").notNull().default(false),
  pickupLat: real("pickup_lat").notNull(),
  pickupLng: real("pickup_lng").notNull(),
  pickupAddress: text("pickup_address"),
  dropLat: real("drop_lat"),
  dropLng: real("drop_lng"),
  dropAddress: text("drop_address"),
  patientName: text("patient_name"),
  patientCondition: text("patient_condition"),
  notes: text("notes"),
  estimatedFare: integer("estimated_fare"),
  actualFare: integer("actual_fare"),
  distanceKm: real("distance_km"),
  currency: text("currency").notNull().default("BDT"),
  cancellationReason: text("cancellation_reason"),
  cancelledBy: text("cancelled_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAmbulanceRequestSchema = createInsertSchema(ambulanceRequestsTable).omit({
  id: true, status: true, requestedAt: true, acceptedAt: true, arrivedAt: true, completedAt: true, createdAt: true, updatedAt: true,
});
export type AmbulanceRequest = typeof ambulanceRequestsTable.$inferSelect;
export type InsertAmbulanceRequest = z.infer<typeof insertAmbulanceRequestSchema>;

// ─── Ambulance Ratings ────────────────────────────────────────────────────────

export const ambulanceRatingsTable = pgTable("ambulance_ratings", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => ambulanceRequestsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  driverId: integer("driver_id").notNull().references(() => ambulanceDriversTable.id),
  rating: integer("rating").notNull(), // 1-5
  review: text("review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAmbulanceRatingSchema = createInsertSchema(ambulanceRatingsTable).omit({ id: true, createdAt: true });
export type AmbulanceRating = typeof ambulanceRatingsTable.$inferSelect;
export type InsertAmbulanceRating = z.infer<typeof insertAmbulanceRatingSchema>;

// ─── Ambulance Settings (admin-controlled toggles) ───────────────────────────

export const ambulanceSettingsTable = pgTable("ambulance_settings", {
  id: serial("id").primaryKey(),
  commissionEnabled: boolean("commission_enabled").notNull().default(true),
  commissionRate: real("commission_rate").notNull().default(10), // percentage
  subscriptionEnabled: boolean("subscription_enabled").notNull().default(false),
  featuredListingEnabled: boolean("featured_listing_enabled").notNull().default(false),
  driverVerificationFeeEnabled: boolean("driver_verification_fee_enabled").notNull().default(false),
  driverVerificationFeeAmount: integer("driver_verification_fee_amount").notNull().default(0),
  baseFareBdt: integer("base_fare_bdt").notNull().default(500),
  perKmRateBdt: integer("per_km_rate_bdt").notNull().default(20),
  // Offline timeout: driver auto-set offline if no GPS update for this many minutes
  offlineTimeoutMinutes: integer("offline_timeout_minutes").notNull().default(15),
  /** How long (seconds) a pending request stays active before auto-expiring (0 = no timeout) */
  requestTimeoutSeconds: integer("request_timeout_seconds").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AmbulanceSettings = typeof ambulanceSettingsTable.$inferSelect;
