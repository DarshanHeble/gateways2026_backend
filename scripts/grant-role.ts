/**
 * Grant a role to a user by email.
 *
 *   npm run role:grant -- --email admin@example.com --role ADMIN
 *   npm run role:grant -- --email x@example.com --role SCANNER --revoke
 *
 * This is the bootstrap path for the very first ADMIN — the admin dashboard
 * cannot be used to create one, because using it requires already being one.
 *
 * Deliberately a CLI rather than a BOOTSTRAP_ADMIN_EMAIL env var: an env var that
 * promotes on every boot is a permanent, invisible backdoor if it ever leaks or
 * is mistyped. This requires DB credentials, which is an existing trust boundary,
 * and it leaves an audit_log row behind.
 */

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { getWriterDb, closeDatabaseConnections } from '../src/db/index.js';
import { users } from '../src/db/schema/auth.js';
import { userRoles } from '../src/db/schema/identity.js';
import { insertAuditLogEntry } from '../src/repositories/audit-log.repository.js';
import { UserRole } from '../src/security/roles.js';

function parseArgs(argv: string[]): { email?: string; role?: string; revoke: boolean } {
  const out: { email?: string; role?: string; revoke: boolean } = { revoke: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') out.email = argv[++i];
    else if (argv[i] === '--role') out.role = argv[++i];
    else if (argv[i] === '--revoke') out.revoke = true;
  }
  return out;
}

async function main() {
  const { email, role, revoke } = parseArgs(process.argv.slice(2));
  const validRoles = Object.values(UserRole);

  if (!email || !role) {
    throw new Error('Usage: npm run role:grant -- --email <email> --role <ROLE> [--revoke]');
  }
  if (!validRoles.includes(role as UserRole)) {
    throw new Error(`Unknown role "${role}". Valid roles: ${validRoles.join(', ')}`);
  }

  const db = getWriterDb();
  const normalizedEmail = email.toLowerCase().trim();

  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  const user = found[0];
  if (!user) {
    throw new Error(`No user with email "${normalizedEmail}". They must sign up first.`);
  }

  if (revoke) {
    // Refuse to remove the last ADMIN — otherwise nobody can grant roles again
    // and recovery means coming back to this script.
    //
    // Counts DISTINCT users, not rows: two role rows for one person is one admin,
    // and treating it as two would let that person revoke themselves into an
    // adminless system.
    if (role === UserRole.ADMIN) {
      const adminRows = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, UserRole.ADMIN));
      const distinctAdmins = new Set(adminRows.map((r) => r.userId));
      if (distinctAdmins.size <= 1 && distinctAdmins.has(user.id)) {
        throw new Error('Refusing to revoke the last remaining ADMIN.');
      }
    }

    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, role)));
  } else {
    // Idempotency is enforced here, NOT by user_role_scope_idx. That index is
    // UNIQUE(user_id, role, event_scope_id), and MySQL treats NULLs as distinct
    // in a unique index — so unscoped roles (event_scope_id IS NULL) never
    // collide and ON DUPLICATE KEY UPDATE silently inserts a second row.
    const existing = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.role, role)))
      .limit(1);

    if (existing.length > 0) {
      console.log(`${user.email} already has ${role}; nothing to do.`);
      await closeDatabaseConnections();
      return;
    }

    await db.insert(userRoles).values({ id: uuidv7(), userId: user.id, role });
  }

  await insertAuditLogEntry(db, {
    actorUserId: 'system:cli',
    action: revoke ? 'role_revoked' : 'role_granted',
    targetType: 'user',
    targetId: user.id,
    metadata: { role, email: normalizedEmail },
  });

  const current = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  console.log(
    `${revoke ? 'Revoked' : 'Granted'} ${role} for ${user.email}.\n` +
      `Roles now: ${current.map((r) => r.role).join(', ') || '(none)'}`,
  );
}

main()
  .then(() => closeDatabaseConnections())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    await closeDatabaseConnections().catch(() => {});
    process.exit(1);
  });
