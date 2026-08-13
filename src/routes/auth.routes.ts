/**
 * Auth Routes
 *
 * Registered under prefix `/auth` in app.ts.
 * Every route uses Zod schemas for validation (via fastify-type-provider-zod).
 *
 * Endpoints:
 *   POST   /auth/signup               — manual registration (no session)
 *   POST   /auth/verify-email         — OTP verification → issues session
 *   POST   /auth/signin               — password login → issues session
 *   POST   /auth/signout              — revoke session + clear cookies  [auth required]
 *   GET    /auth/session              — return current user             [auth required]
 *   GET    /auth/signin/google        — redirect to Google OAuth
 *   GET    /auth/callback/google      — Google OAuth callback → issues session
 *   POST   /auth/admin/roles/:userId  — grant/revoke role               [auth + ADMIN]
 *
 * IDOR invariant: userId is ALWAYS derived from request.user (session-validated),
 * never from request body or query params.
 *
 * CSRF: /signup and /signin are exempt (no session yet).
 *       All other POST endpoints require X-CSRF-Token header (enforced in security.ts).
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getSession,
  handleGoogleCallback,
  initiateGoogleOAuth,
  signout,
  resolveRequestedTransport,
  signinWithPassword,
  signupWithPassword,
  verifyEmail,
} from '../services/auth.service.js';
import { assertAuthenticated } from '../plugins/jwt-auth.js';
import { assertAdmin } from '../security/roles.js';
import { createDataError } from '../errors/DataError.js';
import type { AppConfig } from '../config/env.js';
import {
  GoogleCallbackQuerySchema,
  GrantRoleBodySchema,
  GrantRoleResponseSchema,
  GoogleOAuthInitResponseSchema,
  SessionResponseSchema,
  SigninBodySchema,
  SigninResponseSchema,
  SignoutResponseSchema,
  SignupBodySchema,
  SignupResponseSchema,
  UserIdParamSchema,
  VerifyEmailBodySchema,
  VerifyEmailResponseSchema,
} from '../schemas/auth.schemas.js';

// ─── Shared Error Response Schema ─────────────────────────────────────────────

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

// ─── Route Registration ────────────────────────────────────────────────────────

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /auth/signup ──────────────────────────────────────────────────────
  router.post(
    '/signup',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Register a new account (manual / password)',
        description:
          'Creates a new user account. Sends a 6-digit OTP to the provided email. ' +
          'The user must call POST /auth/verify-email to complete registration and receive a session.',
        body: SignupBodySchema,
        response: {
          201: SignupResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await signupWithPassword(request.body);
      return reply.status(201).send(result);
    },
  );

  // ── POST /auth/verify-email ───────────────────────────────────────────────
  router.post(
    '/verify-email',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Verify email with OTP and receive session cookie',
        description:
          'Validates the 6-digit OTP sent during signup. On success, marks email as verified, ' +
          'issues an httpOnly __session cookie and a readable csrf_token cookie. ' +
          'The user is immediately logged in after this call.',
        body: VerifyEmailBodySchema,
        response: {
          200: VerifyEmailResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await verifyEmail(
        request.body,
        reply,
        config,
        resolveRequestedTransport(request),
      );
      return reply.send(result);
    },
  );

  // ── POST /auth/signin ──────────────────────────────────────────────────────
  router.post(
    '/signin',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Sign in with email and password',
        description:
          'Authenticates a user with email + password. On success, issues an httpOnly ' +
          '__session cookie (7-day sliding window) and a readable csrf_token cookie. ' +
          'Returns 401 on invalid credentials — user existence is never revealed.',
        body: SigninBodySchema,
        response: {
          200: SigninResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await signinWithPassword(
        request.body,
        reply,
        config,
        resolveRequestedTransport(request),
      );
      return reply.send(result);
    },
  );

  // ── POST /auth/signout ─────────────────────────────────────────────────────
  // CSRF protected (enforced globally in security.ts)
  router.post(
    '/signout',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Sign out and revoke session',
        description:
          'Revokes the current server-side session and clears all auth cookies. ' +
          'Requires a valid __session cookie. Idempotent — safe to call even if already signed out.',
        response: {
          200: SignoutResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await signout(request, reply);
      return reply.send({ message: 'Signed out successfully.' });
    },
  );

  // ── GET /auth/session ──────────────────────────────────────────────────────
  router.get(
    '/session',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Get current authenticated user',
        description:
          'Returns the user object for the currently authenticated session. ' +
          'Returns 401 if no valid session cookie is present.',
        response: {
          200: SessionResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = getSession(request);
      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          status: user.status,
          emailVerified: user.emailVerified
            ? (typeof user.emailVerified === 'string'
                ? user.emailVerified
                : (user.emailVerified as Date).toISOString())
            : null,
        },
      });
    },
  );

  // ── GET /auth/signin/google ────────────────────────────────────────────────
  router.get(
    '/signin/google',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Initiate Google OAuth sign-in',
        description:
          'Returns the Google OAuth authorization URL. The frontend should redirect the user to this URL.',
        response: {
          200: GoogleOAuthInitResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = initiateGoogleOAuth(config, reply);
      return reply.send(result);
    },
  );

  // ── GET /auth/callback/google ──────────────────────────────────────────────
  router.get(
    '/callback/google',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Google OAuth callback handler',
        description:
          'Receives the authorization code from Google, exchanges it for tokens, ' +
          'finds or creates the user account, and issues a session cookie. ' +
          'Google OAuth users are pre-verified — OTP is not required.',
        querystring: GoogleCallbackQuerySchema,
        response: {
          200: SigninResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { code, error, state } = request.query;

      if (error || !code) {
        throw {
          statusCode: 400,
          message: error ?? 'Google OAuth denied or missing authorization code.',
        };
      }

      const result = await handleGoogleCallback(code, request, reply, config, state);
      return reply.send(result);
    },
  );

  // ── POST /auth/admin/roles/:userId ────────────────────────────────────────
  // CSRF protected (enforced globally in security.ts)
  // ⏳ Phase 4: assertAdmin will be functional once identity schema is implemented.
  router.post(
    '/admin/roles/:userId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Grant or revoke a role for a user (Admin only)',
        description:
          'Assigns a role to a user. Requires ADMIN role. ' +
          'For event-scoped roles (ORGANIZER, SCANNER), provide eventScopeId. ' +
          'NOTE: Full DB-backed admin enforcement requires Phase 4 (identity schema).',
        params: UserIdParamSchema,
        body: GrantRoleBodySchema,
        response: {
          200: GrantRoleResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      assertAuthenticated(request);
      await assertAdmin(request);

      // Deliberately not implemented rather than silently doing nothing. This
      // previously returned 200 "Role granted." without writing a row, so an
      // admin would believe a role had been assigned when it had not.
      //
      // Role management is not in the confirmed dashboard scope, and the CLI
      // (`npm run role:grant -- --email <email> --role ADMIN`) already covers
      // bootstrap and day-to-day grants. Build this out when a UI actually needs
      // it — with guards against self-revoking ADMIN and removing the last one.
      throw createDataError(
        'INTERNAL_ERROR',
        'Role management over HTTP is not implemented. Use: npm run role:grant -- --email <email> --role <ROLE>',
      );
    },
  );
}
