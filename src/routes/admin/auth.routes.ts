/**
 * Admin authentication — registered under `/api/v1/admin/auth`.
 *
 * A separate door from participant signin, checking the ADMIN role BEFORE any
 * session row is created. A non-admin who tries to log into the dashboard gets a
 * 403 and no credential at all, rather than a working token that mysteriously
 * bounces off every page.
 *
 * This is UX and defence in depth — NOT authorization. Every admin route still
 * calls assertAdmin, which re-derives the role from the writer DB on each
 * request, so revoking someone's ADMIN row locks them out immediately instead of
 * at token expiry. Do not "optimize" that away by trusting this login check.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import { assertAuthenticated } from '../../plugins/jwt-auth.js';
import { getUserRoles } from '../../repositories/user-roles.repository.js';
import { getAppDb } from '../../db/index.js';
import { createDataError } from '../../errors/DataError.js';
import { UserRole } from '../../security/roles.js';
import {
  issueSessionFor,
  resolveRequestedTransport,
  signout,
  verifyPasswordCredentials,
} from '../../services/auth.service.js';
import { SigninBodySchema, SigninResponseSchema } from '../../schemas/auth.schemas.js';

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number(),
    retryable: z.boolean(),
    correlationId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const AdminSessionResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    status: z.string(),
    emailVerified: z.string().nullable(),
  }),
  roles: z.array(z.string()),
});

export async function registerAdminAuthRoutes(app: FastifyInstance, config: AppConfig) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.post(
    '/signin',
    {
      // Admin credentials are the highest-value target in the system and there are
      // only a handful of legitimate holders, so this gets a tighter bucket than
      // the global 100/min.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Admin · Auth'],
        summary: 'Sign in to the admin dashboard (ADMIN role required)',
        description:
          'Verifies the ADMIN role before creating a session, so non-admins never ' +
          'receive a credential. Send `X-Auth-Transport: bearer` to receive a token ' +
          'in the response body instead of a cookie (required for cross-origin clients).',
        body: SigninBodySchema,
        response: {
          200: SigninResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const db = getAppDb();

      // Order matters. Verify credentials, THEN check the role, and only then
      // issue a session — so a non-admin with a correct password leaves no
      // session row behind. Verifying first also keeps "wrong password" and
      // "not an admin" indistinguishable to anyone probing for admin accounts.
      const user = await verifyPasswordCredentials(request.body);

      const roles = await getUserRoles(db, user.id);
      if (!roles.includes(UserRole.ADMIN)) {
        throw createDataError('FORBIDDEN', 'This account is not an administrator.');
      }

      const credentials = await issueSessionFor(
        user.id,
        reply,
        config,
        resolveRequestedTransport(request),
      );

      return reply.send({ user, ...(credentials ?? {}) });
    },
  );

  router.get(
    '/session',
    {
      schema: {
        tags: ['Admin · Auth'],
        summary: 'Current admin user and their roles',
        response: { 200: AdminSessionResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      const roles = await getUserRoles(getAppDb(), request.user.id);
      return {
        user: {
          id: request.user.id,
          email: request.user.email,
          status: request.user.status,
          emailVerified:
            request.user.emailVerified == null
              ? null
              : typeof request.user.emailVerified === 'string'
                ? request.user.emailVerified
                : request.user.emailVerified.toISOString(),
        },
        roles,
      };
    },
  );

  router.post(
    '/signout',
    {
      schema: {
        tags: ['Admin · Auth'],
        summary: 'Revoke the current admin session',
        response: { 200: z.object({ message: z.string() }), 401: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      await signout(request, reply);
      return reply.send({ message: 'Signed out.' });
    },
  );
}
