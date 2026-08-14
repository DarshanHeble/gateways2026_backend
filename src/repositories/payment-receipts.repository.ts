/**
 * Payment Receipts Repository — raw DB access only. Business rules
 * (duplicate-submission checks, status-transition guards) live in
 * services/payment.service.ts.
 */

import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { paymentReceipts } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;
type PaymentReceipt = schema.PaymentReceipt;

/**
 * A receipt plus the emails behind its user IDs.
 *
 * The admin dashboard has no user directory of its own, so a bare UUID in the
 * "participant" or "reviewer" column is unusable to the human doing the review.
 */
export interface ReceiptWithEmails extends PaymentReceipt {
  participantEmail: string;
  reviewedByEmail: string | null;
}

export async function createReceipt(
  db: Db,
  params: {
    id: string;
    userId: string;
    cloudinaryPublicId: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
    amountInr?: number;
    paymentMethod?: 'upi' | 'neft' | 'gateway';
    transactionReference?: string;
  },
): Promise<void> {
  await db.insert(paymentReceipts).values({
    id: params.id,
    userId: params.userId,
    cloudinaryPublicId: params.cloudinaryPublicId,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    fileSizeBytes: params.fileSizeBytes,
    amountInr: params.amountInr ?? 250,
    paymentMethod: params.paymentMethod ?? null,
    transactionReference: params.transactionReference ?? null,
    status: 'pending',
  });
}

export async function getReceiptByUser(db: Db, userId: string): Promise<PaymentReceipt | null> {
  const rows = await db.select().from(paymentReceipts).where(eq(paymentReceipts.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/** Must be called inside a withTransaction(...) block for the lock to hold. */
export async function getReceiptByIdForUpdate(db: Db, id: string): Promise<PaymentReceipt | null> {
  const rows = await db.select().from(paymentReceipts).where(eq(paymentReceipts.id, id)).for('update');
  return rows[0] ?? null;
}

export async function listPendingReceipts(db: Db): Promise<PaymentReceipt[]> {
  return db
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.status, 'pending'))
    .orderBy(paymentReceipts.submittedAt);
}

/**
 * Admin listing: filterable, keyset-paginated, with participant/reviewer emails.
 *
 * Keyset (not OFFSET) on `(submitted_at, id)` — the same column pair as the
 * existing `payment_receipt_status_idx` — so paging stays correct while receipts
 * are being submitted underneath the reviewer, and stays cheap deep into the list.
 * `id` breaks ties because submitted_at is not unique.
 */
export async function listReceipts(
  db: Db,
  params: {
    status?: string;
    userId?: string;
    limit: number;
    cursor?: { submittedAt: string; id: string };
  },
): Promise<ReceiptWithEmails[]> {
  const reviewer = alias(users, 'reviewer');

  const filters = [
    params.status ? eq(paymentReceipts.status, params.status) : undefined,
    params.userId ? eq(paymentReceipts.userId, params.userId) : undefined,
    params.cursor
      ? or(
          gt(paymentReceipts.submittedAt, sql`${params.cursor.submittedAt}`),
          and(
            eq(paymentReceipts.submittedAt, sql`${params.cursor.submittedAt}`),
            gt(paymentReceipts.id, params.cursor.id),
          ),
        )
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      receipt: paymentReceipts,
      participantEmail: users.email,
      reviewedByEmail: reviewer.email,
    })
    .from(paymentReceipts)
    .innerJoin(users, eq(paymentReceipts.userId, users.id))
    .leftJoin(reviewer, eq(paymentReceipts.reviewedBy, reviewer.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(paymentReceipts.submittedAt), asc(paymentReceipts.id))
    .limit(params.limit);

  return rows.map((r) => ({
    ...r.receipt,
    participantEmail: r.participantEmail,
    reviewedByEmail: r.reviewedByEmail ?? null,
  }));
}

export async function getReceiptById(db: Db, id: string): Promise<ReceiptWithEmails | null> {
  const reviewer = alias(users, 'reviewer');

  const rows = await db
    .select({
      receipt: paymentReceipts,
      participantEmail: users.email,
      reviewedByEmail: reviewer.email,
    })
    .from(paymentReceipts)
    .innerJoin(users, eq(paymentReceipts.userId, users.id))
    .leftJoin(reviewer, eq(paymentReceipts.reviewedBy, reviewer.id))
    .where(eq(paymentReceipts.id, id))
    .limit(1);

  if (!rows[0]) return null;
  return {
    ...rows[0].receipt,
    participantEmail: rows[0].participantEmail,
    reviewedByEmail: rows[0].reviewedByEmail ?? null,
  };
}

export async function updateReceiptStatus(
  db: Db,
  id: string,
  params: {
    status: 'verified' | 'rejected';
    reviewedBy: string;
    reviewedAt: Date;
    rejectionReason: string | null;
  },
): Promise<void> {
  await db
    .update(paymentReceipts)
    .set({
      status: params.status,
      reviewedBy: params.reviewedBy,
      reviewedAt: params.reviewedAt,
      rejectionReason: params.rejectionReason,
    })
    .where(eq(paymentReceipts.id, id));
}

export async function deleteReceiptById(db: Db, id: string): Promise<void> {
  await db.delete(paymentReceipts).where(eq(paymentReceipts.id, id));
}
