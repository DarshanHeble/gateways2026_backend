/**
 * Payment Service — submit / review lifecycle for the global entry-pass receipt.
 *
 * submitReceipt: validates the uploaded PDF, uploads to Cloudinary, inserts
 *   a 'pending' row. Duplicate submissions while pending/verified are rejected;
 *   a prior 'rejected' receipt is replaced on resubmission.
 * reviewReceipt: see Task 10.
 */

import { v7 as uuidv7 } from 'uuid';
import { and, eq, inArray } from 'drizzle-orm';
import { getAppDb, getWriterDb } from '../db/index.js';
import { loadConfig } from '../config/env.js';
import { withDeadlockRetry, withTransaction } from '../db/transaction.js';
import { DataError, createDataError } from '../errors/DataError.js';
import {
  createReceipt,
  deleteReceiptById,
  getReceiptById,
  getReceiptByIdForUpdate,
  getReceiptByUser,
  listPendingReceipts as listPendingReceiptsRepo,
  listReceipts,
  updateReceiptStatus,
  type ReceiptWithEmails,
} from '../repositories/payment-receipts.repository.js';
import { insertAuditLogEntry } from '../repositories/audit-log.repository.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';
import { awardXp } from './xp.service.js';
import { paymentReceipts, type PaymentReceipt } from '../db/schema/payments.js';
import { registrations } from '../db/schema/registrations.js';

const MAX_FILE_SIZE_BYTES = 5_000_000;
const PDF_DATA_URI_PREFIX = 'data:application/pdf;base64,';

export interface SubmitReceiptDto {
  fileData: string;
  fileName: string;
  fileSizeBytes: number;
  paymentMethod?: 'upi' | 'neft' | 'gateway';
  transactionReference?: string;
}

export async function submitReceipt(userId: string, dto: SubmitReceiptDto): Promise<PaymentReceipt> {
  if (!dto.fileData.startsWith(PDF_DATA_URI_PREFIX)) {
    throw createDataError('VALIDATION_FAILED', 'Receipt file must be a PDF.');
  }

  const base64Payload = dto.fileData.slice(PDF_DATA_URI_PREFIX.length);
  const decodedBytes = Buffer.from(base64Payload, 'base64').length;
  if (decodedBytes > MAX_FILE_SIZE_BYTES) {
    throw createDataError('VALIDATION_FAILED', 'Receipt file must not exceed 5MB.');
  }

  const appDb = getAppDb();
  const existing = await getReceiptByUser(appDb, userId);
  if (existing && (existing.status === 'pending' || existing.status === 'verified')) {
    throw createDataError('RECEIPT_ALREADY_SUBMITTED');
  }

  const receiptId = uuidv7();
  const transactionReference = dto.transactionReference?.trim().toUpperCase() || `LEGACY-${receiptId}`;
  const duplicateReference = await appDb
    .select({ id: paymentReceipts.id, userId: paymentReceipts.userId, status: paymentReceipts.status })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.transactionReference, transactionReference))
    .limit(1);
  if (duplicateReference[0] && duplicateReference[0].userId !== userId) {
    throw createDataError('VALIDATION_FAILED', 'That transaction reference has already been submitted.');
  }
  const upload = await cloudinaryStorage.uploadFile({
    data: dto.fileData,
    folder: 'gateways/payment-receipts',
    publicId: receiptId,
  });

  // Old Cloudinary object to clean up (only relevant on resubmission after a
  // rejection). Captured before the transaction since deleteFile is a network
  // call and shouldn't run inside a DB transaction.
  const oldPublicIdToClean = existing?.status === 'rejected' ? existing.cloudinaryPublicId : null;

  const writerDb = getWriterDb();
  let created: PaymentReceipt;
  try {
    created = await withDeadlockRetry(() =>
      withTransaction(writerDb, async (tx) => {
        // A previously rejected receipt is replaced on resubmission — the
        // UNIQUE(user_id) constraint means the old row must go first.
        if (existing && existing.status === 'rejected') {
          await deleteReceiptById(tx, existing.id);
        }

        await createReceipt(tx, {
          id: receiptId,
          userId,
          cloudinaryPublicId: upload.publicId,
          fileUrl: upload.url,
          fileName: dto.fileName,
          fileSizeBytes: decodedBytes,
          amountInr: loadConfig().ENTRY_PASS_AMOUNT_INR,
          paymentMethod: dto.paymentMethod ?? 'upi',
          transactionReference,
        });

        const inserted = await getReceiptByUser(tx, userId);
        if (!inserted) {
          throw createDataError('INTERNAL_ERROR', 'Receipt row failed to persist.');
        }
        return inserted;
      }),
    );
  } catch (err) {
    // The transaction failed — the just-uploaded file is now orphaned in
    // Cloudinary with no DB row referencing it. Best-effort cleanup; never
    // let a delete failure mask the original error.
    try {
      await cloudinaryStorage.deleteFile(upload.publicId);
    } catch {
      // swallow — nothing more we can do here.
    }
    if (isDuplicateKeyError(err)) {
      throw createDataError('VALIDATION_FAILED', 'That transaction reference has already been submitted.');
    }
    throw err;
  }

  if (oldPublicIdToClean) {
    try {
      await cloudinaryStorage.deleteFile(oldPublicIdToClean);
    } catch {
      // best-effort — old object may leak but the resubmission itself succeeded.
    }
  }

  return created;
}

