import { index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const registrations = mysqlTable(
  'registrations',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    teamId: varchar('team_id', { length: 36 }),
    status: varchar('status', { length: 32 }).notNull().default('confirmed'),
    paymentStatus: varchar('payment_status', { length: 32 }).notNull().default('verified'),
    source: varchar('source', { length: 32 }).notNull().default('online'),
    notes: text('notes'),
    overrideActorId: varchar('override_actor_id', { length: 36 }),
    overrideReason: text('override_reason'),
    overrideAt: timestamp('override_at', { fsp: 3 }),
    registeredAt: timestamp('registered_at', { fsp: 3 }).notNull().default(sql`(now())`),
    confirmedAt: timestamp('confirmed_at', { fsp: 3 }),
    cancelledAt: timestamp('cancelled_at', { fsp: 3 }),
    waitlistPosition: int('waitlist_position'),
  },
  (table) => ({
    eventUserIdx: uniqueIndex('event_user_reg_idx').on(table.eventId, table.userId),
    eventStatusIdx: index('reg_event_status_idx').on(table.eventId, table.status),
    userDateIdx: index('user_reg_date_idx').on(table.userId, table.registeredAt),
    codeIdx: uniqueIndex('registrations_code_unique').on(table.code),
  }),
);

export type RegistrationRow = typeof registrations.$inferSelect;
export type NewRegistrationRow = typeof registrations.$inferInsert;
