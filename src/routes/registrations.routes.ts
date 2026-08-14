import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { getAppDb } from '../db/index.js';
import { listRegistrations, getRegistration } from '../repositories/registrations.repository.js';
import { cancelRegistration, registerParticipant } from '../services/registration.service.js';

const CreateRegistrationSchema = z.object({
  eventId: z.string().min(1),
  teamId: z.string().nullable().optional(),
});

function serialize(row: any) {
  const registration = row.registration ?? row;
  return {
    id: registration.id,
    code: registration.code,
    eventId: registration.eventId,
    participantId: registration.userId,
    userId: registration.userId,
    teamId: registration.teamId,
    status: String(registration.status).toLowerCase(),
    paymentStatus: String(registration.paymentStatus).toLowerCase(),
    source: registration.source,
    notes: registration.notes,
    overrideActorId: registration.overrideActorId,
    overrideReason: registration.overrideReason,
    registeredAt: new Date(registration.registeredAt).toISOString(),
    confirmedAt: registration.confirmedAt ? new Date(registration.confirmedAt).toISOString() : null,
    cancelledAt: registration.cancelledAt ? new Date(registration.cancelledAt).toISOString() : null,
    waitlistPosition: registration.waitlistPosition,
    eventTitle: row.eventTitle ?? null,
    eventSlug: row.eventSlug ?? null,
    participantEmail: row.participantEmail ?? null,
    participantName: row.participantName ?? null,
    participantCode: row.participantCode ?? null,
  };
}

export async function registerRegistrationRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.get('/', async (request) => {
    assertAuthenticated(request);
    const query = request.query as { eventId?: string; status?: string; search?: string };
    const rows = await listRegistrations(getAppDb(), {
      userId: request.user.id,
      eventId: query.eventId,
      status: query.status?.split(',').filter(Boolean),
      search: query.search,
    });
    return rows.map(serialize);
  });
  router.get('/me', async (request) => {
    assertAuthenticated(request);
    const rows = await listRegistrations(getAppDb(), { userId: request.user.id });
    return rows.map(serialize);
  });
  router.get('/:id', async (request, reply) => {
    assertAuthenticated(request);
    const row = await getRegistration(getAppDb(), (request.params as { id: string }).id);
    if (!row || row.registration.userId !== request.user.id) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Registration not found.' } });
    return serialize(row);
  });
  router.post('/', { schema: { body: CreateRegistrationSchema } }, async (request, reply) => {
    assertAuthenticated(request);
    const registration = await registerParticipant({ participantId: request.user.id, eventId: request.body.eventId, teamId: request.body.teamId ?? null });
    const row = await getRegistration(getAppDb(), registration.id);
    return reply.status(201).send(serialize(row));
  });
  router.delete('/:id', async (request, reply) => {
    assertAuthenticated(request);
    const row = await getRegistration(getAppDb(), (request.params as { id: string }).id);
    if (!row || row.registration.userId !== request.user.id) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Registration not found.' } });
    await cancelRegistration(row.registration.id, request.user.id, 'Cancelled by participant.');
    return reply.status(204).send();
  });
}
