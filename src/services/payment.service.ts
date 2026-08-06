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
  getReceiptByUser,
} from '../repositories/payment-receipts.repository.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';
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

  const writerDb = getWriterDb();
  return withDeadlockRetry(() =>
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

      const created = await getReceiptByUser(tx, userId);
      if (!created) {
        throw createDataError('INTERNAL_ERROR', 'Receipt row failed to persist.');
      }
      return created;
    }),
  );
}

export async function getOwnReceipt(userId: string): Promise<PaymentReceipt | null> {
  return getReceiptByUser(getAppDb(), userId);
}
