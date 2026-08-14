/**
 * Route registration — the one place every endpoint enters the application.
 *
 * The API is split by AUDIENCE, not by client platform:
 *
 *   /api/v1/*         participant surface  (website + mobile-user)
 *   /api/v1/admin/*   admin surface        (admin dashboard + mobile-admin)
 *
 * Platform is deliberately not the dividing line: the mobile app serves both
 * admins and participants, so a per-platform split would have to duplicate both
 * surfaces anyway. Splitting by audience keeps one implementation of every
 * business rule, with authorization — not a separate codebase — as the boundary.
 *
 * Fastify composes nested `register` prefixes cumulatively, so a route declared
 * as `/:id/review` inside the admin payments plugin resolves to
 * `/api/v1/admin/payments/:id/review`. `src/routes/route-inventory.test.ts`
 * asserts the full resulting path list so a composition mistake fails CI rather
 * than shipping a silently-moved endpoint.
 */

import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { API_V1_PREFIX } from '../config/routes.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerPaymentReceiptRoutes } from './payment-receipts.routes.js';
import { registerAdminAuthRoutes } from './admin/auth.routes.js';
import { registerAdminPaymentRoutes } from './admin/payments.routes.js';
import { registerProfileRoutes } from './profiles.routes.js';
import { registerCharacterRoutes } from './characters.routes.js';
import { registerCoreEventRoutes } from './core-events.routes.js';
import { registerRegistrationRoutes } from './registrations.routes.js';
import { registerTeamRoutes } from './teams.routes.js';
import { registerReferenceRoutes } from './reference.routes.js';
import { registerAdminCoreRoutes } from './admin/core.routes.js';

export async function registerV1Routes(app: FastifyInstance, config: AppConfig) {
  await app.register(
    async (v1) => {
      // ── Participant surface ────────────────────────────────────────────────
      await v1.register(
        async (authApp) => {
          await registerAuthRoutes(authApp, config);
        },
        { prefix: '/auth' },
      );

      await v1.register(
        async (paymentsApp) => {
          await registerPaymentReceiptRoutes(paymentsApp);
        },
        { prefix: '/payment-receipts' },
      );

      await v1.register(async (profilesApp) => registerProfileRoutes(profilesApp), { prefix: '/profiles' });
      await v1.register(async (charactersApp) => registerCharacterRoutes(charactersApp), { prefix: '/characters' });
      await v1.register(async (eventsApp) => registerCoreEventRoutes(eventsApp), { prefix: '/events' });
      await v1.register(async (registrationsApp) => registerRegistrationRoutes(registrationsApp), { prefix: '/registrations' });
      await v1.register(async (teamsApp) => registerTeamRoutes(teamsApp), { prefix: '/teams' });
      await v1.register(async (referenceApp) => registerReferenceRoutes(referenceApp), { prefix: '/reference' });

      // ── Admin surface ──────────────────────────────────────────────────────
      // Every route registered below MUST call assertAdmin in its handler. The
      // prefix is organisational, not a guard — Fastify has no notion of an
      // "admin subtree", so authorization stays explicit per route.
      await v1.register(
        async (admin) => {
          await admin.register(
            async (adminAuth) => {
              await registerAdminAuthRoutes(adminAuth, config);
            },
            { prefix: '/auth' },
          );

          await admin.register(
            async (adminPayments) => {
              await registerAdminPaymentRoutes(adminPayments, config);
            },
            { prefix: '/payments' },
          );

          await admin.register(
            async (adminCore) => {
              await registerAdminCoreRoutes(adminCore, config);
            },
            { prefix: '' },
          );
        },
        { prefix: '/admin' },
      );
    },
    { prefix: API_V1_PREFIX },
  );
}
