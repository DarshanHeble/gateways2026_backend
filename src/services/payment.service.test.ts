import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';

vi.mock('../storage/cloudinary.storage.js', () => ({
  cloudinaryStorage: {
    uploadFile: vi.fn(async ({ publicId }: { publicId: string }) => ({
      url: `https://res.cloudinary.com/test/raw/upload/${publicId}`,
      publicId,
      bytes: 4,
    })),
    deleteFile: vi.fn(async () => {}),
  },
}));

const { submitReceipt } = await import('./payment.service.js');

const db = getAppDb();
let cleanupUserId: string | null = null;

// A 1x1 valid base64 payload is unnecessary — the service only checks the
// data-URI prefix and decoded byte length, not that it's a real PDF.
const SMALL_PDF_DATA_URI = 'data:application/pdf;base64,JVBERi0xLjQK';

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('submitReceipt', () => {
  it('creates a pending receipt for a first-time submission', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    const receipt = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    expect(receipt.userId).toBe(user.id);
    expect(receipt.status).toBe('pending');
    expect(receipt.fileUrl).toContain('cloudinary.com');
  });

  it('rejects a non-PDF data URI', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await expect(
      submitReceipt(user.id, {
        fileData: 'data:image/png;base64,AAAA',
        fileName: 'receipt.png',
        fileSizeBytes: 3,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a second submission while the first is pending', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    await expect(
      submitReceipt(user.id, {
        fileData: SMALL_PDF_DATA_URI,
        fileName: 'receipt-2.pdf',
        fileSizeBytes: 9,
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_ALREADY_SUBMITTED' });
  });

  it('allows resubmission after a rejection', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    const first = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    // Simulate a reviewer rejecting it directly via the repository (review
    // flow itself is Task 10 — here we only need the receipt in 'rejected' state).
    const { updateReceiptStatus } = await import('../repositories/payment-receipts.repository.js');
    await updateReceiptStatus(db, first.id, {
      status: 'rejected',
      reviewedBy: user.id,
      reviewedAt: new Date(),
      rejectionReason: 'blurry scan',
    });

    const second = await submitReceipt(user.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt-retry.pdf',
      fileSizeBytes: 9,
    });

    expect(second.status).toBe('pending');
    expect(second.fileName).toBe('receipt-retry.pdf');
  });
});
