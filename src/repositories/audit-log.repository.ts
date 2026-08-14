/**
 * Audit Log Repository — generic actor/action/target trail.
 * Cross-cutting: other modules (registrations, roles, etc.) will reuse this
 * later, not payments-specific despite living next to payments.ts in schema.
 */

import { v7 as uuidv7 } from 'uuid';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { auditLog } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;

export interface AuditLogParams {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
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
    correlationId: params.correlationId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}
