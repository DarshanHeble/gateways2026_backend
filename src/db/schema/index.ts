/**
 * Drizzle Schema — Barrel Re-export
 *
 * Active domains are exported here. Each domain's export is enabled
 * once its schema file is implemented. Stubs remain commented until then.
 */

/**
 * ⚠️  IMPORTANT — before running `drizzle-kit generate` or `db:push`:
 *
 * This barrel only exports schema for the domains implemented so far. The
 * database (see drizzle/migrations/0000_ambiguous_sauron.sql) already has
 * 27 tables from the full original design — 19 of them (events,
 * registrations, teams, profiles, achievements, characters, colleges,
 * departments, etc.) have NO corresponding schema.ts file yet.
 *
 * Because `generate`/`push` diff your schema.ts files against the tracked
 * snapshot / live DB, any table present in the DB but absent from this
 * barrel will be proposed for DROP. This already happened once (see the
 * 2026-08-05 payment-verification migration history) and was fixed by
 * manually stripping the drops and merging the untouched tables back into
 * the snapshot — but the underlying gap is still here.
 *
 * BEFORE running `db:generate`: read the generated .sql file and confirm
 * it contains ZERO `DROP TABLE` statements for tables you didn't intend to
 * touch. BEFORE running `db:push` (especially `db:push:preprod`/`db:push:prod`,
 * which target real databases): do not run it until every domain below has
 * a real schema.ts file, or you WILL be prompted to drop live tables.
 */

// ✅ Auth + core registration domains
export * from './auth.js';
export * from './identity.js';
export * from './progression.js';
export * from './payments.js';
export * from './characters.js';
export * from './events.js';
export * from './registrations.js';
export * from './teams.js';
export * from './reference.js';
export * from './console.js';
