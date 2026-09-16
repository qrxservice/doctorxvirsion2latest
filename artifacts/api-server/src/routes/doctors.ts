import { Router, type IRouter } from "express";
import { eq, ilike, and, or } from "drizzle-orm";
import { db, doctorsTable, usersTable, departmentsTable, specialtiesTable, locationsTable, subscriptionsTable, countriesTable, citiesTable, appSettingsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { getActor, writeAudit } from "../lib/admin";
import { sendEmail } from "../lib/messaging";
import { notify, notifyAdmins } from "../lib/notify";
import { resolveCurrencyFromRequest, calcTieredDoctorFee, currencySymbol } from "../lib/currency";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();

async function ensureAppSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

async function enrichDoctor(doc: typeof doctorsTable.$inferSelect) {
  const [dept] = doc.departmentId ? await db.select().from(departmentsTable).where(eq(departmentsTable.id, doc.departmentId)) : [null];
  const [spec] = doc.specialtyId ? await db.select().from(specialtiesTable).where(eq(specialtiesTable.id, doc.specialtyId)) : [null];
  const [loc] = doc.locationId ? await db.select().from(locationsTable).where(eq(locationsTable.id, doc.locationId)) : [null];
  const [country] = doc.countryId ? await db.select().from(countriesTable).where(eq(countriesTable.id, doc.countryId)) : [null];
  const [city] = doc.cityId ? await db.select().from(citiesTable).where(eq(citiesTable.id, doc.cityId)) : [null];
  return {
    ...doc,
    departmentName: dept?.name ?? null,
    specialtyName: spec?.name ?? null,
    locationName: loc?.name ?? null,
    countryName: country?.name ?? null,
    countryCode: country?.code ?? null,
    cityName: city?.name ?? null,
    createdAt: doc.createdAt.toISOString(),
    lastActiveAt: doc.lastActiveAt?.toISOString() ?? null,
  };
}

// Public: list approved doctors
router.get("/doctors", async (req, res): Promise<void> => {
  const { search, departmentId, specialtyId, locationId, countryId, cityId, divisionId, featured, onlineOnly, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [eq(doctorsTable.approvalStatus, "approved")];
  if (departmentId) conditions.push(eq(doctorsTable.departmentId, parseInt(departmentId)));
  if (specialtyId) conditions.push(eq(doctorsTable.specialtyId, parseInt(specialtyId)));
  if (locationId) conditions.push(eq(doctorsTable.locationId, parseInt(locationId)));
  if (countryId) conditions.push(eq(doctorsTable.countryId, parseInt(countryId)));
  if (cityId) conditions.push(eq(doctorsTable.cityId, parseInt(cityId)));
  if (divisionId) conditions.push(eq(doctorsTable.divisionId, parseInt(divisionId)));
  if (featured === "true") conditions.push(eq(doctorsTable.isFeatured, true));
  if (onlineOnly === "true") conditions.push(eq(doctorsTable.onlineStatus, "online"));

  let allDocs = await db.select().from(doctorsTable).where(and(...conditions));
  if (search) {
    const searchLower = search.toLowerCase();
    allDocs = allDocs.filter(d =>
      d.name.toLowerCase().includes(searchLower) ||
      (d.degree && d.degree.toLowerCase().includes(searchLower)) ||
      (d.chamberAddress && d.chamberAddress.toLowerCase().includes(searchLower))
    );
  }

  const enriched = await Promise.all(allDocs.slice(offset, offset + limitNum).map(enrichDoctor));
  res.json({ doctors: enriched, total: allDocs.length, page: pageNum, limit: limitNum });
});

// Register doctor
router.post("/doctors", async (req, res): Promise<void> => {
  const { name, email, password, degree, bmdcNumber, bmdcValidityYears, phone, photoUrl,
    departmentId, specialtyId, locationId, countryId, cityId, timezone,
    experience, chamberAddress, visitingTime, chamberAddress2, visitingTime2, consultationFee, about, services, education,
    onlineConsultationAvailable, emergencyAvailable } = req.body;

  if (!name || !email || !password || !degree || !bmdcNumber || !bmdcValidityYears) {
    res.status(400).json({ error: "Required fields missing" }); return;
  }
  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" }); return;
  }

  const rawMonths = req.body.months !== undefined ? Number(req.body.months) : null;
  const months = (rawMonths !== null && Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 120)
    ? rawMonths : null;

  // Currency is always resolved server-side from the requester's IP —
  // never trust a client-supplied currency, since that could be used to
  // spoof a lower fee. Bangladesh -> BDT, everything else -> USD.
  const { currency } = resolveCurrencyFromRequest(req);
  const settings = await ensureAppSettings();
  const fee = calcTieredDoctorFee(parseInt(bmdcValidityYears), currency, settings);

  const [user] = await db.insert(usersTable).values({ email, password: await hashPassword(password), name, role: "doctor" }).returning();
  const [doc] = await db.insert(doctorsTable).values({
    userId: user.id, name, email, phone, photoUrl, degree, bmdcNumber,
    bmdcValidityYears: parseInt(bmdcValidityYears), subscriptionFee: fee, currency,
    departmentId: departmentId ? parseInt(departmentId) : null,
    specialtyId: specialtyId ? parseInt(specialtyId) : null,
    locationId: locationId ? parseInt(locationId) : null,
    countryId: countryId ? parseInt(countryId) : null,
    cityId: cityId ? parseInt(cityId) : null,
    timezone, experience: experience ? parseInt(experience) : null,
    chamberAddress, visitingTime, chamberAddress2, visitingTime2,
    consultationFee: consultationFee ? parseInt(consultationFee) : null,
    about, services, education, approvalStatus: "pending",
    onlineConsultationAvailable: !!onlineConsultationAvailable,
    emergencyAvailable: !!emergencyAvailable,
    onlineStatus: "offline",
  }).returning();

  await db.update(usersTable).set({ doctorId: doc.id }).where(eq(usersTable.id, user.id));
  // Use months selected during registration; fee is per-month × months if months provided
  await db.insert(subscriptionsTable).values({
    doctorId: doc.id, bmdcValidityYears: parseInt(bmdcValidityYears),
    fee: fee === 0 ? 0 : (months ? fee * months : fee),
    months: fee === 0 ? null : months,
    currency,
    paymentStatus: fee === 0 ? "free" : "unpaid", status: "inactive",
  });

  // Notify doctor of successful registration (email + in-app)
  sendEmail(
    email,
    "DoctorX — Registration Received",
    `Dear ${name},\n\nThank you for registering on DoctorX. Your application is now under review.\n\nOnce an admin approves your account you will receive another email and you can log in to complete your subscription payment (if applicable).\n\nIf you have any questions, please contact our support team.\n\nBest regards,\nDoctorX Team`
  ).catch(() => {});
  notify(user.id, "registration", "Registration Submitted", "Your doctor registration is under review. You'll be notified once approved.").catch(() => {});

  // Notify admin(s) of new pending doctor registration (email + in-app)
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    sendEmail(
      admin.email,
      `DoctorX — New Doctor Registration: ${name}`,
      `A new doctor has registered and is awaiting your approval.\n\nName: ${name}\nEmail: ${email}\nBMDC No: ${bmdcNumber}\nBMDC Validity: ${bmdcValidityYears} years\nDegree: ${degree}\n\nPlease log in to the admin panel to review and approve or reject this registration.\n\nDoctorX Admin System`
    ).catch(() => {});
  }
  notifyAdmins("new_doctor", "New Doctor Registration", `${name} has registered and is awaiting your approval.`, doc.id).catch(() => {});

  res.status(201).json(await enrichDoctor(doc));
});

