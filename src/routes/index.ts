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
        },
        { prefix: '/admin' },
      );
    },
    { prefix: API_V1_PREFIX },
  );
}
