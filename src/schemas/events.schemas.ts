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
export const EventHeadSchema = z.object({
  name: z.string(),
  role: z.string(),
  phone: z.string(),
  email: z.string(),
});

export const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  date: z.string(),
  from_time: z.string(),
  end_time: z.string(),
  venue: z.string(),
  type: z.string(),
  image_url: z.string().optional(),
  description: z.string(),
  rules: z.array(z.string()),
  rules_pdf_url: z.string().optional(),
  eligibility: z.array(z.string()),
  prizes: z.object({
    winner: z.string().optional(),
    runner_up: z.string().optional(),
    second_runner_up: z.string().optional(),
  }),
  event_heads: z.array(EventHeadSchema),
});

export const ListEventsResponseSchema = z.array(EventSchema);

export const ScheduleItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  date: z.string(),
  from_time: z.string(),
  end_time: z.string(),
  venue: z.string(),
  category: z.string(),
  is_competition: z.boolean(),
});

export const ScheduleDaySchema = z.object({
  day_number: z.number().int(),
  date: z.string(),
  display_date: z.string(),
  timeline: z.array(ScheduleItemSchema),
});

export const GetScheduleResponseSchema = z.object({
  days: z.array(ScheduleDaySchema),
});

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
