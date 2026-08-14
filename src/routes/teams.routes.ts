import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { getAppDb } from '../db/index.js';
import { getTeam, getTeamByJoinCode, listTeamMembers, listTeamsForUser } from '../repositories/teams.repository.js';
import { createTeamWithLeader, joinTeamWithMember } from '../services/registration.service.js';

export async function registerTeamRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.get('/', async (request) => {
    assertAuthenticated(request);
    const rows = await listTeamsForUser(getAppDb(), request.user.id);
    return rows;
  });
  router.get('/by-code/:joinCode', async (request, reply) => {
    assertAuthenticated(request);
    const team = await getTeamByJoinCode(getAppDb(), (request.params as { joinCode: string }).joinCode);
    if (!team) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    return team;
  });
  router.get('/:id', async (request, reply) => {
    assertAuthenticated(request);
    const team = await getTeam(getAppDb(), (request.params as { id: string }).id);
    if (!team) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    const mine = await listTeamsForUser(getAppDb(), request.user.id);
    if (!mine.some((row) => row.id === team.id)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Team access denied.' } });
    return team;
  });
  router.get('/:id/members', async (request, reply) => {
    assertAuthenticated(request);
    const team = await getTeam(getAppDb(), (request.params as { id: string }).id);
    if (!team) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    const mine = await listTeamsForUser(getAppDb(), request.user.id);
    if (!mine.some((row) => row.id === team.id)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Team access denied.' } });
    return listTeamMembers(getAppDb(), team.id);
  });
  router.post('/', { schema: { body: z.object({ eventId: z.string().min(1), name: z.string().min(2).max(128) }) } }, async (request, reply) => {
    assertAuthenticated(request);
    return reply.status(201).send(await createTeamWithLeader({ userId: request.user.id, eventId: request.body.eventId, name: request.body.name }));
  });
  router.post('/join', { schema: { body: z.object({ joinCode: z.string().min(4).max(32) }) } }, async (request, reply) => {
    assertAuthenticated(request);
    return reply.status(201).send(await joinTeamWithMember({ userId: request.user.id, joinCode: request.body.joinCode }));
  });
}
