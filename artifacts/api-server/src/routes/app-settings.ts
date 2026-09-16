import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appSettingsTable, usersTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

async function getRole(auth: string | undefined): Promise<string | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    // Trust the persisted role, not the token's role claim.
    return user?.role ?? null;
  } catch { return null; }
}

async function ensureAppSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

function serialize(settings: typeof appSettingsTable.$inferSelect) {
  return {
    prescriptionQrEnabled: settings.prescriptionQrEnabled,
    noticeText: settings.noticeText ?? null,
    noticeEnabled: settings.noticeEnabled,
    heroImageUrl: settings.heroImageUrl ?? null,
    heroOverlayColor: settings.heroOverlayColor,
    heroOverlayOpacity: settings.heroOverlayOpacity,
    themeColorsEnabled: settings.themeColorsEnabled,
    themePrimaryLight: settings.themePrimaryLight ?? null,
    themePrimaryDark: settings.themePrimaryDark ?? null,
    themeBgLight: settings.themeBgLight ?? null,
    themeBgDark: settings.themeBgDark ?? null,
    doctorCardLight: settings.doctorCardLight ?? null,
    doctorCardDark: settings.doctorCardDark ?? null,
    shopEnabled: settings.shopEnabled ?? true,
    donationEnabled: settings.donationEnabled ?? false,
    donationAmount: settings.donationAmount ?? 100,
    donationAmountUsd: settings.donationAmountUsd ?? 1,
    donationMessage: settings.donationMessage ?? null,
    siteLogoUrl: settings.siteLogoUrl ?? null,
    siteLogoWidth: settings.siteLogoWidth ?? 32,
    siteLogoHeight: settings.siteLogoHeight ?? 32,
    faviconUrl: settings.faviconUrl ?? null,
    footerLogoUrl: settings.footerLogoUrl ?? null,
    footerSiteName: settings.footerSiteName ?? null,
    footerTagline: settings.footerTagline ?? null,
    footerCopyrightText: settings.footerCopyrightText ?? null,
    footerAbout: settings.footerAbout ?? null,
  };
}

// Public — used by the prescription print view (QR) and homepage (hero background).
router.get("/app-settings", async (_req, res): Promise<void> => {
  const settings = await ensureAppSettings();
  res.json(serialize(settings));
});

// Admin only — global prescription QR toggle, notice, and homepage hero.
router.put("/admin/app-settings", async (req, res): Promise<void> => {
  const role = await getRole(req.headers.authorization);
  if (role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const current = await ensureAppSettings();

  const updates: Record<string, unknown> = {};
  if (typeof req.body.prescriptionQrEnabled === "boolean") {
    updates.prescriptionQrEnabled = req.body.prescriptionQrEnabled;
  }
  if (req.body.noticeText !== undefined) updates.noticeText = req.body.noticeText;
  if (typeof req.body.noticeEnabled === "boolean") updates.noticeEnabled = req.body.noticeEnabled;
  if (req.body.heroImageUrl !== undefined) updates.heroImageUrl = req.body.heroImageUrl || null;
  if (typeof req.body.heroOverlayColor === "string") updates.heroOverlayColor = req.body.heroOverlayColor;
  if (typeof req.body.heroOverlayOpacity === "number") {
    updates.heroOverlayOpacity = Math.max(0, Math.min(100, Math.round(req.body.heroOverlayOpacity)));
  }
  if (typeof req.body.themeColorsEnabled === "boolean") updates.themeColorsEnabled = req.body.themeColorsEnabled;
  if (typeof req.body.shopEnabled === "boolean") updates.shopEnabled = req.body.shopEnabled;
  for (const key of [
    "themePrimaryLight", "themePrimaryDark", "themeBgLight", "themeBgDark", "doctorCardLight", "doctorCardDark",
    "siteLogoUrl", "faviconUrl", "footerLogoUrl",
  ] as const) {
    if (req.body[key] !== undefined) updates[key] = req.body[key] || null;
  }
  if (typeof req.body.siteLogoWidth === "number") updates.siteLogoWidth = Math.max(8, Math.round(req.body.siteLogoWidth));
  if (typeof req.body.siteLogoHeight === "number") updates.siteLogoHeight = Math.max(8, Math.round(req.body.siteLogoHeight));
  // Footer content fields
  if (req.body.footerSiteName !== undefined) updates.footerSiteName = req.body.footerSiteName || null;
  if (req.body.footerTagline !== undefined) updates.footerTagline = req.body.footerTagline || null;
  if (req.body.footerCopyrightText !== undefined) updates.footerCopyrightText = req.body.footerCopyrightText || null;
  if (req.body.footerAbout !== undefined) updates.footerAbout = req.body.footerAbout || null;

  const [settings] = await db.update(appSettingsTable).set(updates)
    .where(eq(appSettingsTable.id, current.id)).returning();
  res.json(serialize(settings));
});

export default router;
