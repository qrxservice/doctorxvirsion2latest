import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

// bcrypt hashes always start with one of these version prefixes.
function looksHashed(value: string): boolean {
  return /^\$2[aby]?\$/.test(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Verify a candidate password against the stored value.
 *
 * Legacy accounts created before bcrypt hashing was introduced still have
 * their password stored as plaintext. To migrate them without forcing a
 * password reset, we fall back to a plain comparison when the stored value
 * doesn't look like a bcrypt hash, and report `needsRehash: true` so the
 * caller can transparently upgrade the stored value on successful login.
 */
export async function verifyPassword(
  candidate: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (looksHashed(stored)) {
    const valid = await bcrypt.compare(candidate, stored);
    return { valid, needsRehash: false };
  }
  // Legacy plaintext row.
  const valid = candidate === stored;
  return { valid, needsRehash: valid };
}
