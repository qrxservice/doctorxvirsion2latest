import geoip from "geoip-lite";
import type { Request } from "express";
import type { appSettingsTable } from "@workspace/db";

export type Currency = "BDT" | "USD";

type AppSettings = typeof appSettingsTable.$inferSelect;

/** RFC1918 / loopback / link-local ranges that Replit's own proxy hops use
 *  internally (e.g. "10.x.x.x", "127.0.0.1"). These can never be the real
 *  visitor's IP, so they must be skipped when scanning X-Forwarded-For. */
function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  if (v4 === "127.0.0.1" || v4 === "::1") return true;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/** Best-effort client IP extraction for GeoIP currency resolution.
 *
 *  X-Forwarded-For is a comma-separated hop chain: "<original client>,
 *  <proxy1>, <proxy2>, ...". Replit's own infrastructure appends its
 *  *internal* hop IPs (10.x.x.x, 127.0.0.1, etc.) to the right of whatever
 *  arrived, so the rightmost entry is NOT the real client IP — it is
 *  Replit's own proxy mesh. The real visitor IP, when present, is the
 *  rightmost entry that is NOT a private/reserved address, since a client
 *  can only forge entries further to the left of the chain.
 *
 *  Falls back to the raw socket address when no usable XFF entry is found
 *  (e.g. direct curl from within the container, or Replit's dev/workspace
 *  preview proxy which does not forward the browser's real IP at all).
 *
 *  NOTE: this is best-effort geo-detection, not an authentication boundary.
 *  The currency frozen onto each entity at registration/booking time is the
 *  authoritative value for all subsequent billing operations. */
export function getClientIp(req: Request): string {
  // Cloudflare provides the original visitor IP in CF-Connecting-IP.
  // Nginx forwards this header to the API server.
  const cfIp = req.headers["cf-connecting-ip"];

  if (typeof cfIp === "string") {
    const ip = cfIp.trim();
    if (ip && !isPrivateOrReservedIp(ip)) {
      return ip;
    }
  }

  // Fallback for non-Cloudflare requests.
  const xff = req.headers["x-forwarded-for"];

  if (xff) {
    const forwarded = Array.isArray(xff) ? xff.join(",") : xff;
    const ips = forwarded.split(",").map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < ips.length; i++) {
      if (!isPrivateOrReservedIp(ips[i])) {
        return ips[i];
      }
    }
  }

  const socketIp = req.socket?.remoteAddress ?? "";
  return isPrivateOrReservedIp(socketIp) ? "" : socketIp;
}

/** Resolve an ISO 3166-1 alpha-2 country code from the request's IP address
 *  using an offline GeoIP database (no external API calls). Returns null if
 *  the IP is missing, private/local, or not found in the database. */
export function detectCountryCode(req: Request): string | null {
  try {
    const ip = getClientIp(req);
    if (!ip) return null;
    const geo = geoip.lookup(ip);
    return geo?.country ?? null;
  } catch {
    return null;
  }
}

/** Resolve the billing currency for a request: Bangladesh -> BDT, every
 *  other country (or failed/undetermined lookup) -> USD. This is always
 *  computed server-side from the request's IP — never trust a client-
 *  supplied currency, since that would let fees be spoofed. */
export function resolveCurrencyFromRequest(req: Request): { currency: Currency; countryCode: string | null } {
  const countryCode = detectCountryCode(req);
  return { currency: countryCode === "BD" ? "BDT" : "USD", countryCode };
}

export function currencySymbol(currency: Currency): string {
  return currency === "BDT" ? "৳" : "$";
}

export interface DoctorTier {
  maxYears: number | null; // null = open-ended (top tier)
  fee: number;
}

/** Build the 3 admin-configured validity-year tiers for a currency, in order. */
export function getDoctorTiers(currency: Currency, settings: AppSettings): DoctorTier[] {
  if (currency === "BDT") {
    return [
      { maxYears: settings.bdtTier1MaxYears, fee: settings.bdtTier1Fee },
      { maxYears: settings.bdtTier2MaxYears, fee: settings.bdtTier2Fee },
      { maxYears: null, fee: settings.bdtTier3Fee },
    ];
  }
  return [
    { maxYears: settings.usdTier1MaxYears, fee: settings.usdTier1Fee },
    { maxYears: settings.usdTier2MaxYears, fee: settings.usdTier2Fee },
    { maxYears: null, fee: settings.usdTier3Fee },
  ];
}

/** Admin-configurable doctor subscription fee, by BMDC validity years and
 *  currency. Replaces the old hardcoded calcSubscriptionFee tiers. */
export function calcTieredDoctorFee(years: number, currency: Currency, settings: AppSettings): number {
  const tiers = getDoctorTiers(currency, settings);
  for (const tier of tiers) {
    if (tier.maxYears === null || years <= tier.maxYears) return tier.fee;
  }
  return tiers[tiers.length - 1].fee;
}

export function getMonthlySubscriptionFee(currency: Currency, settings: AppSettings): number {
  return currency === "BDT" ? settings.monthlySubscriptionFee : settings.monthlySubscriptionFeeUsd;
}

export function getDonationAmount(currency: Currency, settings: AppSettings): number {
  return currency === "BDT" ? settings.donationAmount : settings.donationAmountUsd;
}
