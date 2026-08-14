import { boolean, index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const eventCategories = mysqlTable(
  'event_categories',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    description: text('description'),
  },
  (table) => ({ slugIdx: uniqueIndex('event_categories_slug_unique').on(table.slug) }),
);

export const events = mysqlTable(
  'events',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    categoryId: varchar('category_id', { length: 36 }).notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    venue: varchar('venue', { length: 255 }),
    startsAt: timestamp('starts_at', { fsp: 3 }).notNull(),
    endsAt: timestamp('ends_at', { fsp: 3 }).notNull(),
    capacity: int('capacity'),
    isTeamEvent: boolean('is_team_event').notNull().default(false),
    minTeamSize: int('min_team_size').default(1),
    maxTeamSize: int('max_team_size').default(1),
    status: varchar('status', { length: 32 }).notNull().default('published'),
    paymentRequired: boolean('payment_required').notNull().default(true),
    feeAmount: int('fee_amount').default(0),
    registrationOpensAt: timestamp('registration_opens_at', { fsp: 3 }),
    registrationClosesAt: timestamp('registration_closes_at', { fsp: 3 }),
    xpReward: int('xp_reward').notNull().default(0),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    contactEmail: varchar('contact_email', { length: 255 }),
    createdBy: varchar('created_by', { length: 36 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().default(sql`(now())`).$onUpdate(() => new Date()),
  },
  (table) => ({
    slugIdx: uniqueIndex('events_slug_unique').on(table.slug),
    startsAtIdx: index('events_starts_at_idx').on(table.startsAt),
  }),
);

export const eventOrganizers = mysqlTable(
  'event_organizers',
  {
    eventId: varchar('event_id', { length: 36 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
  },
  (table) => ({ pk: uniqueIndex('event_organizers_event_user_unique').on(table.eventId, table.userId) }),
);

export const scheduleSlots = mysqlTable('schedule_slots', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  roundName: varchar('round_name', { length: 128 }).notNull(),
  venue: varchar('venue', { length: 255 }),
  startsAt: timestamp('starts_at', { fsp: 3 }).notNull(),
  endsAt: timestamp('ends_at', { fsp: 3 }).notNull(),
});

export type EventCategoryRow = typeof eventCategories.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
