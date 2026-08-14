import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser, grantRole } from '../test-helpers/db.js';

vi.mock('../storage/cloudinary.storage.js', () => ({
  cloudinaryStorage: {
    uploadFile: vi.fn(async ({ publicId }: { publicId: string }) => ({
      url: `https://res.cloudinary.com/test/raw/upload/${publicId}`,
      publicId,
      bytes: 4,
    })),
    deleteFile: vi.fn(async () => {}),
    createSignedDownloadUrl: vi.fn(() => 'https://res.cloudinary.com/test/mock-signed-url'),
  },
}));

const {
  submitReceipt,
  reviewReceipt,
  listPendingReceipts: listPendingReceiptsService,
} = await import('./payment.service.js');

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

    // The old (rejected) receipt's Cloudinary object must be cleaned up after
    // the resubmission transaction commits — publicId equals the old receipt id.
    const { cloudinaryStorage } = await import('../storage/cloudinary.storage.js');
    expect(cloudinaryStorage.deleteFile).toHaveBeenCalledWith(first.id);
  });
});

describe('reviewReceipt', () => {
  it('verifies a pending receipt and awards +10 XP exactly once', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id; // reviewer cleaned up manually below

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    const reviewed = await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });
    expect(reviewed.status).toBe('verified');
    expect(reviewed.reviewedBy).toBe(reviewer.id);

    const { getTotalXpForUser } = await import('../repositories/xp.repository.js');
    const total = await getTotalXpForUser(db, submitter.id);
    expect(total).toBe(10);

    // Delete the submitter (and its receipt, which FK-references the reviewer
    // via reviewed_by) before the reviewer, or the reviewer delete violates
    // payment_receipts_reviewed_by_users_id_fk.
    await deleteTestUser(db, submitter.id);
    await deleteTestUser(db, reviewer.id);
    cleanupUserId = null;
  });

  it('rejects re-deciding an already-verified receipt', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });
    await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });

    await expect(reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Delete the submitter (and its receipt, which FK-references the reviewer
    // via reviewed_by) before the reviewer, or the reviewer delete violates
    // payment_receipts_reviewed_by_users_id_fk.
    await deleteTestUser(db, submitter.id);
    await deleteTestUser(db, reviewer.id);
    cleanupUserId = null;
  });

  it('requires a non-empty reason to reject', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    await expect(reviewReceipt(receipt.id, reviewer.id, { decision: 'rejected' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Delete the submitter (and its receipt, which FK-references the reviewer
    // via reviewed_by) before the reviewer, or the reviewer delete violates
    // payment_receipts_reviewed_by_users_id_fk.
    await deleteTestUser(db, submitter.id);
    await deleteTestUser(db, reviewer.id);
    cleanupUserId = null;
  });

  it('rejects with a reason and does not award XP', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    const reviewed = await reviewReceipt(receipt.id, reviewer.id, {
      decision: 'rejected',
      reason: 'Blurry, amount not legible',
    });
    expect(reviewed.status).toBe('rejected');
    expect(reviewed.rejectionReason).toBe('Blurry, amount not legible');

    const { getTotalXpForUser } = await import('../repositories/xp.repository.js');
    const total = await getTotalXpForUser(db, submitter.id);
    expect(total).toBe(0);

    // Delete the submitter (and its receipt, which FK-references the reviewer
    // via reviewed_by) before the reviewer, or the reviewer delete violates
    // payment_receipts_reviewed_by_users_id_fk.
    await deleteTestUser(db, submitter.id);
    await deleteTestUser(db, reviewer.id);
    cleanupUserId = null;
  });

  it('listPendingReceipts excludes decided receipts', async () => {
    const submitter = await createTestUser(db);
    const reviewer = await createTestUser(db);
    cleanupUserId = submitter.id;

    const receipt = await submitReceipt(submitter.id, {
      fileData: SMALL_PDF_DATA_URI,
      fileName: 'receipt.pdf',
      fileSizeBytes: 9,
    });

    let pending = await listPendingReceiptsService();
    expect(pending.some((r) => r.id === receipt.id)).toBe(true);

    await reviewReceipt(receipt.id, reviewer.id, { decision: 'verified' });

    pending = await listPendingReceiptsService();
    expect(pending.some((r) => r.id === receipt.id)).toBe(false);

    // Delete the submitter (and its receipt, which FK-references the reviewer
    // via reviewed_by) before the reviewer, or the reviewer delete violates
    // payment_receipts_reviewed_by_users_id_fk.
    await deleteTestUser(db, submitter.id);
    await deleteTestUser(db, reviewer.id);
    cleanupUserId = null;
  });
});
