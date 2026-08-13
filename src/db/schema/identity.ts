/**
 * Identity Domain Schema (partial)
 *
 * Only `user_roles` is implemented here — added as a dependency of the
 * payment-verification module's admin-review gate (assertAdmin in
 * src/security/roles.ts). profiles/colleges/departments remain unimplemented,
 * owned by whoever picks up the rest of the identity domain.
 */

import { mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

export const userRoles = mysqlTable(
  'user_roles',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 64 }).notNull(),
    eventScopeId: varchar('event_scope_id', { length: 36 }),
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
