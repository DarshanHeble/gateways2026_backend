/**
 * Identity Domain Schema (partial)
 *
 * The identity tables are deliberately kept in one module because participant
 * profiles and staff assignments are the shared boundary between the public
 * website and the registration console.
 */

import { boolean, index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';
import { events } from './events.js';

export const userRoles = mysqlTable(
  'user_roles',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 64 }).notNull(),
    eventScopeId: varchar('event_scope_id', { length: 36 }).references(() => events.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
    grantedBy: varchar('granted_by', { length: 36 }),
  },
  (table) => ({
    userRoleScopeIdx: uniqueIndex('user_role_scope_idx').on(
      table.userId,
      table.role,
      table.eventScopeId,
    ),
  }),
);

export type UserRoleRow = typeof userRoles.$inferSelect;
export type NewUserRoleRow = typeof userRoles.$inferInsert;

export const profiles = mysqlTable(
  'profiles',
  {
    userId: varchar('user_id', { length: 36 })
      .primaryKey()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    participantCode: varchar('participant_code', { length: 32 }).unique(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    collegeId: varchar('college_id', { length: 36 }),
    departmentId: varchar('department_id', { length: 36 }),
    yearOfStudy: int('year_of_study'),
    gender: varchar('gender', { length: 16 }),
    dateOfBirth: varchar('date_of_birth', { length: 10 }),
    category: varchar('category', { length: 32 }),
    tshirtSize: varchar('tshirt_size', { length: 8 }),
    emergencyName: varchar('emergency_name', { length: 255 }),
    emergencyPhone: varchar('emergency_phone', { length: 32 }),
    dietaryPref: varchar('dietary_pref', { length: 16 }),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    isBanned: boolean('is_banned').notNull().default(false),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`(now())`),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().default(sql`(now())`).$onUpdate(() => new Date()),
  },
  (table) => ({
    emailLookupIdx: index('profile_college_idx').on(table.collegeId),
  }),
);

export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfileRow = typeof profiles.$inferInsert;
