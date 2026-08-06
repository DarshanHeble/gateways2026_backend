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

import { index, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
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
  }),
);

// ─── Audit Log ─────────────────────────────────────────────────────────────────
// Generic actor/action/target audit trail. No FK on actor_user_id — matches the
// existing migration (audit rows must survive even if the actor is later purged).
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    actorUserId: varchar('actor_user_id', { length: 36 }).notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { fsp: 3 })
      .notNull()
      .default(sql`(now())`),
  },
  (table) => ({
    actorIdx: index('audit_actor_idx').on(table.actorUserId, table.createdAt),
    actionIdx: index('audit_action_idx').on(table.action, table.createdAt),
  }),
);

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type NewPaymentReceipt = typeof paymentReceipts.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