// Doctor's own subscription (self-service)
router.get("/doctors/me/subscription", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const claims = verifyAuthToken(auth);
    if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.doctorId, user.doctorId));
    if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }
    res.json(sub);
  } catch { res.status(401).json({ error: "Invalid token" }); }
});

// Get authenticated doctor profile
router.get("/doctors/me/profile", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const claims = verifyAuthToken(auth);
    if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
    if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
    // Update last active
    await db.update(doctorsTable).set({ lastActiveAt: new Date() }).where(eq(doctorsTable.id, doc.id));
    res.json(await enrichDoctor(doc));
  } catch { res.status(401).json({ error: "Invalid token" }); }
});

router.get("/doctors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Doctor not found" }); return; }
  res.json(await enrichDoctor(doc));
});

// Update doctor — requires auth; doctors can only update their own profile, admins can update any
router.patch("/doctors/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (!actor.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = parseInt(req.params.id);

  // Non-admins may only edit their own doctor record
  if (actor.role !== "admin") {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, actor.userId));
    if (!user?.doctorId || user.doctorId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Non-admins cannot change approval/verification/featured/senior status
    delete req.body.approvalStatus;
    delete req.body.isVerified;
    delete req.body.isFeatured;
    delete req.body.isSenior;
  }

  const updates: Record<string, unknown> = {};
  const fields = ["name","phone","photoUrl","degree","experience","chamberAddress","visitingTime","chamberAddress2","visitingTime2","consultationFee",
    "about","services","education","isFeatured","isSenior","isVerified","approvalStatus","departmentId","specialtyId","locationId",
    "countryId","cityId","timezone","onlineConsultationAvailable","emergencyAvailable","onlineStatus"];
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }
  const [doc] = await db.update(doctorsTable).set(updates).where(eq(doctorsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await enrichDoctor(doc));
});

