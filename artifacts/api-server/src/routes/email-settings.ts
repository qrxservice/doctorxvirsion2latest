import { Router, type IRouter } from "express";
import { db, emailLogsTable, smsLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

const smtpSettings = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587"),
  username: process.env.SMTP_USER || "",
  fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@doctorx.com.bd",
  fromName: process.env.SMTP_FROM_NAME || "DoctorX",
  enabled: process.env.SMTP_ENABLED === "true",
};

router.get("/admin/email-settings", async (_req, res): Promise<void> => {
  res.json({
    host: smtpSettings.host,
    port: smtpSettings.port,
    username: smtpSettings.username,
    fromEmail: smtpSettings.fromEmail,
    fromName: smtpSettings.fromName,
    enabled: smtpSettings.enabled,
    configured: !!smtpSettings.host,
  });
});

router.get("/admin/email-logs", async (req, res): Promise<void> => {
  const page = parseInt((req.query.page as string) || "1");
  const limit = 50;
  const logs = await db.select().from(emailLogsTable).orderBy(desc(emailLogsTable.createdAt)).limit(limit).offset((page - 1) * limit);
  res.json(logs);
});

router.get("/admin/sms-logs", async (req, res): Promise<void> => {
  const page = parseInt((req.query.page as string) || "1");
  const limit = 50;
  const logs = await db.select().from(smsLogsTable).orderBy(desc(smsLogsTable.createdAt)).limit(limit).offset((page - 1) * limit);
  res.json(logs);
});

export async function saveEmailLog(recipientEmail: string, subject: string, body: string, status = "pending", errorMessage?: string) {
  await db.insert(emailLogsTable).values({ recipientEmail, subject, body, status, errorMessage });
}

export async function saveSmsLog(phone: string, message: string, status = "pending", provider = "unset") {
  await db.insert(smsLogsTable).values({ phone, message, status, provider });
}

export default router;
