import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { getAppDb } from '../../db/index.js';
import { sessions, users } from '../../db/schema/auth.js';
import { createSession } from '../../repositories/auth.repository.js';
import { hashPassword } from '../../security/password.js';
import { generateSessionToken, hashSessionToken } from '../../security/jwt.js';
import { createTestUser, deleteTestUser, grantRole } from '../../test-helpers/db.js';

/**
 * Admin surface authorization.
 *
 * The dashboard is admin-only and lives on a public URL, so these are the checks
 * that decide whether "nobody else should be able to access it" is actually true.
 */

const db = getAppDb();
const PASSWORD = 'admin-password-123';
let app: FastifyInstance;
const cleanupUserIds: string[] = [];

async function newSignedInUser(opts: { admin: boolean }) {
  const user = await createTestUser(db);
  cleanupUserIds.push(user.id);

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(PASSWORD), emailVerified: sql`now()` })
    .where(eq(users.id, user.id));

  if (opts.admin) await grantRole(db, user.id, 'ADMIN');

  const rawToken = generateSessionToken();
  await createSession(db, {
    id: uuidv7(),
    userId: user.id,
    hashedToken: hashSessionToken(rawToken),
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { ...user, rawToken };
}

async function sessionCountFor(userId: string): Promise<number> {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  return rows.length;
}

beforeAll(async () => {
  ({ app } = await buildApp());
  await app.ready();
});

afterAll(async () => {
  for (const id of cleanupUserIds) await deleteTestUser(db, id);
  await app.close();
});

describe('admin signin', () => {
  it('lets an ADMIN in and returns a bearer token', async () => {
    const admin = await newSignedInUser({ admin: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/signin',
      headers: { 'x-auth-transport': 'bearer' },
      payload: { email: admin.email, password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf('string');
  });

  // ★ The security property: a non-admin with the CORRECT password must be
  // rejected AND must not have a session created. Checking the role after
  // signing in would still hand them a working participant-API token.
  it('rejects a non-admin with a correct password and creates no session', async () => {
    const user = await createTestUser(db);
    cleanupUserIds.push(user.id);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(PASSWORD), emailVerified: sql`now()` })
      .where(eq(users.id, user.id));

    const before = await sessionCountFor(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/signin',
      payload: { email: user.email, password: PASSWORD },
    });

    expect(res.statusCode).toBe(403);
    expect(await sessionCountFor(user.id)).toBe(before);
  });
});

describe('admin payments authorization', () => {
  it('returns 403 for an authenticated non-admin', async () => {
    const user = await newSignedInUser({ admin: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/payments',
      headers: { authorization: `Bearer ${user.rawToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 with no credentials at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/payments' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the paginated queue for an ADMIN', async () => {
    const admin = await newSignedInUser({ admin: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/payments?status=pending',
      headers: { authorization: `Bearer ${admin.rawToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
    expect(res.json()).toHaveProperty('nextCursor');
  });

  it('rejects a malformed pagination cursor rather than ignoring it', async () => {
    const admin = await newSignedInUser({ admin: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/payments?cursor=not-a-real-cursor',
      headers: { authorization: `Bearer ${admin.rawToken}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
