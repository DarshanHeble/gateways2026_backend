import { int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

export const characters = mysqlTable(
  'characters',
  {
    userId: varchar('user_id', { length: 36 }).primaryKey().notNull().references(() => users.id, { onDelete: 'cascade' }),
    playerName: varchar('player_name', { length: 64 }).notNull(),
    totalXp: int('total_xp').notNull().default(0),
    levelId: varchar('level_id', { length: 36 }),
    avatarAssetId: varchar('avatar_asset_id', { length: 255 }),
    collegeId: varchar('college_id', { length: 36 }),
    departmentId: varchar('department_id', { length: 36 }),
    yearOfStudy: int('year_of_study'),
    bio: text('bio'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().default(sql`(now())`).$onUpdate(() => new Date()),
  },
  (table) => ({
    playerNameIdx: uniqueIndex('characters_player_name_unique').on(table.playerName),
  }),
);

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;
