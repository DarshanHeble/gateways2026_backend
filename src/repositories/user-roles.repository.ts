/**
 * User roles — DB access for the RBAC table.
 *
 * Role checks always read live: see assertAdmin in src/security/roles.ts, which
 * queries the writer connection on every request so a revoked role takes effect
 * immediately rather than at session expiry.
 */

import { and, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { userRoles } from '../db/schema/identity.js';

type Db = MySql2Database<typeof schema>;

export async function getUserRoles(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role);
}

export interface RoleAssignment {
  id: string;
  role: string;
  eventScopeId: string | null;
  grantedAt: Date | string;
  grantedBy: string | null;
}

export async function getUserRoleAssignments(db: Db, userId: string): Promise<RoleAssignment[]> {
  return db
    .select({
      id: userRoles.id,
      role: userRoles.role,
      eventScopeId: userRoles.eventScopeId,
      grantedAt: userRoles.grantedAt,
      grantedBy: userRoles.grantedBy,
    })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
}

export async function hasRole(
  db: Db,
  userId: string,
  role: string,
  eventScopeId?: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.role, role),
        eventScopeId ? eq(userRoles.eventScopeId, eventScopeId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}
