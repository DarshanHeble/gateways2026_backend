import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { getAppDb } from '../db/index.js';
import { getProfile, updateProfile } from '../repositories/profiles.repository.js';

const ProfilePatchSchema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  phone: z.string().min(7).max(32).optional(),
  collegeId: z.string().max(36).nullable().optional(),
  departmentId: z.string().max(36).nullable().optional(),
  yearOfStudy: z.number().int().min(1).max(6).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  category: z.enum(['participant', 'delegate', 'accompanist', 'faculty', 'volunteer', 'guest']).nullable().optional(),
  tshirtSize: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL']).nullable().optional(),
  emergencyName: z.string().max(255).nullable().optional(),
  emergencyPhone: z.string().max(32).nullable().optional(),
  dietaryPref: z.enum(['veg', 'non_veg', 'vegan', 'jain']).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
});

function serialize(value: any) {
  return value ? {
    ...value,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  } : null;
}

export async function registerProfileRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get('/me', async (request) => {
    assertAuthenticated(request);
    return serialize(await getProfile(getAppDb(), request.user.id));
  });

  router.patch('/me', { schema: { body: ProfilePatchSchema } }, async (request) => {
    assertAuthenticated(request);
    const profile = await updateProfile(getAppDb(), request.user.id, request.body);
    return serialize(profile);
  });
}