function isDuplicateKeyError(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string; errno?: number }; errno?: number } | null;
  return value?.code === 'ER_DUP_ENTRY'
    || value?.errno === 1062
    || value?.cause?.code === 'ER_DUP_ENTRY'
    || value?.cause?.errno === 1062;
}

export async function getOwnReceipt(userId: string): Promise<PaymentReceipt | null> {
  return getReceiptByUser(getAppDb(), userId);
}

const XP_AWARD_AMOUNT = 10;

export interface ReviewReceiptDto {
  decision: 'verified' | 'rejected';
  reason?: string;
}

export async function reviewReceipt(
  receiptId: string,
  reviewerId: string,
  dto: ReviewReceiptDto,
): Promise<PaymentReceipt> {
  if (dto.decision === 'rejected' && (!dto.reason || dto.reason.trim().length === 0)) {
    throw createDataError('VALIDATION_FAILED', 'A rejection reason is required.');
  }

  const writerDb = getWriterDb();
  return withDeadlockRetry(() =>
    withTransaction(writerDb, async (tx) => {
      const receipt = await getReceiptByIdForUpdate(tx, receiptId);
      if (!receipt) {
        throw createDataError('NOT_FOUND', 'Payment receipt not found.');
      }
      if (receipt.status !== 'pending') {
        throw createDataError('VALIDATION_FAILED', 'This receipt has already been decided.');
      }

      const reviewedAt = new Date();
      await updateReceiptStatus(tx, receiptId, {
        status: dto.decision,
        reviewedBy: reviewerId,
        reviewedAt,
        rejectionReason: dto.decision === 'rejected' ? dto.reason! : null,
      });

      if (dto.decision === 'verified') {
        await awardXp(tx, {
          userId: receipt.userId,
          amount: XP_AWARD_AMOUNT,
          reason: 'Gateways entry pass verified',
          sourceType: 'payment_verification',
          sourceId: receiptId,
          awardedBy: reviewerId,
        });
      }

      // Legacy registrations may predate the payment-first gate. Keep their
      // per-registration gate synchronized with the participant's single
      // festival-pass receipt, while leaving the registration status itself
      // unchanged for the organizer to manage.
      await tx.update(registrations)
        .set({ paymentStatus: dto.decision })
        .where(and(
          eq(registrations.userId, receipt.userId),
          inArray(registrations.status, ['pending', 'confirmed', 'waitlisted']),
        ));

      await insertAuditLogEntry(tx, {
        actorUserId: reviewerId,
        action: 'payment_receipt_reviewed',
        targetType: 'payment_receipt',
        targetId: receiptId,
        metadata: { decision: dto.decision, reason: dto.reason ?? null },
      });

      const updated = await getReceiptByIdForUpdate(tx, receiptId);
      if (!updated) {
        throw createDataError('INTERNAL_ERROR', 'Receipt row disappeared during review.');
      }
      return updated;
    }),
  );
}

