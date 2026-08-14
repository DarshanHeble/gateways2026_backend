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
import { serializeReceipt } from '../serializers/payment.serializer.js';
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
import { loadConfig } from '../config/env.js';

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

/** Shared with the admin surface — see src/serializers/payment.serializer.ts. */
function serialize(receipt: PaymentReceipt) {
  return serializeReceipt(receipt, cloudinaryStorage.createSignedDownloadUrl(receipt.cloudinaryPublicId));
}

export async function registerPaymentReceiptRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get('/config', {
    schema: {
      tags: ['Payments'],
      summary: 'Get the configured one-time entry-pass amount',
      response: { 200: z.object({ amountInr: z.number().int().positive() }) },
    },
  }, async () => ({ amountInr: loadConfig().ENTRY_PASS_AMOUNT_INR }));

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
      return reply.status(201).send(serialize(receipt));
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
      return receipt ? serialize(receipt) : null;
    },
  );

  // Admin review endpoints (list queue, approve/reject) now live at
  // /api/v1/admin/payments — see src/routes/admin/payments.routes.ts. They serve a
  // different audience with a different response shape, so they are no longer
  // interleaved with the participant's own-receipt routes.
}
