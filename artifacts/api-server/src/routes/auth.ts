import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable, appSettingsTable, adminOtpCodesTable, doctorsTable } from "@workspace/db";
import crypto from "crypto";
import { sendEmail, sendSms } from "../lib/messaging";
import { createAuthToken, createPendingOtpToken, verifyPendingOtpToken, verifyAuthToken } from "../lib/token";
import { hashPassword, verifyPassword } from "../lib/password";
import { authLimiter, passwordResetLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

async function getAppSettings() {
  const [s] = await db.select().from(appSettingsTable).limit(1);
  return s ?? null;
}

function userShape(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    doctorId: user.doctorId,
    createdAt: user.createdAt,
  };
}

async function issueLoginOtp(user: typeof usersTable.$inferSelect, method: string, expiryMinutes: number) {
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  await db.insert(adminOtpCodesTable).values({ userId: user.id, code, method, expiresAt, used: false });

  const subject = "DoctorX Admin Login Verification Code";
  const body = `Hello ${user.name ?? "Admin"},\n\nYour DoctorX Master Admin login verification code is: ${code}\n\nThis code expires in ${expiryMinutes} minute(s). If you did not attempt to log in, please secure your account immediately.\n\n— DoctorX`;
  if (method === "mobile" && user.phone) {
    await sendSms(user.phone, `DoctorX Admin login code: ${code} (expires in ${expiryMinutes} min)`);
  } else {
    await sendEmail(user.email, subject, body);
  }
}

router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const { valid, needsRehash } = await verifyPassword(password, user.password);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (needsRehash) {
    // Transparently upgrade legacy plaintext rows to bcrypt on next successful login.
    await db.update(usersTable).set({ password: await hashPassword(password) }).where(eq(usersTable.id, user.id));
  }

  if (user.role === "doctor") {
    const [doctor] = await db.select({ approvalStatus: doctorsTable.approvalStatus })
      .from(doctorsTable).where(eq(doctorsTable.id, user.doctorId!));
    if (!doctor || doctor.approvalStatus === "pending") {
      res.status(403).json({ error: "Your registration is pending admin approval. You will be notified once your account is approved." });
      return;
    }
    if (doctor.approvalStatus === "rejected") {
      res.status(403).json({ error: "Your registration was rejected. Please contact the admin for more information." });
      return;
    }
  }

  if (user.role === "admin") {
    const settings = await getAppSettings();
    if (settings?.admin2faEnabled) {
      const method = settings.admin2faMethod || "email";
      const expiryMinutes = settings.admin2faOtpExpiryMinutes || 10;
      await issueLoginOtp(user, method, expiryMinutes);
      const pendingToken = createPendingOtpToken(user.id);
      res.json({ requiresOtp: true, pendingToken, otpMethod: method });
      return;
    }
  }

  const token = createAuthToken(user.id, user.role);
  res.json({ user: userShape(user), token });
});

router.post("/auth/verify-otp", authLimiter, async (req, res): Promise<void> => {
  const { pendingToken, code } = req.body;
  if (!pendingToken || !code) {
    res.status(400).json({ error: "Pending token and code required" });
    return;
  }
  const claims = verifyPendingOtpToken(pendingToken);
  if (!claims) {
    res.status(401).json({ error: "Invalid or expired verification session" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user || user.role !== "admin") {
    res.status(401).json({ error: "Invalid verification session" });
    return;
  }
  const [otp] = await db.select().from(adminOtpCodesTable)
    .where(and(eq(adminOtpCodesTable.userId, user.id), eq(adminOtpCodesTable.code, String(code)), eq(adminOtpCodesTable.used, false)))
    .orderBy(adminOtpCodesTable.id);
  if (!otp || otp.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }
  await db.update(adminOtpCodesTable).set({ used: true }).where(eq(adminOtpCodesTable.id, otp.id));

  const token = createAuthToken(user.id, user.role);
  res.json({ user: userShape(user), token });
});

router.post("/auth/resend-otp", authLimiter, async (req, res): Promise<void> => {
  const { pendingToken } = req.body;
  if (!pendingToken) {
    res.status(400).json({ error: "Pending token required" });
    return;
  }
  const claims = verifyPendingOtpToken(pendingToken);
  if (!claims) {
    res.status(401).json({ error: "Invalid or expired verification session" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user || user.role !== "admin") {
    res.status(401).json({ error: "Invalid verification session" });
    return;
  }
  const settings = await getAppSettings();
  const method = settings?.admin2faMethod || "email";
  const expiryMinutes = settings?.admin2faOtpExpiryMinutes || 10;
  await issueLoginOtp(user, method, expiryMinutes);
  res.json({ message: "A new verification code has been sent." });
});

router.post("/auth/register", authLimiter, async (req, res): Promise<void> => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email and password required" });
    return;
  }
  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    name, email, password: await hashPassword(password), role: "patient",
  }).returning();
  const token = createAuthToken(user.id, user.role);

  // Welcome email for newly registered patients
  sendEmail(
    email,
    "Welcome to DoctorX",
    `Hello ${name},

Your DoctorX patient account has been created successfully.

Email: ${email}

You can now log in to DoctorX to book doctor appointments, track appointments, and use our services.

Thank you for choosing DoctorX.

— DoctorX`
  ).catch(() => {});

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, doctorId: user.doctorId, createdAt: user.createdAt },
    token,
  });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ message: "Logged out successfully" });
});

const APP_URL = process.env.APP_URL || "https://doctorx.com.bd";

router.post("/auth/forgot-password", passwordResetLimiter, async (req, res): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }
  const generic = { message: "If an account exists for that email, a password reset link has been sent." };
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.json(generic);
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt, used: false });

  const resetLink = `${APP_URL}/reset-password?token=${token}`;
  const subject = "DoctorX Password Reset";
  const body = `Hello ${user.name},\n\nWe received a request to reset your DoctorX password. Click the link below to set a new password. This link expires in 1 hour.\n\n${resetLink}\n\nIf you did not request this, you can safely ignore this email.\n\n— DoctorX`;
  await sendEmail(user.email, subject, body);

  res.json(generic);
});

router.post("/auth/reset-password", passwordResetLimiter, async (req, res): Promise<void> => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ error: "Token and new password required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [resetToken] = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.token, token));
  if (!resetToken || resetToken.used || resetToken.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Invalid or expired token" });
    return;
  }
  await db.update(usersTable).set({ password: await hashPassword(newPassword) }).where(eq(usersTable.id, resetToken.userId));
  await db.update(passwordResetTokensTable).set({ used: true }).where(eq(passwordResetTokensTable.id, resetToken.id));
  res.json({ message: "Your password has been reset. You can now log in with your new password." });
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  let userId: number;
  try {
    const claims = verifyAuthToken(auth);
    if (!claims) throw new Error("bad token");
    userId = claims.userId;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const { valid } = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  await db.update(usersTable).set({ password: await hashPassword(newPassword) }).where(eq(usersTable.id, userId));
  res.json({ message: "Your password has been changed." });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const claims = verifyAuthToken(auth);
    if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      doctorId: user.doctorId,
      createdAt: user.createdAt,
    });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
