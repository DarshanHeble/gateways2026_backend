import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { buildApp } from '../../app.js';
import { getAppDb } from '../../db/index.js';
import { auditLog } from '../../db/schema/payments.js';
import { eventCategories, events } from '../../db/schema/events.js';
import { userRoles } from '../../db/schema/identity.js';
import { createSession } from '../../repositories/auth.repository.js';
import { generateSessionToken, hashSessionToken } from '../../security/jwt.js';
import { createTestUser, deleteTestUser, grantRole } from '../../test-helpers/db.js';

const db = getAppDb();
let app: FastifyInstance;
const cleanupUserIds: string[] = [];

/**
 * Fixtures are namespaced per run so this spec is deterministic against a
 * database that already holds real audit rows — every assertion filters on
 * ACTION, never on "the newest N rows".
 */
const RUN = uuidv7().slice(0, 8);
const ACTION = `test_audit_action_${RUN}`;
const CATEGORY_ID = `test-cat-audit-${RUN}`;
const EVENT_A = `test-evt-a-${RUN}`;
const EVENT_B = `test-evt-b-${RUN}`;
const SEEDED_IDS: string[] = [];

async function signedInUser(role?: string, eventScopeId?: string) {
  const user = await createTestUser(db);
  cleanupUserIds.push(user.id);
  if (role && eventScopeId) {
    await db.insert(userRoles).values({ id: uuidv7(), userId: user.id, role, eventScopeId });
  } else if (role) {
    await grantRole(db, user.id, role);
  }

  const rawToken = generateSessionToken();
  await createSession(db, {
    id: uuidv7(),
    userId: user.id,
    hashedToken: hashSessionToken(rawToken),
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { ...user, rawToken };
}

async function seedAudit(row: {
  actorUserId: string;
  eventId?: string | null;
  metadata?: string | null;
}) {
  const id = uuidv7();
  SEEDED_IDS.push(id);
  await db.insert(auditLog).values({
    id,
    actorUserId: row.actorUserId,
    action: ACTION,
    targetType: 'test_target',
    targetId: `target-${id}`,
    eventId: row.eventId ?? null,
    correlationId: `corr-${RUN}`,
    metadata: row.metadata ?? null,
  });
  return id;
}

async function fetchAudit(token: string, query = '') {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/audit?action=${ACTION}${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return response;
}

beforeAll(async () => {
  ({ app } = await buildApp());
  await app.ready();

  // Delete-then-insert: a run that crashed before afterAll would otherwise trip
  // the primary key here.
  await db.delete(events).where(inArray(events.id, [EVENT_A, EVENT_B]));
  await db.delete(eventCategories).where(eq(eventCategories.id, CATEGORY_ID));
  await db.insert(eventCategories).values({ id: CATEGORY_ID, name: `Audit spec ${RUN}`, slug: CATEGORY_ID });
  for (const [id, title] of [[EVENT_A, 'Audit spec event A'], [EVENT_B, 'Audit spec event B']]) {
    await db.insert(events).values({
      id,
      categoryId: CATEGORY_ID,
      slug: id,
      title,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600_000),
    });
  }
});

afterAll(async () => {
  if (SEEDED_IDS.length) await db.delete(auditLog).where(inArray(auditLog.id, SEEDED_IDS));
  // Users before events: user_roles.event_scope_id is ON DELETE RESTRICT, so an
  // event with a live assignment cannot be removed first.
  for (const id of cleanupUserIds) await deleteTestUser(db, id);
  await db.delete(events).where(inArray(events.id, [EVENT_A, EVENT_B]));
  await db.delete(eventCategories).where(eq(eventCategories.id, CATEGORY_ID));
  await app.close();
});

describe('GET /admin/audit', () => {
  it('returns entries newest-first with the actor resolved, and pages without overlap or gaps', async () => {
    const admin = await signedInUser('ADMIN');
    const first = await seedAudit({ actorUserId: admin.id, metadata: JSON.stringify({ step: 1 }) });
    const second = await seedAudit({ actorUserId: admin.id, metadata: JSON.stringify({ step: 2 }) });
    const third = await seedAudit({ actorUserId: admin.id, metadata: JSON.stringify({ step: 3 }) });

    const all = await fetchAudit(admin.rawToken);
    expect(all.statusCode).toBe(200);
    const body = all.json();
    expect(body.items.map((i: any) => i.id)).toEqual([third, second, first]);
    expect(body.nextCursor).toBeNull();
    // metadata is stored as a JSON string but must arrive parsed.
    expect(body.items[0].metadata).toEqual({ step: 3 });
    expect(body.items[0].actorEmail).toBe(admin.email);

    const page1 = (await fetchAudit(admin.rawToken, '&limit=2')).json();
    expect(page1.items.map((i: any) => i.id)).toEqual([third, second]);
    expect(page1.nextCursor).toBe(second);

    const page2 = (await fetchAudit(admin.rawToken, `&limit=2&cursor=${page1.nextCursor}`)).json();
    expect(page2.items.map((i: any) => i.id)).toEqual([first]);
    expect(page2.nextCursor).toBeNull();
  });

  it('keeps rows whose actor is a sentinel or has been erased', async () => {
    const admin = await signedInUser('ADMIN');
    const sentinel = await seedAudit({ actorUserId: 'system:cli' });

    const body = (await fetchAudit(admin.rawToken)).json();
    const row = body.items.find((i: any) => i.id === sentinel);

    // The actor joins are LEFT joins precisely so this row survives: actor_user_id
    // has no foreign key and legitimately holds sentinels.
    expect(row).toBeDefined();
    expect(row.actorId).toBe('system:cli');
    expect(row.actorName).toBeNull();
    expect(row.actorEmail).toBeNull();
  });

  it('degrades malformed metadata to null instead of failing the page', async () => {
    const admin = await signedInUser('ADMIN');
    const broken = await seedAudit({ actorUserId: admin.id, metadata: 'not valid json{' });

    const response = await fetchAudit(admin.rawToken);
    expect(response.statusCode).toBe(200);
    expect(response.json().items.find((i: any) => i.id === broken).metadata).toBeNull();
  });

  it('shows an ORGANIZER only their own events, and never unscoped rows', async () => {
    const admin = await signedInUser('ADMIN');
    const mine = await seedAudit({ actorUserId: admin.id, eventId: EVENT_A });
    const theirs = await seedAudit({ actorUserId: admin.id, eventId: EVENT_B });
    const unscoped = await seedAudit({ actorUserId: admin.id, eventId: null });

    const organizer = await signedInUser('ORGANIZER', EVENT_A);
    const ids = (await fetchAudit(organizer.rawToken)).json().items.map((i: any) => i.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    // Unscoped rows are sign-ins, role grants and profile edits — ADMIN-only.
    expect(ids).not.toContain(unscoped);

    const adminIds = (await fetchAudit(admin.rawToken)).json().items.map((i: any) => i.id);
    expect(adminIds).toEqual(expect.arrayContaining([mine, theirs, unscoped]));
  });

  it('shows a SCANNER nothing, even for events they are assigned to', async () => {
    const admin = await signedInUser('ADMIN');
    await seedAudit({ actorUserId: admin.id, eventId: EVENT_A });

    // Scanners are the registration desk. They hold event assignments, so scoping
    // on accessibleEventIds would hand them a supervision tool; scoping is on
    // organizerEventIds instead.
    const scanner = await signedInUser('SCANNER', EVENT_A);
    const response = await fetchAudit(scanner.rawToken);

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('rejects an unauthenticated caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/audit' });
    expect(response.statusCode).toBe(401);
  });
});

describe('sign-in auditing', () => {
  async function auditRowsFor(action: string, targetId: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  }

  it('records a failed sign-in against an unknown address without storing the password', async () => {
    const email = `nobody-${RUN}@example.com`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/signin',
      payload: { email, password: 'hunter2-not-a-real-password' },
    });
    expect(response.statusCode).toBe(401);

    const [row] = await auditRowsFor('admin_signin_failed', email);
    SEEDED_IDS.push(row.id);

    // No account matched, so the row is attributed to the sentinel and keeps the
    // attempted address — this is what makes enumeration sweeps visible.
    expect(row.actorUserId).toBe('system:anonymous');
    expect(row.targetType).toBe('email');
    expect(JSON.parse(row.metadata!)).toMatchObject({ reason: 'unknown_email' });
    expect(row.metadata).not.toContain('hunter2');
  });

  it('attributes a failed sign-in to the account when the address exists', async () => {
    const user = await createTestUser(db);
    cleanupUserIds.push(user.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/signin',
      payload: { email: user.email, password: 'wrong-password-entirely' },
    });
    expect(response.statusCode).toBe(401);

    const [row] = await auditRowsFor('admin_signin_failed', user.id);
    SEEDED_IDS.push(row.id);
    expect(row.actorUserId).toBe(user.id);
    expect(row.targetType).toBe('user');
    expect(row.metadata).not.toContain('wrong-password-entirely');
  });
});
