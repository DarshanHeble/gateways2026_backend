/**
 * Shared test-only helpers for creating/cleaning up real DB rows.
 * Every test that needs a user creates one here and deletes it in an
 * `afterEach`/`afterAll` — this repo's tests run against a real MySQL
 * instance (see docker-compose.yml), not mocks, so cleanup is mandatory
 * for repeatable runs.
 */

import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { userRoles } from '../db/schema/identity.js';
import { paymentReceipts } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;

export async function createTestUser(
  db: Db,
  overrides?: Partial<{ email: string; status: string }>,
): Promise<{ id: string; email: string }> {
  const id = uuidv7();
  const email = overrides?.email ?? `test-${id}@example.com`;
  await db.insert(users).values({
    id,
    email,
    status: overrides?.status ?? 'ACTIVE',
  });
  return { id, email };
}

export async function grantRole(db: Db, userId: string, role: string): Promise<void> {
  await db.insert(userRoles).values({
    id: uuidv7(),
    userId,
    role,
  });
}

export async function deleteTestUser(db: Db, userId: string): Promise<void> {
  // FK cascades (ON DELETE CASCADE) clean up sessions/accounts/user_roles/xp_ledger.
  // payment_receipts.user_id has no ON DELETE CASCADE (see schema) — delete explicitly first.
  await db.delete(paymentReceipts).where(eq(paymentReceipts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
