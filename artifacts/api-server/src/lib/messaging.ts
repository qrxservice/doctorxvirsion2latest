import nodemailer from "nodemailer";
import { db, appSettingsTable, emailLogsTable, smsLogsTable } from "@workspace/db";
import { logger } from "./logger";

async function loadSettings() {
  const [s] = await db.select().from(appSettingsTable).limit(1);
  return s ?? null;
}

// Send an email using admin-configured SMTP when enabled/configured; otherwise
// the message is recorded in email_logs so nothing is silently dropped.
export async function sendEmail(recipientEmail: string, subject: string, body: string): Promise<void> {
  const s = await loadSettings();
  const configured = !!(s?.smtpEnabled && s.smtpHost && s.smtpUser && s.smtpPassword);
  if (!configured || !s) {
    await db.insert(emailLogsTable).values({ recipientEmail, subject, body, status: "logged" });
    return;
  }
  try {
    const transport = nodemailer.createTransport({
      host: s.smtpHost!,
      port: s.smtpPort ?? 587,
      secure: (s.smtpPort ?? 587) === 465,
      auth: { user: s.smtpUser!, pass: s.smtpPassword! },
    });
    await transport.sendMail({
      from: s.smtpFromName ? `${s.smtpFromName} <${s.smtpFromEmail ?? s.smtpUser}>` : (s.smtpFromEmail ?? s.smtpUser!),
      to: recipientEmail,
      subject,
      text: body,
    });
    await db.insert(emailLogsTable).values({ recipientEmail, subject, body, status: "sent" });
  } catch (err) {
    logger.error({ err }, "SMTP send failed");
    await db.insert(emailLogsTable).values({
      recipientEmail, subject, body, status: "failed",
      errorMessage: err instanceof Error ? err.message : "send failed",
    });
  }
}

// Send an SMS via the admin-configured provider when enabled/configured;
// otherwise the message is recorded in sms_logs.
export async function sendSms(phone: string, message: string): Promise<void> {
  const s = await loadSettings();
  const configured = !!(s?.smsEnabled && s.smsProvider && s.smsApiKey);
  if (!configured || !s) {
    await db.insert(smsLogsTable).values({ phone, message, status: "logged", provider: s?.smsProvider ?? "unset" });
    return;
  }
  try {
    // Generic provider call. SMS gateways differ; this posts a common shape and
    // records the outcome. Admins set provider/apiKey/senderId in settings.
    const res = await fetch(s.smsProvider!, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.smsApiKey}` },
      body: JSON.stringify({ to: phone, from: s.smsSenderId ?? undefined, message }),
    });
    await db.insert(smsLogsTable).values({
      phone, message, provider: s.smsProvider!,
      status: res.ok ? "sent" : "failed",
      errorMessage: res.ok ? null : `HTTP ${res.status}`,
    });
  } catch (err) {
    logger.error({ err }, "SMS send failed");
    await db.insert(smsLogsTable).values({
      phone, message, provider: s.smsProvider!, status: "failed",
      errorMessage: err instanceof Error ? err.message : "send failed",
    });
  }
}