// Doctor self-update status
router.post("/doctor/status", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const claims = verifyAuthToken(auth);
    if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }
    const { status, breakUntil } = req.body;
    if (!["online","offline","busy","vacation"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    await db.update(doctorsTable).set({
      onlineStatus: status,
      lastActiveAt: new Date(),
      breakUntil: (status === "busy" && breakUntil) ? new Date(breakUntil as string) : null,
    }).where(eq(doctorsTable.id, user.doctorId));
    res.json({ status, message: "Status updated" });
  } catch { res.status(401).json({ error: "Invalid token" }); }
});

// List online doctors
router.get("/doctors/online", async (_req, res): Promise<void> => {
  const docs = await db.select().from(doctorsTable).where(and(eq(doctorsTable.approvalStatus, "approved"), eq(doctorsTable.onlineStatus, "online")));
  const enriched = await Promise.all(docs.map(enrichDoctor));
  res.json(enriched);
});

// Approve doctor (admin only)
router.post("/doctors/:id/approve", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  const [doc] = await db.update(doctorsTable).set({ approvalStatus: "approved", isVerified: true }).where(eq(doctorsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(subscriptionsTable).set({ status: "active" }).where(eq(subscriptionsTable.doctorId, id));
  await writeAudit(actor, "approve", "doctor", id, doc.name);

  // Email + in-app notification to doctor
  const sym = currencySymbol(doc.currency === "USD" ? "USD" : "BDT");
  const feeNote = doc.subscriptionFee && doc.subscriptionFee > 0
    ? `\nYour monthly subscription fee is ${sym}${doc.subscriptionFee}/month. Please log in and complete your payment from your profile page to activate full access.`
    : `\nYour account has free access based on your BMDC validity period.`;
  sendEmail(
    doc.email,
    "DoctorX — Your Registration Has Been Approved! 🎉",
    `Dear ${doc.name},\n\nGreat news! Your doctor registration on DoctorX has been approved.\n\nYou can now log in to your dashboard using your registered email and password.${feeNote}\n\nWelcome to the DoctorX platform!\n\nBest regards,\nDoctorX Team`
  ).catch(() => {});
  const approvalMsg = doc.subscriptionFee && doc.subscriptionFee > 0
    ? `Your account is approved! Please log in and complete your subscription payment (${sym}${doc.subscriptionFee}/mo) to activate full access.`
    : "Your account is approved! You have free access. Log in to start using your dashboard.";
  if (doc.userId) notify(doc.userId, "approved", "Registration Approved 🎉", approvalMsg, doc.id).catch(() => {});

  res.json(await enrichDoctor(doc));
});

// Reject doctor (admin only)
router.post("/doctors/:id/reject", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  const { reason } = req.body as { reason?: string };
  const [doc] = await db.update(doctorsTable).set({ approvalStatus: "rejected" }).where(eq(doctorsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  await writeAudit(actor, "reject", "doctor", id, doc.name);

  // Email + in-app notification to doctor
  const reasonNote = reason ? `\nReason: ${reason}\n` : "";
  sendEmail(
    doc.email,
    "DoctorX — Registration Status Update",
    `Dear ${doc.name},\n\nWe regret to inform you that your doctor registration on DoctorX could not be approved at this time.${reasonNote}\nIf you believe this is an error or would like to provide additional information, please contact our support team.\n\nBest regards,\nDoctorX Team`
  ).catch(() => {});
  const rejectMsg = reason
    ? `Your registration was not approved. Reason: ${reason}. Please contact support for assistance.`
    : "Your registration was not approved at this time. Please contact support for assistance.";
  if (doc.userId) notify(doc.userId, "rejected", "Registration Not Approved", rejectMsg, doc.id).catch(() => {});

  res.json(await enrichDoctor(doc));
});

// Feature doctor (admin only)
router.post("/doctors/:id/feature", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  const { isFeatured } = req.body;
  const [doc] = await db.update(doctorsTable).set({ isFeatured }).where(eq(doctorsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  await writeAudit(actor, isFeatured ? "feature" : "unfeature", "doctor", id, doc.name);
  res.json(await enrichDoctor(doc));
});

// Mark doctor as senior (admin only)
router.post("/doctors/:id/senior", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  const { isSenior } = req.body;
  const [doc] = await db.update(doctorsTable).set({ isSenior }).where(eq(doctorsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  await writeAudit(actor, isSenior ? "mark_senior" : "unmark_senior", "doctor", id, doc.name);
  res.json(await enrichDoctor(doc));
});

export default router;
