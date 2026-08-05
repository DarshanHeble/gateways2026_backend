/**
 * Auth Repository
 *
 * All database access for the auth domain (users, sessions, accounts, verification_tokens).
 * Every function accepts a `db` parameter — never calls getAppDb() internally —
 * so callers control which pool is used and can pass a transaction object.
 *
 * Security invariants:
 *   - findUserByEmail / findUserById NEVER return passwordHash to callers.
 *     Internal helpers that need the hash are separate (findUserWithHashByEmail).
 *   - Sessions store the SHA-256 hash of the raw token — not the raw token itself.
 *   - OTPs are stored as bcrypt hashes — never as plaintext.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { accounts, sessions, users, verificationTokens } from '../db/schema/auth.js';
import { withTransaction } from '../db/transaction.js';

type Db = MySql2Database<typeof schema>;

// ─── Exported User Types ───────────────────────────────────────────────────────

/** Public-safe user object — no passwordHash */
export type PublicUser = Omit<schema.User, 'passwordHash'>;

/** Internal-only user with hash — only used inside signinWithPassword */
export type UserWithHash = schema.User;

// ─── User Queries ─────────────────────────────────────────────────────────────

/**
 * Find a user by email (case-insensitive).
 * Returns public fields only — passwordHash excluded.
 */
export async function findUserByEmail(db: Db, email: string): Promise<PublicUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(sql`LOWER(${users.email})`, email.toLowerCase()))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Find a user by email INCLUDING passwordHash.
 * For INTERNAL use by signinWithPassword only — never expose to API callers.
 */
export async function findUserWithHashByEmail(db: Db, email: string): Promise<UserWithHash | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(sql`LOWER(${users.email})`, email.toLowerCase()))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Find a user by ID (public fields only, no passwordHash).
 * Used by the session hook to re-validate the authenticated user.
 */
export async function findUserById(db: Db, id: string): Promise<PublicUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Create a new user + an empty profile placeholder in a single transaction.
 * passwordHash is null for OAuth users (email-only creation).
 *
 * Returns the created user's ID.
 */
export async function createUser(
  db: Db,
  params: { id: string; email: string; passwordHash?: string },
): Promise<string> {
  await withTransaction(db, async (tx) => {
    await tx.insert(users).values({
      id: params.id,
      email: params.email.toLowerCase(),
      passwordHash: params.passwordHash ?? null,
      status: 'ACTIVE',
    });
    // Profile row will be inserted here once identity schema is implemented (Phase 4).
    // For now, the user row alone is sufficient for auth.
  });
  return params.id;
}

/**
 * Mark a user's email as verified (called after successful OTP verification).
 */
export async function markEmailVerified(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerified: sql`now()` })
    .where(eq(users.id, userId));
}

// ─── Session Queries ──────────────────────────────────────────────────────────

/** Result shape for findSessionByHashedToken — user + session combined */
export interface SessionWithUser {
  session: schema.Session;
  user: PublicUser;
}

/**
 * Look up a session by its hashed token (SHA-256 of the raw cookie value).
 * Joins sessions → users. Returns null if not found or expired.
 */
export async function findSessionByHashedToken(
  db: Db,
  hashedToken: string,
): Promise<SessionWithUser | null> {
  const now = new Date();

  const rows = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        status: users.status,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.sessionToken, hashedToken),
        // Filter out expired sessions at query time
        sql`${sessions.expires} > ${now.toISOString()}`,
      ),
    )
    .limit(1);

  if (!rows[0]) return null;

  return {
    session: rows[0].session,
    user: rows[0].user as PublicUser,
  };
}

/**
 * Create a new session row (stores the hashed token — raw token stays in cookie).
 */
export async function createSession(
  db: Db,
  params: { id: string; userId: string; hashedToken: string; expires: Date },
): Promise<void> {
  await db.insert(sessions).values({
    id: params.id,
    sessionToken: params.hashedToken,
    userId: params.userId,
    expires: params.expires,
  });
}

/**
 * Slide the session expiry window forward (called on every valid authenticated request).
 * Only slides if the session is within the last day of its window to avoid
 * hammering the DB on every single request.
 */
export async function touchSession(
  db: Db,
  sessionId: string,
  newExpires: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ expires: newExpires })
    .where(eq(sessions.id, sessionId));
}

/**
 * Delete a session row (logout / revocation).
 * Silently succeeds if the token is already gone.
 */
export async function deleteSession(db: Db, hashedToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionToken, hashedToken));
}

/**
 * Purge all sessions that have passed their expiry date.
 * Call on server startup and/or periodically to keep the table lean.
 */
export async function deleteExpiredSessions(db: Db): Promise<void> {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expires, now));
}

// ─── Verification Token (OTP) Queries ────────────────────────────────────────

/**
 * Upsert a verification token row for an email address.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE to replace any existing OTP
 * (handles "resend OTP" gracefully without a separate delete step).
 */
