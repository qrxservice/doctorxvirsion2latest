/**
 * Public display endpoint — read-only, no auth required.
 * Used by /display/:deviceId kiosk pages on TVs, tablets, mobile.
 * Never exposes patient private data, admin APIs, or write surfaces.
 */
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  queueDisplayDevicesTable,
  queueEntriesTable,
  doctorsTable,
  appSettingsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/display/:deviceId", async (req, res): Promise<void> => {
  const deviceId = parseInt(req.params.deviceId);
  if (Number.isNaN(deviceId)) {
    res.status(400).json({ error: "Invalid deviceId" });
    return;
  }

  const [device] = await db
    .select()
    .from(queueDisplayDevicesTable)
    .where(eq(queueDisplayDevicesTable.id, deviceId));

  if (!device) {
    res.status(404).json({ error: "Display device not found" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const doctorId = device.doctorId;

  const [doc, entries, settings] = await Promise.all([
    db
      .select()
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .then((r) => r[0]),
    db
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.doctorId, doctorId),
          eq(queueEntriesTable.queueDate, today),
        ),
      ),
    db
      .select()
      .from(appSettingsTable)
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const serving = entries.find((e) => e.status === "serving");
  const waiting = entries
    .filter((e) => e.status === "waiting")
    .sort((a, b) => a.serialNo - b.serialNo);
  const seen = entries.filter((e) => e.status === "seen");

  const breakUntilDate = doc?.breakUntil ? new Date(doc.breakUntil) : null;
  const isOnBreak =
    doc?.onlineStatus === "busy" &&
    breakUntilDate != null &&
    breakUntilDate > new Date();

  const showPatientName = device.showPatientName ?? true;
  const showDoctorName = device.showDoctorName ?? true;

  res.json({
    // Device config
    deviceId: device.id,
    deviceName: device.name,
    displayType: device.displayType,
    orientation: device.orientation,
    fontSize: device.fontSize,
    layoutSize: device.layoutSize,
    fullscreen: device.fullscreen,
    theme: device.theme ?? "dark",
    showPatientName,
    showDoctorName,
    voiceEnabled: device.voiceEnabled ?? false,
    voiceLanguage: device.voiceLanguage ?? "en",
    // Doctor / chamber info
    doctorId,
    doctorName: showDoctorName ? (doc?.name ?? null) : null,
    chamberAddress: doc?.chamberAddress ?? null,
    chamberAddress2: doc?.chamberAddress2 ?? null,
    doctorStatus: doc?.onlineStatus ?? "offline",
    breakUntil: isOnBreak ? breakUntilDate!.toISOString() : null,
    // Queue state
    currentSerial: serving?.serialNo ?? null,
    currentPatientName:
      showPatientName ? (serving?.patientName ?? null) : null,
    nextSerial: waiting[0]?.serialNo ?? null,
    nextPatients: waiting.slice(0, 5).map((e) => ({
      serialNo: e.serialNo,
      patientName: showPatientName ? e.patientName : `#${e.serialNo}`,
    })),
    totalWaiting: waiting.length,
    totalCompleted: seen.length,
    totalToday: entries.length,
    // Branding
    logoUrl: settings?.siteLogoUrl ?? null,
    siteLogoWidth: settings?.siteLogoWidth ?? 32,
    siteLogoHeight: settings?.siteLogoHeight ?? 32,
  });
});

export default router;
