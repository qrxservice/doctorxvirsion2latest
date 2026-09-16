import { createHmac, timingSafeEqual } from "crypto";

// Auth tokens are HMAC-signed so a forged userId cannot impersonate another user.
// Format: base64url(`userId:role:ts`) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET)).
// The persisted role/doctorId is always re-read from the DB; the token's role claim is
// only a hint. Without a valid signature the token is rejected (fail closed).

const SECRET = process.env.SESSION_SECRET || "";

// A missing secret would silently sign/verify every token with an empty
// key, which is not just weak — it means any client can forge a valid
// token offline. Fail loudly at startup instead of running an insecure API.
if (!SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable is required but was not provided. " +
      "Set it as a secret before starting the server.",
  );
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createAuthToken(userId: number, role: string): string {
  const payload = Buffer.from(`${userId}:${role}:${Date.now()}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export interface TokenClaims {
  userId: number;
  role: string;
  ts: number;
}

export function verifyAuthToken(auth: string | undefined): TokenClaims | null {
  if (!auth || !SECRET) return null;
  const raw = auth.replace("Bearer ", "").trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const [idRaw, role, tsRaw] = Buffer.from(payload, "base64url").toString().split(":");
    const userId = parseInt(idRaw);
    if (!userId) return null;
    return { userId, role: role ?? "", ts: parseInt(tsRaw) || 0 };
  } catch {
    return null;
  }
}

// Convenience for the many call sites that only need the authenticated userId.
export function getUserIdFromAuth(auth: string | undefined): number | null {
  return verifyAuthToken(auth)?.userId ?? null;
}

// Short-lived token issued after password verification but before the OTP
// step of Master Admin 2-step login completes. It only ever proves "this
// userId passed the password check recently" — it cannot be used as an auth
// token because verifyAuthToken() checks for a different role marker.
const PENDING_OTP_ROLE = "__pending_otp__";
const PENDING_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete OTP step

export function createPendingOtpToken(userId: number): string {
  const payload = Buffer.from(`${userId}:${PENDING_OTP_ROLE}:${Date.now()}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyPendingOtpToken(token: string): { userId: number } | null {
  const claims = verifyAuthToken(token);
  if (!claims || claims.role !== PENDING_OTP_ROLE) return null;
  if (Date.now() - claims.ts > PENDING_OTP_TTL_MS) return null;
  return { userId: claims.userId };
}
