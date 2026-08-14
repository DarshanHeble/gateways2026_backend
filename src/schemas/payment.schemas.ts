/**
 * Payment Receipt Zod Schemas — request/response validation + OpenAPI generation.
 */

import { z } from 'zod';

export const SubmitReceiptBodySchema = z.object({
  fileData: z
    .string()
    .startsWith('data:application/pdf;base64,', 'fileData must be a base64-encoded PDF data URI.'),
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(5_000_000, 'File must not exceed 5MB.'),
  paymentMethod: z.enum(['upi', 'neft', 'gateway']),
  transactionReference: z.string().trim().min(4).max(128),
});

export const ReviewReceiptBodySchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().min(1).max(1000).optional(),
  })
  .refine((val) => val.decision !== 'rejected' || Boolean(val.reason?.trim()), {
    message: 'A rejection reason is required when rejecting a receipt.',
    path: ['reason'],
  });

export const ReceiptIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID.'),
});

export const PaymentReceiptResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  fileUrl: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  status: z.enum(['pending', 'verified', 'rejected']),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  amountInr: z.number(),
  paymentMethod: z.enum(['upi', 'neft', 'gateway']).nullable(),
  transactionReference: z.string().nullable(),
});

export const PaymentReceiptOrNullResponseSchema = PaymentReceiptResponseSchema.nullable();
export const PaymentReceiptListResponseSchema = z.array(PaymentReceiptResponseSchema);

export type SubmitReceiptBody = z.infer<typeof SubmitReceiptBodySchema>;
export type ReviewReceiptBody = z.infer<typeof ReviewReceiptBodySchema>;
export type ReceiptIdParam = z.infer<typeof ReceiptIdParamSchema>;
