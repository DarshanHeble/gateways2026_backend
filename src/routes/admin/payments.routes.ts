/**
 * Admin payment review — registered under `/api/v1/admin/payments`.
 *
 * Consumed by the admin dashboard's review queue and, later, mobile-admin.
 * Every route calls assertAdmin: the `/admin` prefix is organisational only,
 * Fastify has no concept of a guarded subtree.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import { assertAuthenticated } from '../../plugins/jwt-auth.js';
import { assertAdmin } from '../../security/roles.js';
import { serializeAdminPayment } from '../../serializers/payment.serializer.js';
import {
  bulkReviewReceipts,
  getPaymentForAdmin,
  getReceiptDownloadUrl,
  listPaymentsForAdmin,
  reviewReceipt,
} from '../../services/payment.service.js';
import { ReviewReceiptBodySchema } from '../../schemas/payment.schemas.js';
import { auditRequest } from '../../repositories/audit-log.repository.js';
import { getAppDb } from '../../db/index.js';
import { listRegistrationsForUsers } from '../../repositories/registrations.repository.js';

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

const AdminPaymentSchema = z.object({
  id: z.string(),
  participantId: z.string(),
  participantEmail: z.string(),
  amount: z.number(),
  breakdown: z.array(z.object({ label: z.string(), amount: z.number() })),
  method: z.enum(['upi', 'neft', 'gateway']).nullable(),
  utr: z.string().nullable(),
  invoiceSerial: z.null(),
  receiptHash: z.null(),
  deskShiftId: z.null(),
  registrationIds: z.array(z.string()),
  fraudFlags: z.array(z.unknown()),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  status: z.enum(['pending', 'verified', 'rejected']),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedByEmail: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
});

export async function registerAdminPaymentRoutes(app: FastifyInstance, config: AppConfig) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  async function registrationIdsByUser(userIds: string[]) {
    const rows = await listRegistrationsForUsers(getAppDb(), [...new Set(userIds)]);
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const ids = result.get(row.userId) ?? [];
      ids.push(row.id);
      result.set(row.userId, ids);
    }
    return result;
  }

  router.get(
    '/',
    {
      schema: {
        tags: ['Admin · Payments'],
        summary: 'List payment receipts (Admin only)',
        description:
          'Keyset-paginated. Pass `status=pending` for the review queue. ' +
          'Follow `nextCursor` until it is null; cursors are opaque.',
        querystring: z.object({
          status: z.enum(['pending', 'verified', 'rejected']).optional(),
          participantId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(AdminPaymentSchema),
            nextCursor: z.string().nullable(),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);

      const { status, participantId, limit, cursor } = request.query;
      const page = await listPaymentsForAdmin({ status, userId: participantId, limit, cursor });
      const registrationIds = await registrationIdsByUser(page.items.map((item) => item.userId));

      return {
        items: page.items.map((r) => serializeAdminPayment(r, config.ENTRY_PASS_AMOUNT_INR, registrationIds.get(r.userId) ?? [])),
        nextCursor: page.nextCursor,
      };
    },
  );

  router.get(
    '/:id',
    {
      schema: {
        tags: ['Admin · Payments'],
        summary: 'Get one payment receipt (Admin only)',
        params: z.object({ id: z.string() }),
        response: {
          200: AdminPaymentSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const receipt = await getPaymentForAdmin(request.params.id);
      const registrationIds = await registrationIdsByUser([receipt.userId]);
      return serializeAdminPayment(receipt, config.ENTRY_PASS_AMOUNT_INR, registrationIds.get(receipt.userId) ?? []);
    },
  );

  router.get(
    '/:id/receipt-url',
    {
      schema: {
        tags: ['Admin · Payments'],
        summary: 'Mint a short-lived signed URL for the receipt PDF (Admin only)',
        description:
          'Minted on demand because the signature expires within minutes — a URL ' +
          'embedded in a list response would be stale before it is clicked.',
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ url: z.string() }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const result = await getReceiptDownloadUrl(request.params.id);
      // Audited after the URL is minted, so receipts that 404 or were erased do
      // not show up as views. Opening a receipt exposes a participant's payment
      // document, which is why the read itself belongs on the record.
      await auditRequest(request, {
        action: 'payment_receipt_viewed',
        targetType: 'payment_receipt',
        targetId: request.params.id,
      });
      return result;
    },
  );

  router.post(
    '/:id/review',
    {
      schema: {
        tags: ['Admin · Payments'],
        summary: 'Approve or reject a payment receipt (Admin only)',
        description:
          'Verifying awards +10 XP idempotently and writes an audit row, atomically ' +
          'with the status change. Rejecting requires a reason and returns the ' +
          'receipt to a state the participant can resubmit from.',
        params: z.object({ id: z.string() }),
        body: ReviewReceiptBodySchema,
        response: {
          200: AdminPaymentSchema,
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
      await reviewReceipt(request.params.id, request.user.id, request.body);
      // Re-read so the response carries the joined participant/reviewer emails.
      const receipt = await getPaymentForAdmin(request.params.id);
      const registrationIds = await registrationIdsByUser([receipt.userId]);
      return serializeAdminPayment(receipt, config.ENTRY_PASS_AMOUNT_INR, registrationIds.get(receipt.userId) ?? []);
    },
  );

  router.post(
    '/bulk-review',
    {
      schema: {
        tags: ['Admin · Payments'],
        summary: 'Review many receipts in one call (Admin only)',
        description:
          'Partial success by design: each receipt is reviewed in its own ' +
          'transaction, so one already-decided receipt cannot roll back the rest. ' +
          'Check `failures` for per-receipt reasons.',
        body: z.object({
          ids: z.array(z.string()).min(1).max(200),
          decision: z.enum(['verified', 'rejected']),
          reason: z.string().min(1).max(1000).optional(),
        }),
        response: {
          200: z.object({
            updated: z.number(),
            failures: z.array(z.object({ id: z.string(), code: z.string() })),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);
      const { ids, decision, reason } = request.body;
      return bulkReviewReceipts(ids, request.user.id, { decision, reason });
    },
  );
}
