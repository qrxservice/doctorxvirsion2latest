import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import {
  resolveCurrencyFromRequest, currencySymbol, getDoctorTiers,
  getMonthlySubscriptionFee, getDonationAmount,
} from "../lib/currency";

const router: IRouter = Router();

async function ensureAppSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

/** Public: auto-detected currency + admin-configured pricing for the
 *  requester's country. Used by the frontend to show fees/donation amounts
 *  in the currency that will actually be charged (BDT for Bangladesh, USD
 *  everywhere else / when detection fails). */
router.get("/pricing", async (req, res): Promise<void> => {
  const { currency, countryCode } = resolveCurrencyFromRequest(req);
  const settings = await ensureAppSettings();

  res.json({
    currency,
    countryCode,
    currencySymbol: currencySymbol(currency),
    doctorSubscriptionTiers: getDoctorTiers(currency, settings),
    monthlySubscriptionFee: getMonthlySubscriptionFee(currency, settings),
    donation: {
      enabled: settings.donationEnabled,
      amount: getDonationAmount(currency, settings),
      message: settings.donationMessage ?? null,
    },
  });
});

export default router;
