import { index, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/** One-time website → registration-console handoff records. */
export const consoleHandoffs = mysqlTable(
  'console_handoffs',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    codeHash: varchar('code_hash', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    target: varchar('target', { length: 64 }).notNull().default('registration-console'),
    returnTo: varchar('return_to', { length: 255 }).notNull().default('/'),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    consumedAt: timestamp('consumed_at', { fsp: 3 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
  },
  (table) => ({
    codeHashIdx: uniqueIndex('console_handoffs_code_hash_unique').on(table.codeHash),
    expiryIdx: index('console_handoffs_expiry_idx').on(table.expiresAt),
  }),
);

export type ConsoleHandoffRow = typeof consoleHandoffs.$inferSelect;
export type NewConsoleHandoffRow = typeof consoleHandoffs.$inferInsert;
