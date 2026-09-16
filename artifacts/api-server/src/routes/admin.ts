import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, doctorsTable, appointmentsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { ilike } from "drizzle-orm";
import { verifyAuthToken } from "../lib/token";
import { writeAudit, type Actor } from "../lib/admin";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();

async function getAuthUser(authHeader: string | undefined) {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user ?? null;
  } catch {
    return null;
  }
}

router.get("/admin/stats", async (req, res): Promise<void> => {
  const admin = await getAuthUser(req.headers.authorization);
  if (!admin || admin.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const allDoctors = await db.select().from(doctorsTable);
  const allAppointments = await db.select().from(appointmentsTable);
  const allSubscriptions = await db.select().from(subscriptionsTable);
  const today = new Date().toISOString().split("T")[0];

  const totalDoctors = allDoctors.length;
  const pendingDoctors = allDoctors.filter(d => d.approvalStatus === "pending").length;
  const approvedDoctors = allDoctors.filter(d => d.approvalStatus === "approved").length;
  const totalAppointments = allAppointments.length;
  const todayAppointments = allAppointments.filter(a => a.appointmentDate === today).length;
  const activeSubscriptions = allSubscriptions.filter(s => s.status === "active").length;
  const pendingPayments = allSubscriptions.filter(s => s.paymentStatus === "unpaid").length;
  const totalRevenue = allSubscriptions.filter(s => s.paymentStatus === "paid").reduce((sum, s) => sum + s.fee, 0);

  // Unique patients = unique phone numbers
  const phones = new Set(allAppointments.map(a => a.patientPhone));
  const totalPatients = phones.size;

  res.json({
    totalDoctors, pendingDoctors, approvedDoctors,
    totalAppointments, todayAppointments,
    activeSubscriptions, pendingPayments, totalRevenue, totalPatients,
  });
});

router.get("/admin/donations", async (req, res): Promise<void> => {
  const admin = await getAuthUser(req.headers.authorization);
  if (!admin || admin.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { dateFrom, dateTo, doctorId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum - 1) * limitNum;

  let paid = (await db.select().from(appointmentsTable)).filter(a => a.donationPaid);
  if (dateFrom) paid = paid.filter(a => a.appointmentDate >= dateFrom);
  if (dateTo) paid = paid.filter(a => a.appointmentDate <= dateTo);
  if (doctorId) paid = paid.filter(a => a.doctorId === parseInt(doctorId));

  paid.sort((a, b) => (b.donationPaidAt?.getTime() ?? 0) - (a.donationPaidAt?.getTime() ?? 0));

  const totalCollected = paid.reduce((sum, a) => sum + (a.donationAmount ?? 0), 0);
  const totalCount = paid.length;

  const doctors = await db.select().from(doctorsTable);
  const doctorNameById = new Map(doctors.map(d => [d.id, d.name]));

  const donations = paid.slice(offset, offset + limitNum).map(a => ({
    id: a.id,
    doctorId: a.doctorId,
    doctorName: doctorNameById.get(a.doctorId) ?? null,
    patientName: a.patientName,
    patientPhone: a.patientPhone,
    appointmentDate: a.appointmentDate,
    serialNo: a.serialNo,
    donationAmount: a.donationAmount,
    donationPaidAt: a.donationPaidAt ? a.donationPaidAt.toISOString() : null,
  }));

  res.json({ donations, total: totalCount, page: pageNum, limit: limitNum, totalCollected, totalCount });
});

router.get("/admin/doctors", async (req, res): Promise<void> => {
  const admin = await getAuthUser(req.headers.authorization);
  if (!admin || admin.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const {
    status, name, subscriptionStatus,
    registrationDateFrom, registrationDateTo, bmdcNumber,
    page = "1", limit = "20",
  } = req.query as Record<string, string>;

  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum - 1) * limitNum;

  // Fetch all doctors + all subscriptions to join in memory
  let all = await db.select().from(doctorsTable);
  const allSubs = await db.select().from(subscriptionsTable);

  // Build subscription map: doctorId -> latest subscription
  const subMap = new Map<number, typeof subscriptionsTable.$inferSelect>();
  for (const sub of allSubs) {
    const existing = subMap.get(sub.doctorId);
    if (!existing || sub.updatedAt > existing.updatedAt) {
      subMap.set(sub.doctorId, sub);
    }
  }

  // Apply filters
  if (status) all = all.filter(d => d.approvalStatus === status);
  if (name) {
    const q = name.toLowerCase();
    all = all.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.email && d.email.toLowerCase().includes(q))
    );
  }
  if (registrationDateFrom) {
    all = all.filter(d => d.createdAt.toISOString().split("T")[0] >= registrationDateFrom);
  }
  if (registrationDateTo) {
    all = all.filter(d => d.createdAt.toISOString().split("T")[0] <= registrationDateTo);
  }
  if (bmdcNumber) {
    const q = bmdcNumber.toLowerCase();
    all = all.filter(d => d.bmdcNumber && d.bmdcNumber.toLowerCase().includes(q));
  }
  if (subscriptionStatus) {
    all = all.filter(d => {
      const sub = subMap.get(d.id);
      if (!sub) return subscriptionStatus === "unpaid";
      return sub.paymentStatus === subscriptionStatus || sub.status === subscriptionStatus;
    });
  }

  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const paged = all.slice(offset, offset + limitNum).map(d => {
    const sub = subMap.get(d.id);
    return {
      ...d,
      departmentName: null,
      specialtyName: null,
      locationName: null,
      registrationDate: d.createdAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      subscriptionPaymentStatus: sub?.paymentStatus ?? null,
      subscriptionStatus: sub?.status ?? null,
      subscriptionEndDate: sub?.endDate ?? null,
      subscriptionMonths: sub?.months ?? null,
      subscriptionMonthlyFee: sub?.monthlyFee ?? null,
    };
  });

  res.json({ doctors: paged, total: all.length, page: pageNum, limit: limitNum });
});

router.post("/admin/users/reset-password", async (req, res): Promise<void> => {
  const admin = await getAuthUser(req.headers.authorization);
  if (!admin || admin.role !== "admin") {
    res.status(403).json({ error: "Only admins can reset passwords" });
    return;
  }
  const { email, newPassword } = req.body;
  if (!email || !newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "Email and a password of at least 6 characters are required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await db.update(usersTable).set({ password: await hashPassword(newPassword) }).where(eq(usersTable.id, user.id));
  const actor: Actor = { userId: admin.id, role: admin.role, name: admin.name, doctorId: admin.doctorId ?? null };
  await writeAudit(actor, "reset-password", "user", user.id, user.email);
  res.json({ message: `Password reset for ${user.email}.` });
});

export default router;
