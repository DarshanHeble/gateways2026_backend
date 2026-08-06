/**
 * Payment Receipts Repository — raw DB access only. Business rules
 * (duplicate-submission checks, status-transition guards) live in
 * services/payment.service.ts.
 */

import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { paymentReceipts } from '../db/schema/payments.js';

type Db = MySql2Database<typeof schema>;
type PaymentReceipt = schema.PaymentReceipt;

export async function createReceipt(
  db: Db,
  params: {
    id: string;
    userId: string;
    cloudinaryPublicId: string;
    fileUrl: string;
    fileName: string;
    fileSizeBytes: number;
  },
): Promise<void> {
  await db.insert(paymentReceipts).values({
    id: params.id,
    userId: params.userId,
    cloudinaryPublicId: params.cloudinaryPublicId,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    fileSizeBytes: params.fileSizeBytes,
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
  return db.select().from(paymentReceipts).where(eq(paymentReceipts.status, 'pending'));
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
