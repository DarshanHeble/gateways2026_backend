/**
 * Drizzle Schema — Barrel Re-export
 *
 * Active domains are exported here. Each domain's export is enabled
 * once its schema file is implemented. Stubs remain commented until then.
 */

// ✅ Phase 3 — Auth domain (users, accounts, sessions, verification_tokens)
export * from './auth.js';

// ✅ Payment-verification module deps (2026-08-05)
export * from './identity.js';     // user_roles only — profiles/colleges/departments still pending
export * from './progression.js';  // xp_ledger only — achievements/characters still pending
export * from './payments.js';     // payment_receipts, audit_log

// ⏳ Phase 4+ — Uncomment as each domain schema is implemented
// export * from './events.js';       // event_categories, events, event_organizers, schedule_slots, announcements
// export * from './registrations.js'; // registrations, teams, team_members
// export * from './attendance.js';   // attendance, checkin_token_redemptions
// export * from './reference.ts';    // (merged into identity/events when implemented)
