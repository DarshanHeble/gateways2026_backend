import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { getAppDb } from '../db/index.js';
import { createCharacter, ensureDefaultCharacter, getCharacter, isPlayerNameTaken, updateCharacter } from '../repositories/characters.repository.js';

const CharacterSchema = z.object({
  playerName: z.string().min(3).max(16).regex(/^[A-Za-z0-9_]+$/),
  collegeId: z.string().min(1),
  departmentId: z.string().min(1),
  yearOfStudy: z.number().int().min(1).max(6),
  bio: z.string().max(5000).nullable().optional(),
});

export async function registerCharacterRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.get('/me', async (request) => {
    assertAuthenticated(request);
    return ensureDefaultCharacter(getAppDb(), request.user.id, request.user.email);
  });
  router.get('/availability', { schema: { querystring: z.object({ playerName: z.string().min(1), excludeUserId: z.string().optional() }) } }, async (request) => ({
    available: !(await isPlayerNameTaken(getAppDb(), request.query.playerName, request.query.excludeUserId)),
  }));
  router.post('/', { schema: { body: CharacterSchema } }, async (request, reply) => {
    assertAuthenticated(request);
    if (await getCharacter(getAppDb(), request.user.id)) return reply.status(409).send({ error: { code: 'VALIDATION_FAILED', message: 'Character already exists.' } });
    return reply.status(201).send(await createCharacter(getAppDb(), request.user.id, request.body));
  });
  router.patch('/me', { schema: { body: CharacterSchema.partial() } }, async (request) => {
    assertAuthenticated(request);
    return updateCharacter(getAppDb(), request.user.id, request.body);
  });
}
