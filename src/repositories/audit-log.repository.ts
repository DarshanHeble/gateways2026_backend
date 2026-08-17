/**
 * Audit Log Repository — generic actor/action/target trail.
 * Cross-cutting: other modules (registrations, roles, etc.) will reuse this
 * later, not payments-specific despite living next to payments.ts in schema.
 */

import { v7 as uuidv7 } from 'uuid';
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { getWriterDb } from '../db/index.js';
import { auditLog } from '../db/schema/payments.js';
import { users } from '../db/schema/auth.js';
import { profiles } from '../db/schema/identity.js';

type Db = MySql2Database<typeof schema>;

export interface AuditLogParams {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  /** ORGANIZER visibility key. Null/omitted means the row is ADMIN-only. */
  eventId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function insertAuditLogEntry(db: Db, params: AuditLogParams): Promise<void> {
  await db.insert(auditLog).values({
    id: uuidv7(),
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    eventId: params.eventId ?? null,
    correlationId: params.correlationId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}

/**
 * Record an audited action from inside a route handler.
 *
 * Deliberately a plain call, not a Fastify hook or decorator: this codebase does
 * guards imperatively in handler bodies (see the comment in routes/index.ts), and
 * a hook would fire on routes nobody meant to audit.
 *
 * The write is awaited and its failures propagate. If the audit row cannot be
 * written then the action did not happen as far as the record is concerned, and
 * reporting success would be a lie. In-transaction callers should keep using
 * insertAuditLogEntry(tx, ...) so the row commits atomically with the mutation.
 */
export async function auditRequest(
  request: { user?: { id: string }; headers: Record<string, unknown> },
  params: Omit<AuditLogParams, 'actorUserId' | 'correlationId'> & { actorUserId?: string },
): Promise<void> {
  const correlation = request.headers['x-correlation-id'];
  await insertAuditLogEntry(getWriterDb(), {
    ...params,
    actorUserId: params.actorUserId ?? request.user?.id ?? ANONYMOUS_ACTOR,
    correlationId: typeof correlation === 'string' ? correlation : null,
  });
}

/**
 * Actor sentinel for actions with no authenticated user — chiefly sign-in
 * attempts against an address that matches no account. actor_user_id has no
 * foreign key precisely so sentinels like this and 'system:cli' are valid.
 */
export const ANONYMOUS_ACTOR = 'system:anonymous';

export interface ListAuditParams {
  action?: string;
  actorUserId?: string;
  /** Omit for ADMIN (no scoping). An empty array matches nothing. */
  eventIds?: string[];
  limit: number;
  cursorId?: string;
}

export interface AuditLogRow {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  eventId: string | null;
  correlationId: string | null;
  metadata: string | null;
  createdAt: Date;
  actorEmail: string | null;
  actorName: string | null;
}

/**
 * Newest-first page of audit entries, with the actor resolved to a human name.
 *
 * Ordering and paging both use the PRIMARY KEY rather than created_at: ids are
 * uuidv7, so they sort chronologically, and `ORDER BY id DESC` is a backwards PK
 * scan with no filesort. audit_log has no standalone created_at index, so paging
 * on time would need one.
 *
 * ponytail: uuidv7 is millisecond-granular, so rows written within the same
 * millisecond order arbitrarily (but stably — id is unique, so no page can
 * repeat or skip a row). Add an (created_at, id) index and page on both only if
 * exact intra-millisecond ordering ever matters.
 *
 * Both joins MUST be LEFT: actor_user_id has no foreign key and legitimately
 * holds sentinels ('system:cli', 'system:anonymous') and ids of erased users.
 */
export async function listAuditEntries(db: Db, params: ListAuditParams): Promise<AuditLogRow[]> {
  // A staff member with no event assignments can see nothing. Guarded here
  // rather than at the caller so every future caller inherits it — and because
  // inArray(col, []) is not portable SQL.
  if (params.eventIds && params.eventIds.length === 0) return [];

  const filters: SQL[] = [];
  if (params.action) filters.push(eq(auditLog.action, params.action));
  if (params.actorUserId) filters.push(eq(auditLog.actorUserId, params.actorUserId));
  if (params.eventIds) filters.push(inArray(auditLog.eventId, params.eventIds));
  if (params.cursorId) filters.push(lt(auditLog.id, params.cursorId));

  return db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      eventId: auditLog.eventId,
      correlationId: auditLog.correlationId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorEmail: users.email,
      actorName: profiles.fullName,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .leftJoin(profiles, eq(profiles.userId, auditLog.actorUserId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(params.limit);
}
