import type { FastifyInstance } from 'fastify';
import { getAppDb } from '../db/index.js';
import { listCategories, listColleges, listDepartments, listLevels, listSponsors } from '../repositories/reference.repository.js';

export async function registerReferenceRoutes(app: FastifyInstance) {
  app.get('/colleges', async () => listColleges(getAppDb()));
  app.get('/departments', async (request) => listDepartments(getAppDb(), (request.query as { collegeId?: string }).collegeId));
  app.get('/categories', async () => listCategories(getAppDb()));
  app.get('/levels', async () => listLevels(getAppDb()));
  app.get('/sponsors', async () => listSponsors(getAppDb()));
}
