/**
 * XP Ledger Repository — raw DB access only. Award-idempotency logic lives
 * in services/xp.service.ts (this file just inserts/reads rows).
 */

import { eq, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { xpLedger } from '../db/schema/progression.js';
import { mapDatabaseError } from '../db/transaction.js';

type Db = MySql2Database<typeof schema>;

export async function insertXpLedgerEntry(
  db: Db,
  params: {
    id: string;
    userId: string;
    amount: number;
    reason: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    awardedBy?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(xpLedger).values({
      id: params.id,
      userId: params.userId,
      amount: params.amount,
      reason: params.reason,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      idempotencyKey: params.idempotencyKey,
      awardedBy: params.awardedBy ?? null,
    });
  } catch (err: any) {
    throw mapDatabaseError(err?.cause ?? err);
  }
}

export async function getTotalXpForUser(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${xpLedger.amount}), 0)` })
    .from(xpLedger)
    .where(eq(xpLedger.userId, userId));
  return Number(rows[0]?.total ?? 0);
}
