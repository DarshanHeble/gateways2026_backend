/**
 * Payment response shapes.
 *
 * Two audiences, two serializers:
 *   serializeReceipt      — the participant's own receipt (website, mobile-user)
 *   serializeAdminPayment — the review view (admin dashboard, mobile-admin)
 *
 * The admin shape maps this backend's model (one global entry pass per user,
 * PDF receipt, pending/verified/rejected) onto the dashboard's richer `Payment`
 * type. Fields the backend genuinely does not record are sent as `null` rather
 * than plausible-looking constants — see the note on `method` below.
 */

import type { PaymentReceipt } from '../db/schema/payments.js';
import type { ReceiptWithEmails } from '../repositories/payment-receipts.repository.js';

/** Timestamps arrive as strings (mysql2 `dateStrings: true`) or Dates depending on driver path. */
function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

export function serializeReceipt(receipt: PaymentReceipt, fileUrl: string) {
  const paymentMethod = receipt.paymentMethod as 'upi' | 'neft' | 'gateway' | null;
  return {
    id: receipt.id,
    userId: receipt.userId,
    fileUrl,
    fileName: receipt.fileName,
    fileSizeBytes: receipt.fileSizeBytes,
    status: receipt.status as 'pending' | 'verified' | 'rejected',
    submittedAt: toIso(receipt.submittedAt)!,
    reviewedBy: receipt.reviewedBy,
    reviewedAt: toIso(receipt.reviewedAt),
    rejectionReason: receipt.rejectionReason,
    amountInr: receipt.amountInr,
    paymentMethod,
    transactionReference: receipt.transactionReference,
  };
}

export function serializeAdminPayment(
  receipt: ReceiptWithEmails,
  entryPassAmountInr: number,
  registrationIds: string[] = [],
) {
  const paymentMethod = receipt.paymentMethod as 'upi' | 'neft' | 'gateway' | null;
  return {
    id: receipt.id,
    participantId: receipt.userId,
    participantEmail: receipt.participantEmail,

    // Every receipt is the same fixed global pass, so the amount is genuinely
    // known — unlike the fields below.
    amount: receipt.amountInr ?? entryPassAmountInr,
    breakdown: [{ label: 'Gateways 2026 entry pass', amount: receipt.amountInr ?? entryPassAmountInr }],

    // Deliberately null, not a plausible default. A reviewer reads this column and
    // makes a decision on it; rendering "UPI" for a payment channel the system has
    // never recorded would be fabricating evidence in the one place it costs most.
    // The dashboard should widen these to `| null` and render an em dash.
    method: paymentMethod,
    utr: receipt.transactionReference,
    invoiceSerial: null,
    receiptHash: null,
    deskShiftId: null,

    registrationIds,
    fraudFlags: [],

    fileName: receipt.fileName,
    fileSizeBytes: receipt.fileSizeBytes,
    status: receipt.status as 'pending' | 'verified' | 'rejected',
    submittedAt: toIso(receipt.submittedAt)!,
    reviewedBy: receipt.reviewedBy,
    reviewedByEmail: receipt.reviewedByEmail,
    reviewedAt: toIso(receipt.reviewedAt),
    reviewNote: receipt.rejectionReason,

    // No receipt URL here: signed URLs expire in 5 minutes, so one minted while
    // rendering a 200-row queue is dead before the reviewer clicks it. Clients
    // fetch GET /:id/receipt-url on demand, which also records who viewed what.
  };
}
