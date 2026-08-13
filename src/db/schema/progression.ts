/**
 * Progression Domain Schema (partial)
 *
 * Only `xp_ledger` is implemented here — added as a dependency of the
 * payment-verification module's +10 XP award on approval. achievements/
 * user_achievements/characters remain unimplemented.
 */

import { index, int, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

export const xpLedger = mysqlTable(
  'xp_ledger',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: int('amount').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    awardedBy: varchar('awarded_by', { length: 36 }),
    createdAt: timestamp('created_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
  },
  (table) => ({
    sourceIdempotencyIdx: uniqueIndex('source_idempotency_idx').on(
      table.sourceType,
      table.sourceId,
      table.userId,
    ),
    userLedgerIdx: index('user_ledger_idx').on(table.userId, table.createdAt),
  }),
);

export type XpLedgerEntry = typeof xpLedger.$inferSelect;
export type NewXpLedgerEntry = typeof xpLedger.$inferInsert;
