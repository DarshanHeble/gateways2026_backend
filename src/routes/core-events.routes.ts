import type { FastifyInstance } from 'fastify';
import { getAppDb } from '../db/index.js';
import { getEventStats } from '../repositories/events.repository.js';
import { fetchEventsFromSheet } from '../services/sheets.service.js';
import { serializeSheetEvent, type SheetEvent } from '../serializers/sheet-event.serializer.js';

function iso(value: Date | string | null): string | null {
  return value == null ? null : typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

function serialize(row: any) {
  if (!row) return null;
  const event = row.event ?? row;
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    tagline: event.description,
    description: event.description,
    rules: null,
    categoryId: event.categoryId,
    categorySlug: row.categorySlug ?? null,
    status: String(event.status).toLowerCase(),
    mode: event.isTeamEvent ? 'team' : 'solo',
    minTeamSize: event.minTeamSize ?? 1,
    maxTeamSize: event.maxTeamSize ?? 1,
    capacity: event.capacity,
    venue: event.venue,
    startsAt: iso(event.startsAt),
    endsAt: iso(event.endsAt),
    registrationOpensAt: iso(event.registrationOpensAt),
    registrationClosesAt: iso(event.registrationClosesAt),
    xpReward: event.xpReward ?? 0,
    entryFeeInr: event.feeAmount ?? 0,
    requiresApproval: Boolean(event.requiresApproval),
    contactEmail: event.contactEmail,
    createdBy: event.createdBy,
    createdAt: iso(event.createdAt),
    updatedAt: iso(event.updatedAt),
  };
}

/**
 * Reads the sheet and maps it, applying the same filters the MySQL-backed
 * `listEvents` used to. Filtering happens here rather than in the sheet fetch so
 * every caller shares one cached snapshot regardless of its query string —
 * otherwise the cache would miss on each distinct search term.
 */
async function listSheetEvents(filter: {
  search?: string;
  status?: string;
  mode?: string;
}): Promise<SheetEvent[]> {
  const rows = await fetchEventsFromSheet();
  let events = rows.map(serializeSheetEvent).filter((event) => event.id !== '');

  const search = filter.search?.trim().toLowerCase();
  if (search) {
    events = events.filter((event) =>
      [event.title, event.tagline, event.description, event.venue, event.categorySlug]
        .some((field) => field?.toLowerCase().includes(search)),
    );
  }

  if (filter.status) events = events.filter((event) => event.status === filter.status);
  if (filter.mode) events = events.filter((event) => event.mode === filter.mode);

  // Undated rows sort last rather than throwing off the order with NaN.
  return events.sort((a, b) => (a.startsAt ?? '9999').localeCompare(b.startsAt ?? '9999'));
}

export async function registerCoreEventRoutes(app: FastifyInstance) {
  // Events are sourced from Google Sheets, NOT MySQL. Staff maintain the sheet
  // and the site reflects edits within ~10s (5s cache + 5s client poll).
  //
  // The `events` table is deliberately untouched here. Nothing syncs the sheet
  // into it yet, so registrations/teams/attendance — which carry foreign keys to
  // events.id — cannot reference a sheet-only event. That sync is still needed
  // before per-event registration can work; see docs/EVENTS_SHEETS_HANDOFF.md.
  app.get('/', async (request) => {
    const query = request.query as { search?: string; status?: string; mode?: string };
    return listSheetEvents(query);
  });

  // Derived from the events themselves: the sheet has no per-round rows, so each
  // event contributes exactly one slot. The MySQL `schedule_slots` table is not
  // consulted — it is empty, and mixing two sources would show a partial
  // schedule that looks complete.
  app.get('/schedule', async () => {
    const events = await listSheetEvents({});
    return events
      .filter((event) => event.startsAt !== null)
      .map((event) => ({
        id: event.id,
        eventId: event.id,
        eventTitle: event.title,
        roundName: null,
        venue: event.venue,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      }));
  });
  app.get('/:id/stats', async (request, reply) => {
    const stats = await getEventStats(getAppDb(), (request.params as { id: string }).id);
    if (!stats) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    return stats;
  });
  // Accepts the sheet's `id`, which doubles as the slug, so both the
  // /events/:id and /events/<slug> call sites resolve.
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const events = await listSheetEvents({});
    const event = events.find((candidate) => candidate.id === id || candidate.slug === id);
    if (!event) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    return event;
  });
}