export async function listPendingReceipts(): Promise<PaymentReceipt[]> {
  return listPendingReceiptsRepo(getAppDb());
}

// ─── Admin surface ────────────────────────────────────────────────────────────

/** Cursor is opaque to clients: base64 of the keyset pair we page on. */
function encodeCursor(receipt: { submittedAt: Date | string; id: string }): string {
  const submittedAt =
    typeof receipt.submittedAt === 'string'
      ? receipt.submittedAt
      : receipt.submittedAt.toISOString();
  return Buffer.from(JSON.stringify({ submittedAt, id: receipt.id })).toString('base64url');
}

function decodeCursor(cursor?: string): { submittedAt: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (typeof parsed?.submittedAt === 'string' && typeof parsed?.id === 'string') return parsed;
  } catch {
    /* fall through to the shared error below */
  }
  throw createDataError('VALIDATION_FAILED', 'Malformed pagination cursor.');
}

/**
 * Paginated receipt listing for the review queue.
 *
 * Paginated from the start deliberately: the dashboard is a client we don't
 * control, so adding pagination later would be a breaking response-shape change.
 */
export async function listPaymentsForAdmin(params: {
  status?: string;
  userId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: ReceiptWithEmails[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  // Fetch one extra row to detect "there is another page" without a COUNT query.
  const rows = await listReceipts(getAppDb(), {
    status: params.status,
    userId: params.userId,
    limit: limit + 1,
    cursor: decodeCursor(params.cursor),
  });

  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

export async function getPaymentForAdmin(id: string): Promise<ReceiptWithEmails> {
  const receipt = await getReceiptById(getAppDb(), id);
  if (!receipt) throw createDataError('NOT_FOUND', 'Payment receipt not found.');
  return receipt;
}

/**
 * Mint a short-lived signed URL for one receipt PDF.
 *
 * On demand rather than embedded in list responses: the signature expires in
 * minutes, and this gives an audit point for who opened which receipt.
 */
export async function getReceiptDownloadUrl(id: string): Promise<{ url: string }> {
  const receipt = await getReceiptById(getAppDb(), id);
  if (!receipt) throw createDataError('NOT_FOUND', 'Payment receipt not found.');
  if (receipt.cloudinaryPublicId.startsWith('erased-')) {
    throw createDataError('NOT_FOUND', 'This receipt file has been erased.');
  }
  return { url: cloudinaryStorage.createSignedDownloadUrl(receipt.cloudinaryPublicId) };
}

/**
 * Review many receipts in one call.
 *
 * Each receipt gets its own transaction and failures are collected rather than
 * thrown: one already-decided receipt in a batch of 50 must not roll back the
 * other 49. Callers get partial success plus a per-id reason.
 */
export async function bulkReviewReceipts(
  receiptIds: string[],
  reviewerId: string,
  dto: ReviewReceiptDto,
): Promise<{ updated: number; failures: { id: string; code: string }[] }> {
  const failures: { id: string; code: string }[] = [];
  let updated = 0;

  for (const id of receiptIds) {
    try {
      await reviewReceipt(id, reviewerId, dto);
      updated++;
    } catch (err) {
      failures.push({
        id,
        code: err instanceof DataError ? err.code : 'INTERNAL_ERROR',
      });
    }
  }

  return { updated, failures };
}
