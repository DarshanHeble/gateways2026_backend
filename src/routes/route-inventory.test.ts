import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

/**
 * Route inventory guard.
 *
 * Asserts the complete, exact set of paths the app exposes. Its job is to make
 * every routing change a deliberate, reviewable diff rather than a side effect:
 *
 *  - Catches prefix-composition mistakes when routes are nested under
 *    /api/v1 and /api/v1/admin (Fastify composes nested `register` prefixes
 *    cumulatively, which is easy to get subtly wrong).
 *  - Catches anyone later adding a route OUTSIDE the versioned namespace,
 *    which would strand it when v2 arrives.
 *  - Makes an accidentally-deleted or accidentally-exposed endpoint fail CI.
 *
 * When you intentionally add or move a route, update EXPECTED_PATHS in the same
 * commit. The diff on this array is the audit trail for the API surface.
 *
 * `/health` and `/docs` intentionally live at the root, unversioned:
 * load-balancer probes and doc links should not move when the API version does.
 * (`/docs` is served by swagger-ui rather than declared as a route, so it does
 * not appear in the OpenAPI paths object.)
 */
const EXPECTED_PATHS = [
  // Unversioned by design
  '/health',

  // Participant surface — website + mobile-user
  '/api/v1/auth/admin/roles/{userId}',
  '/api/v1/auth/callback/google',
  '/api/v1/auth/change-password',
  '/api/v1/auth/console-handoff',
  '/api/v1/auth/console-handoff/exchange',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/session',
  '/api/v1/auth/signin',
  '/api/v1/auth/signin/google',
  '/api/v1/auth/signout',
  '/api/v1/auth/signup',
  '/api/v1/auth/resend-verification',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/website-handoff',
  '/api/v1/auth/website-handoff/exchange',
  '/api/v1/payment-receipts/',
  '/api/v1/payment-receipts/config',
  '/api/v1/payment-receipts/me',
  '/api/v1/profiles/me',
  '/api/v1/characters/',
  '/api/v1/characters/availability',
  '/api/v1/characters/me',
  '/api/v1/events/',
  '/api/v1/events/schedule',
  '/api/v1/events/{id}',
  '/api/v1/events/{id}/stats',
  '/api/v1/registrations/',
  '/api/v1/registrations/me',
  '/api/v1/registrations/{id}',
  '/api/v1/teams/',
  '/api/v1/teams/by-code/{joinCode}',
  '/api/v1/teams/join',
  '/api/v1/teams/{id}',
  '/api/v1/teams/{id}/members',
  '/api/v1/reference/categories',
  '/api/v1/reference/colleges',
  '/api/v1/reference/departments',
  '/api/v1/reference/levels',
  '/api/v1/reference/sponsors',

  // Admin surface — dashboard + mobile-admin. Every one of these calls
  // assertAdmin in its handler; the prefix is organisational, not a guard.
  '/api/v1/admin/auth/session',
  '/api/v1/admin/auth/signin',
  '/api/v1/admin/auth/signout',
  '/api/v1/admin/payments/',
  '/api/v1/admin/payments/bulk-review',
  '/api/v1/admin/payments/{id}',
  '/api/v1/admin/payments/{id}/receipt-url',
  '/api/v1/admin/payments/{id}/review',
  '/api/v1/admin/overview',
  '/api/v1/admin/events',
  '/api/v1/admin/participants',
  '/api/v1/admin/participants/{id}',
  '/api/v1/admin/participants/{id}/erase',
  '/api/v1/admin/registrations',
  '/api/v1/admin/registrations/{id}',
  '/api/v1/admin/registrations/{id}/payment-override',
  '/api/v1/admin/registrations/{id}/status',
  '/api/v1/admin/teams',
  '/api/v1/admin/teams/{id}',
  '/api/v1/admin/teams/{id}/members',
  '/api/v1/admin/staff',
  '/api/v1/admin/staff/{id}/assignments',
  '/api/v1/admin/staff/{id}/assignments/{assignmentId}',
  '/api/v1/admin/audit',

  // Existing non-versioned integration surface.
  '/api/events',
  '/api/webhook/sheet-update',
];

describe('route inventory', () => {
  it('exposes exactly the expected set of paths', async () => {
    const { app } = await buildApp();
    await app.ready();

    const actual = Object.keys(app.swagger().paths ?? {}).sort();

    expect(actual).toEqual([...EXPECTED_PATHS].sort());

    await app.close();
  });
});
