/**
 * Password hashing utilities (bcryptjs)
 *
 * - hashPassword: used at signup (12 rounds, ~250ms)
 * - verifyPassword: used at signin (timing-safe bcrypt compare)
 *
 * Cost factor 12 is the minimum recommended for production (2026 hardware).
 * Never lower below 10; never exceed 14 without profiling.
 */

import bcrypt from 'bcryptjs';

const PASSWORD_SALT_ROUNDS = 12;

/**
 * Hash a plain-text password with bcrypt (12 rounds).
 * Always await this — it is CPU-blocking and takes ~250ms.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_SALT_ROUNDS);
}

/**
 * Timing-safe comparison of a plain-text password against a stored bcrypt hash.
 * Returns false (never throws) on mismatch — caller must map to INVALID_CREDENTIALS.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
