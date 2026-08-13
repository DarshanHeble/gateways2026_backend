import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';
import {
  createReceipt,
  deleteReceiptById,
  getReceiptByIdForUpdate,
  getReceiptByUser,
  listPendingReceipts,
  updateReceiptStatus,
} from './payment-receipts.repository.js';
import { withTransaction } from '../db/transaction.js';
import { v7 as uuidv7 } from 'uuid';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('payment-receipts.repository', () => {
  it('creates a receipt and finds it by user', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-1',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-1',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const found = await getReceiptByUser(db, user.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(receiptId);
    expect(found?.status).toBe('pending');
  });

  it('lists only pending receipts', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-2',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-2',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const pendingBefore = await listPendingReceipts(db);
    expect(pendingBefore.some((r) => r.id === receiptId)).toBe(true);

    await updateReceiptStatus(db, receiptId, {
      status: 'verified',
      reviewedBy: user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
    });

    const pendingAfter = await listPendingReceipts(db);
    expect(pendingAfter.some((r) => r.id === receiptId)).toBe(false);
  });

  it('locks a row FOR UPDATE inside a transaction', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-3',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-3',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    const locked = await withTransaction(db, (tx) => getReceiptByIdForUpdate(tx, receiptId));
    expect(locked?.id).toBe(receiptId);
  });

  it('deletes a receipt by id', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;
    const receiptId = uuidv7();

    await createReceipt(db, {
      id: receiptId,
      userId: user.id,
      cloudinaryPublicId: 'pub-4',
      fileUrl: 'https://res.cloudinary.com/x/raw/upload/pub-4',
      fileName: 'receipt.pdf',
      fileSizeBytes: 1234,
    });

    await deleteReceiptById(db, receiptId);
    const found = await getReceiptByUser(db, user.id);
    expect(found).toBeNull();
  });
});
