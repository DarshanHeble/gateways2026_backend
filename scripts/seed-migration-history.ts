/**
 * Backfill `__drizzle_migrations` for migrations that were already applied by hand.
 *
 *   npm run db:baseline           # show what would be recorded
 *   npm run db:baseline -- --write
 *
 * WHY THIS EXISTS
 * ---------------
 * This project's early migrations were applied without Drizzle's migrator (via
 * `drizzle-kit push` / raw SQL), so the tracking table was never created. With no
 * tracking table, `drizzle-kit migrate` believes NOTHING has run and tries to
 * replay 0000 against a populated database, which fails on the first CREATE TABLE.
 * The practical result is that every migration becomes a manual, remember-to-run-it
 * step — which is how this repo silently drifted two migrations behind.
 *
 * HOW DRIZZLE DECIDES WHAT TO APPLY (drizzle-orm/mysql-core/dialect.js)
 * --------------------------------------------------------------------
 *   select ... from __drizzle_migrations order by created_at desc limit 1
 *   if (!last || Number(last.created_at) < migration.folderMillis) -> apply
 *
 * Only the newest row's `created_at` is compared, against `when` from
 * meta/_journal.json. The hash is stored but never used to decide anything, so
 * correctness here rests entirely on `created_at` matching the journal.
 *
 * This script NEVER runs migration SQL. It only records that migrations ran. Point
 * it at a database whose schema already matches the migrations you are recording —
 * on anything else it will convince Drizzle to skip work that was never done.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getWriterDb, closeDatabaseConnections } from '../src/db/index.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle/migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta/_journal.json');
  if (!fs.existsSync(journalPath)) throw new Error(`No journal at ${journalPath}`);
  return JSON.parse(fs.readFileSync(journalPath, 'utf8')).entries;
}

/**
 * Hash of the RAW file bytes — no normalisation, and in particular the
 * `--> statement-breakpoint` markers are left in place. Drizzle hashes the file
 * before splitting on them, so stripping anything here produces a hash that
 * never matches what the migrator would have written.
 */
function hashMigration(tag: string): string {
  const file = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  return crypto.createHash('sha256').update(fs.readFileSync(file).toString()).digest('hex');
}

async function main() {
  const write = process.argv.includes('--write');
  const entries = readJournal();
  const db = getWriterDb();

  await db.execute(
    sql`create table if not exists \`__drizzle_migrations\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`,
  );

  const [rows] = (await db.execute(
    sql`select created_at from \`__drizzle_migrations\``,
  )) as unknown as [Array<{ created_at: number | string }>];
  const recorded = new Set(rows.map((r) => Number(r.created_at)));

  const missing = entries.filter((e) => !recorded.has(e.when));

  if (missing.length === 0) {
    console.log(`All ${entries.length} migration(s) already recorded. Nothing to do.`);
    return;
  }

  console.log(`${recorded.size} recorded, ${missing.length} to backfill:\n`);
  for (const e of missing) {
    console.log(`  ${e.tag}  when=${e.when}  sha256=${hashMigration(e.tag).slice(0, 16)}…`);
  }

  if (!write) {
    console.log(
      '\nDry run. Re-run with --write ONLY if this database already has the schema ' +
        'these migrations produce.',
    );
    return;
  }

  for (const e of missing) {
    await db.execute(
      sql`insert into \`__drizzle_migrations\` (\`hash\`, \`created_at\`) values (${hashMigration(e.tag)}, ${e.when})`,
    );
  }
  console.log(`\nRecorded ${missing.length} migration(s). \`drizzle-kit migrate\` will now apply only newer ones.`);
}

main()
  .then(() => closeDatabaseConnections())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    await closeDatabaseConnections().catch(() => {});
    process.exit(1);
  });
