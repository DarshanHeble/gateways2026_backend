import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getAppDb } from '../db/index.js';
import { createSession } from '../repositories/auth.repository.js';
import { generateSessionToken, hashSessionToken } from '../security/jwt.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';
import { SESSION_COOKIE_NAME } from './jwt-auth.js';

/**
 * Auth-transport security matrix.
 *
 * Two credentials now reach the same session store: the httpOnly `__session`
 * cookie (website) and an `Authorization: Bearer` header (admin dashboard,
 * mobile). CSRF protection is skipped for the Bearer path, which is only sound
 * if a forged Authorization header can never suppress the check while riding a
 * victim's cookie.
 *
 * The cases below are the ones where a mistake is a real vulnerability or a
 * total client lockout, rather than a visible bug.
 */

const db = getAppDb();
let app: FastifyInstance;
const cleanupUserIds: string[] = [];

/** Insert a real session row and return both credential forms for the same token. */
async function createTestSession(
  userId: string,
  expiresInMs = 60 * 60 * 1000,
): Promise<{ rawToken: string; signedCookie: string }> {
  const rawToken = generateSessionToken();
  await createSession(db, {
    id: uuidv7(),
    userId,
    hashedToken: hashSessionToken(rawToken),
    expires: new Date(Date.now() + expiresInMs),
  });
  return { rawToken, signedCookie: app.signCookie(rawToken) };
}

async function newUser(overrides?: { status?: string }) {
  const user = await createTestUser(db, overrides);
  cleanupUserIds.push(user.id);
  return user;
}

beforeAll(async () => {
  ({ app } = await buildApp());
  await app.ready();
});

afterAll(async () => {
  for (const id of cleanupUserIds) await deleteTestUser(db, id);
  await app.close();
});

describe('auth transport — session recognition', () => {
  it('accepts a cookie-authenticated request', async () => {
    const user = await newUser();
    const { signedCookie } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE_NAME]: signedCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });

  it('accepts a Bearer-authenticated request as the same user', async () => {
    const user = await newUser();
    const { rawToken } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${rawToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });

  // ★ The signed cookie value is `<raw>.<hmac>`. Only the raw token is a valid
  // Bearer. Accepting the signed form would mean a leaked cookie value works as
  // an API token.
  it('rejects the SIGNED cookie value presented as a Bearer token', async () => {
    const user = await newUser();
    const { signedCookie } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${signedCookie}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a garbage Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired Bearer session', async () => {
    const user = await newUser();
    const { rawToken } = await createTestSession(user.id, -60_000); // already expired

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${rawToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a Bearer session belonging to a BANNED user', async () => {
    const user = await newUser({ status: 'BANNED' });
    const { rawToken } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${rawToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('accepts odd casing and whitespace in the Authorization header', async () => {
    const user = await newUser();
    const { rawToken } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { authorization: `BEARER   ${rawToken}  ` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects a request with no credentials at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth transport — CSRF interaction', () => {
  const receiptBody = {
    fileData: 'data:application/pdf;base64,JVBERi0xLjQK',
    fileName: 'receipt.pdf',
    fileSizeBytes: 9,
    paymentMethod: 'upi',
    transactionReference: 'TEST-AUTH-TRANSPORT-001',
  };

  // ★ The cookie path must keep full CSRF enforcement.
  it('still rejects a cookie-authenticated POST with no CSRF header', async () => {
    const user = await newUser();
    const { signedCookie } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payment-receipts',
      cookies: { [SESSION_COOKIE_NAME]: signedCookie },
      payload: receiptBody,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('CSRF');
  });

  it('allows a Bearer-authenticated POST with no CSRF cookie or header', async () => {
    const user = await newUser();
    const { rawToken } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payment-receipts',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: receiptBody,
    });

    // Past CSRF and past auth — fails later, at Cloudinary, which is not configured
    // in tests. The point is that it was not rejected as a CSRF failure.
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  // ★★ The bypass test. A forged Bearer header must not disable CSRF while the
  // victim's cookie silently authenticates the request. This is exactly why
  // extractSessionToken returns null on a malformed Bearer instead of falling
  // back to the cookie.
  it('rejects a garbage Bearer + victim cookie POST with no CSRF header', async () => {
    const user = await newUser();
    const { signedCookie } = await createTestSession(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payment-receipts',
      headers: { authorization: 'Bearer forged-token' },
      cookies: { [SESSION_COOKIE_NAME]: signedCookie },
      payload: receiptBody,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('CSRF');
  });

  // ★ Guards the CSRF exempt list against the /api/v1 prefix move. If this
  // regresses, every client is locked out of signin.
  it('does not CSRF-block signin, which is exempt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: 'nobody@example.com', password: 'whatever123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('auth transport — credential issuance is mutually exclusive', () => {
  // ★ Both of these guard the httpOnly guarantee: a browser session's token must
  // never also appear in a JS-readable response body.
  it('returns a token and sets NO session cookie for X-Auth-Transport: bearer', async () => {
    const password = 'correct-horse-battery';
    const user = await newUser();
    await seedPassword(user.id, password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      headers: { 'x-auth-transport': 'bearer' },
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf('string');
    expect(setCookieNames(res)).not.toContain(SESSION_COOKIE_NAME);
  });

  it('sets a session cookie and returns NO token by default', async () => {
    const password = 'correct-horse-battery';
    const user = await newUser();
    await seedPassword(user.id, password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeUndefined();
    expect(setCookieNames(res)).toContain(SESSION_COOKIE_NAME);
  });
});

function setCookieNames(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => c.split('=')[0]);
}

/** Give a test user a usable password + verified email so signin can succeed. */
async function seedPassword(userId: string, password: string): Promise<void> {
  const { hashPassword } = await import('../security/password.js');
  const { users } = await import('../db/schema/auth.js');
  const { eq } = await import('drizzle-orm');
  const { sql } = await import('drizzle-orm');
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), emailVerified: sql`now()` })
    .where(eq(users.id, userId));
}
