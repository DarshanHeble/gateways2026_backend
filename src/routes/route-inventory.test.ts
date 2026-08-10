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

  // Pre-existing, unversioned, and currently UNAUTHENTICATED — anyone can push a
  // file to our Cloudinary account. Listed here so it stays visible rather than
  // forgotten; see upload.routes.ts.
  '/upload',

  // Participant surface — website + mobile-user
  '/api/v1/auth/admin/roles/{userId}',
  '/api/v1/auth/callback/google',
  '/api/v1/auth/session',
  '/api/v1/auth/signin',
  '/api/v1/auth/signin/google',
  '/api/v1/auth/signout',
  '/api/v1/auth/signup',
  '/api/v1/auth/verify-email',
  '/api/v1/payment-receipts/',
  '/api/v1/payment-receipts/me',

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
