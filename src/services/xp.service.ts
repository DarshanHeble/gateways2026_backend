/**
 * XP Service — idempotent award on top of xp.repository.
 *
 * Idempotency is enforced at the DB layer: xp_ledger has
 * UNIQUE(source_type, source_id, user_id). A genuine duplicate call throws
 * VALIDATION_FAILED (via db/transaction.ts's mapDatabaseError) rather than
 * silently no-op-ing — callers (e.g. payment.service.ts's reviewReceipt) are
 * expected to guard re-entry themselves via a status-transition check, so a
 * duplicate here indicates an actual bug, not a normal retry.
 */

import { v7 as uuidv7 } from 'uuid';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { insertXpLedgerEntry } from '../repositories/xp.repository.js';

type Db = MySql2Database<typeof schema>;

export interface AwardXpParams {
  userId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId: string;
  awardedBy?: string | null;
}

export async function awardXp(db: Db, params: AwardXpParams): Promise<void> {
  await insertXpLedgerEntry(db, {
    id: uuidv7(),
    userId: params.userId,
    amount: params.amount,
    reason: params.reason,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    idempotencyKey: `${params.sourceType}:${params.sourceId}:${params.userId}`,
    awardedBy: params.awardedBy ?? null,
  });
}
