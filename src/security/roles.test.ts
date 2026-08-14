import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser, grantRole } from '../test-helpers/db.js';
import { assertAdmin } from './roles.js';
import type { FastifyRequest } from 'fastify';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

function fakeRequest(userId: string): FastifyRequest {
  return { user: { id: userId, email: 'x@example.com', status: 'ACTIVE', emailVerified: null } } as FastifyRequest;
}

describe('assertAdmin', () => {
  it('throws FORBIDDEN for a user with no ADMIN role', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await expect(assertAdmin(fakeRequest(user.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('resolves for a user with the ADMIN role', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    await grantRole(db, user.id, 'ADMIN');

    await expect(assertAdmin(fakeRequest(user.id))).resolves.toBeUndefined();
  });

  it('throws NOT_AUTHENTICATED when request.user is unset', async () => {
    await expect(assertAdmin({} as FastifyRequest)).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });
});
