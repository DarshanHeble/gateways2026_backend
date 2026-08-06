/**
 * Payment Service — submit / review lifecycle for the global entry-pass receipt.
 *
 * submitReceipt: validates the uploaded PDF, uploads to Cloudinary, inserts
 *   a 'pending' row. Duplicate submissions while pending/verified are rejected;
 *   a prior 'rejected' receipt is replaced on resubmission.
 * reviewReceipt: see Task 10.
 */

import { v7 as uuidv7 } from 'uuid';
import { getAppDb, getWriterDb } from '../db/index.js';
import { withDeadlockRetry, withTransaction } from '../db/transaction.js';
import { createDataError } from '../errors/DataError.js';
import {
  createReceipt,
  deleteReceiptById,
  getReceiptByIdForUpdate,
  getReceiptByUser,
  listPendingReceipts as listPendingReceiptsRepo,
  updateReceiptStatus,
} from '../repositories/payment-receipts.repository.js';
import { insertAuditLogEntry } from '../repositories/audit-log.repository.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';
import { awardXp } from './xp.service.js';
import type { PaymentReceipt } from '../db/schema/payments.js';

const MAX_FILE_SIZE_BYTES = 5_000_000;
const PDF_DATA_URI_PREFIX = 'data:application/pdf;base64,';

export interface SubmitReceiptDto {
  fileData: string;
  fileName: string;
  fileSizeBytes: number;
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
