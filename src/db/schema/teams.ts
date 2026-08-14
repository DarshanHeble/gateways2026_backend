import { boolean, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const teams = mysqlTable(
  'teams',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    joinCode: varchar('join_code', { length: 32 }).notNull(),
    leaderUserId: varchar('leader_user_id', { length: 36 }).notNull(),
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
  },
  (table) => ({ joinCodeIdx: uniqueIndex('teams_join_code_unique').on(table.joinCode) }),
);

export const teamMembers = mysqlTable(
  'team_members',
  {
    teamId: varchar('team_id', { length: 36 }).notNull(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { fsp: 3 }).notNull().default(sql`(now())`),
  },
  (table) => ({ memberIdx: uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId) }),
);

export type TeamRow = typeof teams.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
