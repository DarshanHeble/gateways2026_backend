/**
 * Session token & OTP utilities (Node built-in crypto + bcryptjs)
 *
 * Session tokens:
 *   - generateSessionToken()  → 64-char hex opaque token (goes in httpOnly cookie)
 *   - hashSessionToken()      → SHA-256 hash of token (stored in DB `sessions.session_token`)
 *   Security: even if the DB is leaked, active sessions are not compromised.
 *
 * OTP (email verification):
 *   - generateOtp()           → 6-digit numeric OTP string
 *   - hashOtp()               → bcrypt hash at 10 rounds (stored in `verification_tokens.token`)
 *   - verifyOtp()             → timing-safe bcrypt compare for OTP verification
 *   Cost factor 10 is appropriate here: OTPs are short-lived (15 min) so
 *   brute-force is time-limited by expiry, not just hashing cost.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const OTP_SALT_ROUNDS = 10;

// ─── Session Token ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 64-character hex session token.
 * This raw token is placed in the signed httpOnly `__session` cookie.
 * It is NEVER stored in the database — only its SHA-256 hash is.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * SHA-256 hash of the raw session token for safe database storage.
 * Lookup: hash the cookie value → query sessions.session_token.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 6-digit numeric OTP.
 * Uses crypto.randomInt for uniform distribution (not Math.random).
 */
export function generateOtp(): string {
  // randomInt(min, max) → [min, max) so upper bound is 1_000_000 for 6 digits
  return crypto.randomInt(100_000, 1_000_000).toString();
}

/**
 * Bcrypt-hash an OTP at 10 rounds for DB storage.
 * Always store the hash; send the plaintext OTP via email.
 */
export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, OTP_SALT_ROUNDS);
}

/**
 * Timing-safe comparison of a submitted OTP string against its stored bcrypt hash.
 * Returns false on mismatch — caller maps this to INVALID_CREDENTIALS.
 */
export async function verifyOtp(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}
