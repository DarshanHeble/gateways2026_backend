import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { buildApp } from '../../app.js';
import { getAppDb } from '../../db/index.js';
import { sessions, users } from '../../db/schema/auth.js';
import { characters } from '../../db/schema/characters.js';
import { auditLog } from '../../db/schema/payments.js';
import { profiles, userRoles } from '../../db/schema/identity.js';
import { colleges } from '../../db/schema/reference.js';
import { createSession } from '../../repositories/auth.repository.js';
import { generateSessionToken, hashSessionToken } from '../../security/jwt.js';
import { createTestUser, deleteTestUser, grantRole } from '../../test-helpers/db.js';

const db = getAppDb();
let app: FastifyInstance;
const cleanupUserIds: string[] = [];

/**
 * This spec asserts that erasure nulls out `profiles.college_id`, which means it
 * needs a NON-null college to begin with — otherwise the assertion passes
 * trivially against a column that was never set.
 *
 * The college is created here rather than assumed to exist. Nothing in the
 * migrations or `db:seed` populates `colleges`, so depending on ambient
 * reference data makes the test pass only on a database someone had already
 * hand-populated, and fail on every fresh clone and in CI.
 */
const TEST_COLLEGE_ID = 'test-college-erasure-spec';

async function signedInUser(role?: string) {
  const user = await createTestUser(db);
  cleanupUserIds.push(user.id);
  if (role) await grantRole(db, user.id, role);

  const rawToken = generateSessionToken();
  await createSession(db, {
    id: uuidv7(),
    userId: user.id,
    hashedToken: hashSessionToken(rawToken),
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { ...user, rawToken };
}

beforeAll(async () => {
  ({ app } = await buildApp());
  await app.ready();

  // Delete-then-insert rather than a bare insert: a run that crashed before its
  // afterAll would otherwise leave the row behind and fail the next run on the
  // primary key.
  await db.delete(colleges).where(eq(colleges.id, TEST_COLLEGE_ID));
  await db.insert(colleges).values({ id: TEST_COLLEGE_ID, name: 'Test College (erasure spec)' });
});

afterAll(async () => {
  // Users first — profiles reference the college, so removing it earlier would
  // trip the same foreign key this fixture exists to satisfy.
  for (const id of cleanupUserIds) await deleteTestUser(db, id);
  await db.delete(colleges).where(eq(colleges.id, TEST_COLLEGE_ID));
  await app.close();
});

describe('participant privacy erasure', () => {
  it('allows an ADMIN to revoke credentials and redact personal data', async () => {
    const admin = await signedInUser('ADMIN');
    const participant = await createTestUser(db);
    cleanupUserIds.push(participant.id);
    await grantRole(db, participant.id, 'PARTICIPANT');
    await db.insert(profiles).values({
      userId: participant.id,
      participantCode: `GWS26-${participant.id.slice(0, 8).toUpperCase()}`,
      fullName: 'A Real Participant',
      phone: '+919999999999',
      collegeId: TEST_COLLEGE_ID,
      bio: 'private profile data',
    });
    await db.insert(characters).values({
      userId: participant.id,
      playerName: `player_${participant.id.slice(0, 8)}`,
      bio: 'private character data',
    });

    const participantSession = generateSessionToken();
    await createSession(db, {
      id: uuidv7(),
      userId: participant.id,
      hashedToken: hashSessionToken(participantSession),
      expires: new Date(Date.now() + 60 * 60 * 1000),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/participants/${participant.id}/erase`,
      headers: {
        authorization: `Bearer ${admin.rawToken}`,
        'x-correlation-id': 'privacy-test-correlation',
      },
      payload: { reason: 'Participant submitted a verified erasure request.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ alreadyErased: false, receiptCount: 0 });

    const [redactedUser] = await db.select().from(users).where(eq(users.id, participant.id));
    const [redactedProfile] = await db.select().from(profiles).where(eq(profiles.userId, participant.id));
    const [redactedCharacter] = await db.select().from(characters).where(eq(characters.userId, participant.id));
    const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, participant.id));
    const remainingRoles = await db.select().from(userRoles).where(eq(userRoles.userId, participant.id));
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, participant.id))
      .orderBy(sql`${auditLog.createdAt} desc`)
      .limit(1);

    expect(redactedUser).toMatchObject({
      email: `erased-${participant.id}@erased.invalid`,
      passwordHash: null,
      status: 'INACTIVE',
      emailVerified: null,
    });
    expect(redactedProfile).toMatchObject({
      participantCode: `ERASED-${participant.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      fullName: '[erased]',
      phone: null,
      collegeId: null,
      bio: null,
    });
    expect(redactedCharacter).toMatchObject({
      playerName: `erased_${participant.id.replaceAll('-', '').slice(0, 8)}`,
      bio: null,
    });
    expect(remainingSessions).toHaveLength(0);
    expect(remainingRoles).toHaveLength(0);
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      action: 'participant_personal_data_erased',
      targetType: 'participant',
      targetId: participant.id,
      correlationId: 'privacy-test-correlation',
    });

    const repeat = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/participants/${participant.id}/erase`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { reason: 'Repeat click should be safe.' },
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toMatchObject({ alreadyErased: true, receiptCount: 0 });
  });

  it('rejects non-admin actors and staff-account targets', async () => {
    const participant = await createTestUser(db);
    cleanupUserIds.push(participant.id);
    await grantRole(db, participant.id, 'PARTICIPANT');

    const organizer = await signedInUser('ORGANIZER');
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/participants/${participant.id}/erase`,
      headers: { authorization: `Bearer ${organizer.rawToken}` },
      payload: { reason: 'Not allowed.' },
    });
    expect(forbidden.statusCode).toBe(403);

    const admin = await signedInUser('ADMIN');
    const staffTarget = await createTestUser(db);
    cleanupUserIds.push(staffTarget.id);
    await grantRole(db, staffTarget.id, 'ORGANIZER');
    const staffResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/participants/${staffTarget.id}/erase`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { reason: 'Staff must use staff management.' },
    });
    expect(staffResponse.statusCode).toBe(403);

    const [unchangedStaff] = await db.select().from(users).where(eq(users.id, staffTarget.id));
    expect(unchangedStaff.status).toBe('ACTIVE');
  });
});
