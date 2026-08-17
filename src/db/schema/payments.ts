/**
 * Payments Domain Schema
 *
 * Tables: payment_receipts, audit_log
 *
 * payment_receipts models a GLOBAL one-time entry-pass payment — one row per
 * user (UNIQUE(user_id)), not per-registration. See docs/superpowers/specs/
 * 2026-08-05-payment-verification-design.md for why (Team Guide vs PARALLAX
 * conflict, Team Guide wins).
 */

import { index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';

// ─── Payment Receipts ──────────────────────────────────────────────────────────
// status: 'pending' | 'verified' | 'rejected'
export const paymentReceipts = mysqlTable(
  'payment_receipts',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .unique()
      .references(() => users.id),
    cloudinaryPublicId: varchar('cloudinary_public_id', { length: 255 }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileSizeBytes: int('file_size_bytes').notNull(),
    amountInr: int('amount_inr').notNull().default(250),
    paymentMethod: varchar('payment_method', { length: 32 }),
    transactionReference: varchar('transaction_reference', { length: 128 }),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
    reviewedBy: varchar('reviewed_by', { length: 36 }).references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { fsp: 3 }),
    rejectionReason: text('rejection_reason'),
  },
  (table) => ({
    statusSubmittedIdx: index('payment_receipt_status_idx').on(table.status, table.submittedAt),
    transactionReferenceIdx: uniqueIndex('payment_receipt_transaction_reference_unique').on(
      table.transactionReference,
    ),
  }),
);

// ─── Audit Log ─────────────────────────────────────────────────────────────────
// Generic actor/action/target audit trail. No FK on actor_user_id — matches the
// existing migration (audit rows must survive even if the actor is later purged).
//
// event_id is the ORGANIZER visibility key, populated at write time by the call
// sites that already know the event. It is deliberately NOT derived on read:
// inferring an event from target_type would mean a correlated join per row type
// (and is ambiguous for payment_receipt, which is one-to-many via registrations).
// NULL means "not event-scoped" — logins, role grants, profile edits — and those
// rows are ADMIN-only. No FK, for the same reason as actor_user_id.
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    actorUserId: varchar('actor_user_id', { length: 36 }).notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }).notNull(),
    eventId: varchar('event_id', { length: 36 }),
    correlationId: varchar('correlation_id', { length: 128 }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
  },
  (table) => ({
    actorIdx: index('audit_actor_idx').on(table.actorUserId, table.createdAt),
    actionIdx: index('audit_action_idx').on(table.action, table.createdAt),
    // (event_id, id) not (event_id, created_at): reads page on the uuidv7 PK.
    eventIdx: index('audit_event_idx').on(table.eventId, table.id),
  }),
);

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type NewPaymentReceipt = typeof paymentReceipts.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
