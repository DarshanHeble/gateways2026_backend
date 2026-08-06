/**
 * Payment Receipt Routes — registered under prefix `/payment-receipts` in app.ts.
 *
 * Endpoints:
 *   POST   /payment-receipts            — submit a receipt (PDF, base64)   [auth required]
 *   GET    /payment-receipts/me         — caller's own receipt or null      [auth required]
 *   GET    /payment-receipts/pending    — list receipts awaiting review     [auth + ADMIN]
 *   POST   /payment-receipts/:id/review — approve/reject a receipt          [auth + ADMIN]
 *
 * CSRF: all POST endpoints here require the X-CSRF-Token header (enforced
 * globally in security.ts) — they are not in the CSRF-exempt path list.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { assertAdmin } from '../security/roles.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';
import {
  getOwnReceipt,
  listPendingReceipts,
  reviewReceipt,
  submitReceipt,
} from '../services/payment.service.js';
import {
  PaymentReceiptListResponseSchema,
  PaymentReceiptOrNullResponseSchema,
  PaymentReceiptResponseSchema,
  ReceiptIdParamSchema,
  ReviewReceiptBodySchema,
  SubmitReceiptBodySchema,
} from '../schemas/payment.schemas.js';
import type { PaymentReceipt } from '../db/schema/payments.js';

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number(),
    retryable: z.boolean(),
    correlationId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

function serializeReceipt(receipt: PaymentReceipt) {
  return {
    id: receipt.id,
    userId: receipt.userId,
    fileUrl: cloudinaryStorage.createSignedDownloadUrl(receipt.cloudinaryPublicId),
    fileName: receipt.fileName,
    fileSizeBytes: receipt.fileSizeBytes,
    status: receipt.status as 'pending' | 'verified' | 'rejected',
    submittedAt:
      typeof receipt.submittedAt === 'string' ? receipt.submittedAt : receipt.submittedAt.toISOString(),
    reviewedBy: receipt.reviewedBy,
    reviewedAt:
      receipt.reviewedAt == null
        ? null
        : typeof receipt.reviewedAt === 'string'
          ? receipt.reviewedAt
          : receipt.reviewedAt.toISOString(),
    rejectionReason: receipt.rejectionReason,
  };
}

export async function registerPaymentReceiptRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.post(
    '/',
    {
      bodyLimit: 8_000_000,
      schema: {
        tags: ['Payments'],
        summary: 'Submit the one-time entry-pass payment receipt',
        body: SubmitReceiptBodySchema,
        response: {
          201: PaymentReceiptResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      assertAuthenticated(request);
      const receipt = await submitReceipt(request.user.id, request.body);
      return reply.status(201).send(serializeReceipt(receipt));
    },
  );

  router.get(
    '/me',
    {
      schema: {
        tags: ['Payments'],
        summary: "Get the caller's own payment receipt",
        response: {
          200: PaymentReceiptOrNullResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      const receipt = await getOwnReceipt(request.user.id);
      return receipt ? serializeReceipt(receipt) : null;
    },
  );

  router.get(
    '/pending',
    {
      schema: {
        tags: ['Payments'],
        summary: 'List receipts awaiting review (Admin only)',
        response: {
          200: PaymentReceiptListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const receipts = await listPendingReceipts();
      return receipts.map(serializeReceipt);
    },
  );

  router.post(
    '/:id/review',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Approve or reject a payment receipt (Admin only)',
        params: ReceiptIdParamSchema,
        body: ReviewReceiptBodySchema,
        response: {
          200: PaymentReceiptResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const receipt = await reviewReceipt(request.params.id, request.user.id, request.body);
      return serializeReceipt(receipt);
    },
  );
}
