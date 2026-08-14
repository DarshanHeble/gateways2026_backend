import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

/**
 * HTTP-layer test for the per-route bodyLimit fix on POST /payment-receipts.
 *
 * Fastify's default bodyLimit (1 MiB) would reject a realistically-sized
 * base64-encoded PDF before the Zod schema or submitReceipt() ever runs
 * (FST_ERR_CTP_BODY_TOO_LARGE, 413). The route now sets `bodyLimit: 8_000_000`
 * so payloads up to that size are accepted at the HTTP layer.
 *
 * This test builds a request body well above 1 MiB (but under 8MB) and
 * confirms it is NOT rejected with 413. It has no session cookie, so it's
 * expected to fail with 401 (NOT_AUTHENTICATED) once it clears the body-limit
 * and CSRF layers — that's the point: it proves the body itself isn't the
 * blocker.
 */
describe('POST /payment-receipts — bodyLimit', () => {
  it('accepts a body larger than the default 1 MiB limit (does not 413)', async () => {
    const { app } = await buildApp();

    // ~2MB of base64 payload — comfortably above Fastify's default 1 MiB
    // bodyLimit, comfortably under the route's 8_000_000 byte override.
    const bigBase64 = 'A'.repeat(2_000_000);

    // CSRF double-submit cookie pattern: matching cookie + header lets the
    // request past the CSRF hook so it reaches the route handler, where
    // assertAuthenticated() throws 401 for lack of a session — proving the
    // request was NOT rejected at the body-limit layer.
    const csrfToken = 'test-csrf-token';

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payment-receipts',
      cookies: {
        csrf_token: csrfToken,
      },
      headers: {
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: {
        fileData: `data:application/pdf;base64,${bigBase64}`,
        fileName: 'receipt.pdf',
        fileSizeBytes: 2_000_000,
        paymentMethod: 'upi',
        transactionReference: 'TEST-BODY-LIMIT-001',
      },
    });

    expect(response.statusCode).not.toBe(413);
    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