export async function upsertVerificationToken(
  db: Db,
  params: {
    identifier: string; // email address
    hashedOtp: string;  // bcrypt hash of the 6-digit OTP
    expires: Date;
    purpose?: string;
  },
): Promise<void> {
  const purpose = params.purpose ?? 'EMAIL_VERIFICATION';

  // Delete any existing token for this identifier+purpose before inserting
  // (composite PK is identifier+token, so ON DUPLICATE KEY UPDATE won't cleanly
  // handle purpose-scoped upserts — explicit delete + insert is safer)
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, params.identifier),
        eq(verificationTokens.purpose, purpose),
      ),
    );

  await db.insert(verificationTokens).values({
    identifier: params.identifier,
    token: params.hashedOtp,
    expires: params.expires,
    purpose,
  });
}

/**
 * Find the stored verification token row for a given email + purpose.
 * Returns null if no pending OTP exists.
 */
export async function findVerificationToken(
  db: Db,
  identifier: string,
  purpose: string = 'EMAIL_VERIFICATION',
): Promise<schema.VerificationToken | null> {
  const rows = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.purpose, purpose),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Delete (consume) a verification token row after successful OTP verification.
 * Call this AFTER the OTP has been verified — part of the atomic verify step.
 */
export async function consumeVerificationToken(
  db: Db,
  identifier: string,
  purpose: string = 'EMAIL_VERIFICATION',
): Promise<void> {
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.purpose, purpose),
      ),
    );
}

// ─── OAuth Account Queries ────────────────────────────────────────────────────

/**
 * Find an existing OAuth linked account by provider + providerAccountId.
 * Returns null if this Google account has never signed in before.
 */
export async function findOAuthAccount(
  db: Db,
  provider: string,
  providerAccountId: string,
): Promise<schema.Account | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Upsert an OAuth account row (create on first sign-in, update tokens on subsequent sign-ins).
 */
export async function upsertOAuthAccount(
  db: Db,
  params: schema.NewAccount,
): Promise<void> {
  await db
    .insert(accounts)
    .values(params)
    .onDuplicateKeyUpdate({
      set: {
        refreshToken: params.refreshToken,
        accessToken: params.accessToken,
        expiresAt: params.expiresAt,
        idToken: params.idToken,
        scope: params.scope,
        tokenType: params.tokenType,
        sessionState: params.sessionState,
      },
    });
}

/**
 * Atomic find-or-create for Google OAuth sign-in:
 *  1. Check if the OAuth account already exists → return linked userId.
 *  2. If not: check if a user with this email already exists (manual account) → link to it.
 *  3. If not: create a new user (email-verified, no password) + link the OAuth account.
 *
 * All steps run inside a single transaction.
 * Returns the userId to create a session for.
 */
export async function findOrCreateOAuthUser(
  db: Db,
  params: {
    userId: string;         // pre-generated UUID for potential new user
    accountId: string;      // pre-generated UUID for accounts row
    email: string;
    provider: string;
    providerAccountId: string;
    googleProfile: {
      name?: string;
      picture?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      idToken?: string;
      scope?: string;
    };
  },
): Promise<string> {
  return withTransaction(db, async (tx) => {
    // Step 1: existing OAuth account?
    const existingAccount = await findOAuthAccount(tx as Db, params.provider, params.providerAccountId);
    if (existingAccount) {
      // Refresh tokens while we're here
      await upsertOAuthAccount(tx as Db, {
        id: existingAccount.id,
        userId: existingAccount.userId,
        type: 'oauth',
        provider: params.provider,
        providerAccountId: params.providerAccountId,
        accessToken: params.googleProfile.accessToken,
        refreshToken: params.googleProfile.refreshToken ?? null,
        expiresAt: params.googleProfile.expiresAt ?? null,
        idToken: params.googleProfile.idToken ?? null,
        scope: params.googleProfile.scope ?? null,
        tokenType: 'Bearer',
        sessionState: null,
      });
      return existingAccount.userId;
    }

    // Step 2: existing user with same email?
    const existingUserRows = await (tx as Db)
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`LOWER(${users.email})`, params.email.toLowerCase()))
      .limit(1);

    let targetUserId: string;

    if (existingUserRows[0]) {
      // Link OAuth account to existing manual account
      targetUserId = existingUserRows[0].id;
    } else {
      // Step 3: brand new user — create with email pre-verified (Google vouches for it)
      await (tx as Db).insert(users).values({
        id: params.userId,
        email: params.email.toLowerCase(),
        passwordHash: null,
        status: 'ACTIVE',
        emailVerified: new Date(),
      });
      targetUserId = params.userId;
    }

    // Insert the OAuth account row
    await upsertOAuthAccount(tx as Db, {
      id: params.accountId,
      userId: targetUserId,
      type: 'oauth',
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      accessToken: params.googleProfile.accessToken ?? null,
      refreshToken: params.googleProfile.refreshToken ?? null,
      expiresAt: params.googleProfile.expiresAt ?? null,
      idToken: params.googleProfile.idToken ?? null,
      scope: params.googleProfile.scope ?? null,
      tokenType: 'Bearer',
      sessionState: null,
    });

    return targetUserId;
  });
}
