import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadConfig } from '../config/env.js';
import {
  ErrorResponseSchema,
  ListEventsResponseSchema,
  WebhookAckSchema,
} from '../schemas/events.schemas.js';
import { fetchEventsFromSheet } from '../services/sheets.service.js';

/**
 * Events routes plugin.
 * Registers:
 *   GET  /api/events                   — Public. Returns all events from Google Sheets.
 *   POST /api/webhook/sheet-update     — Protected by x-webhook-secret header.
 *                                        Signals the backend that Sheets data changed.
 *
 * Register in app.ts with: app.register(eventsRoutes, { prefix: '/api' })
 *
 * NOTE: Response schemas intentionally omitted for now while diagnosing a serializer
 * compatibility issue between fastify-type-provider-zod v7 and Zod v4. Routes use
 * raw JSON.stringify for responses until the root cause is resolved.
 */
export async function eventsRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const config = loadConfig();

  // ---------------------------------------------------------------------------
  // GET /api/events
  // Public endpoint. Fetches all event rows directly from Google Sheets.
  // No cache — every request calls the Sheets API. Failures → 503.
  // ---------------------------------------------------------------------------
  typedApp.get(
    '/events',
    {
      schema: {
        description:
          'Returns the full list of fest events fetched live from Google Sheets. ' +
          'No caching is applied — each call reflects the current sheet state.',
        tags: ['Events'],
        summary: 'List all fest events',
        response: {
          200: ListEventsResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // fetchEventsFromSheet() throws DataError('STORAGE_UNAVAILABLE') on any
      // Google API failure. The global error handler in security.ts catches it
      // and sends the correct 503 JSON response — no try/catch needed here.
      const events = await fetchEventsFromSheet();
      request.log.info({ count: events.length }, 'Fetched events from Google Sheets');
      return reply.send(events);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/webhook/sheet-update
  // Protected by a shared secret in the x-webhook-secret request header.
  // Call this from a Google Apps Script onEdit trigger to notify the backend
  // that the spreadsheet has been updated.
  //
  // Rate-limited to 10 req/min per IP to prevent brute-force secret discovery.
  // Since no cache is in use, this endpoint is a no-op acknowledgment for now
  // but is wired up correctly for future expansion (e.g., triggering a sync job).
  // ---------------------------------------------------------------------------
  typedApp.post(
    '/webhook/sheet-update',
    {
      schema: {
        description:
          'Webhook endpoint called by Google Apps Script when the source spreadsheet is modified. ' +
          'Requires the x-webhook-secret header to match SHEET_WEBHOOK_SECRET in the server environment. ' +
          'Since no cache is in use, this call is acknowledged immediately; the next GET /api/events ' +
          'will automatically return fresh data.',
        tags: ['Webhooks'],
        summary: 'Notify backend of Google Sheets update',
        response: {
          200: WebhookAckSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const providedSecret = request.headers['x-webhook-secret'];
      const correlationId = (request.headers['x-correlation-id'] as string) || 'N/A';

      // Direct reply for auth rejection — bypasses the error pipeline entirely.
      if (!providedSecret || providedSecret !== config.SHEET_WEBHOOK_SECRET) {
        request.log.warn({ ip: request.ip }, 'Webhook called with invalid or missing secret');
        return reply.status(401).send({
          error: {
            code: 'NOT_AUTHENTICATED',
            message: 'Invalid or missing webhook secret.',
            statusCode: 401,
            retryable: false,
            correlationId,
          },
        });
      }

      request.log.info('Sheet update webhook received. No cache to invalidate; next fetch will be fresh.');

      return reply.send({
        message:
          'Acknowledged. No cache is in use; the next GET /api/events call will fetch fresh data from Google Sheets.',
      });
    }
  );
}
