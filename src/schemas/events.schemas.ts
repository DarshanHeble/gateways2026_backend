import { z } from 'zod';

/**
 * Represents a single fest event row returned from Google Sheets.
 *
 * Google Sheets headers are user-defined, so the exact field names depend on
 * the sheet's first row. We use a flexible record schema here rather than a
 * strict typed object. When events are migrated to MySQL in Phase 4, this
 * schema will be replaced with a strict Drizzle-inferred type.
 *
 * z.record(z.string(), z.any()) — uses z.any() (not z.unknown()) because
 * fastify-type-provider-zod v7 cannot serialize z.unknown() to JSON Schema.
 */
export const SheetEventSchema = z.record(z.string(), z.any());

/**
 * Response schema for GET /api/events.
 * An array of event objects from the sheet.
 */
export const ListEventsResponseSchema = z.array(SheetEventSchema);

/**
 * Acknowledgment body returned by POST /api/webhook/sheet-update on success.
 */
export const WebhookAckSchema = z.object({
  message: z.string(),
});

/**
 * Standard error response shape, mirrors the DataError wire format
 * set by the global error handler in src/plugins/security.ts.
 * Attached to route schemas so Swagger UI documents error responses.
 *
 * `details` uses z.any() instead of z.record(z.string(), z.unknown()) for the
 * same reason as SheetEventSchema — z.unknown() cannot be serialized to JSON
 * Schema by fastify-type-provider-zod v7 with Zod v4.
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number().int(),
    retryable: z.boolean(),
    correlationId: z.string().optional(),
    details: z.any().optional(),
  }),
});
