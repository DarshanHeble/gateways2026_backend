/**
 * User roles — DB access for the RBAC table.
 *
 * Role checks always read live: see assertAdmin in src/security/roles.ts, which
 * queries the writer connection on every request so a revoked role takes effect
 * immediately rather than at session expiry.
 */

import { eq } from 'drizzle-orm';
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
