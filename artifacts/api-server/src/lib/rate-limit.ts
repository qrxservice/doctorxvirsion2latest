import rateLimit from "express-rate-limit";

// Login/OTP endpoints: throttle brute-force and credential-stuffing attempts.
// Keyed by IP (default); 15-minute window is generous for real users retrying
// a typo'd password but slows down automated guessing meaningfully.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

// Password reset requests: prevent email/SMS bombing of a target address/phone
// and prevent brute-forcing the reset token itself.
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// Public lookup endpoints (appointment tracking by phone, prescription
// verification by reference number): no auth by design, so rate limiting is
// the main defense against enumeration/scraping.
export const publicLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
