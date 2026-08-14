import { boolean, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const colleges = mysqlTable(
  'colleges',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
  },
  (table) => ({ nameIdx: uniqueIndex('colleges_name_unique').on(table.name) }),
);

export const departments = mysqlTable('departments', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  collegeId: varchar('college_id', { length: 36 }),
  name: varchar('name', { length: 255 }).notNull(),
  active: boolean('active').notNull().default(true),
});

export const levels = mysqlTable(
  'levels',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    levelNumber: int('level_number').notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    minXp: int('min_xp').notNull().default(0),
    badgeUrl: text('badge_url'),
  },
  (table) => ({ levelIdx: uniqueIndex('levels_level_number_unique').on(table.levelNumber) }),
);

export const sponsors = mysqlTable('sponsors', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  tier: varchar('tier', { length: 64 }).notNull().default('partner'),
  active: boolean('active').notNull().default(true),
});
