import type { FastifyInstance } from 'fastify';
import { getAppDb } from '../db/index.js';
import { getEvent, getEventStats, listEvents, listSchedule } from '../repositories/events.repository.js';

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

export async function registerCoreEventRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = request.query as { search?: string; status?: string; mode?: string };
    const rows = await listEvents(getAppDb(), query);
    return rows.map(serialize);
  });
  app.get('/schedule', async () => {
    const rows = await listSchedule(getAppDb());
    return rows.map((row) => ({ ...row, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) }));
  });
  app.get('/:id/stats', async (request, reply) => {
    const stats = await getEventStats(getAppDb(), (request.params as { id: string }).id);
    if (!stats) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    return stats;
  });
  app.get('/:id', async (request, reply) => {
    const row = await getEvent(getAppDb(), (request.params as { id: string }).id);
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    return serialize(row);
  });
}
