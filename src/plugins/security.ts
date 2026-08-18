import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import { AppConfig } from '../config/env.js';
import { CSRF_EXEMPT_PATHS } from '../config/routes.js';
import { DataError, createDataError } from '../errors/DataError.js';
import { v7 as uuidv7 } from 'uuid';

/** State-changing HTTP methods that require the CSRF header */
const CSRF_ENFORCED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/** Escape a config-supplied string before embedding it in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export async function registerPlugins(app: FastifyInstance, config: AppConfig) {
  // 1. Security Headers via Helmet
  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  // 2. CORS Configuration
  //
  // Strictness here is load-bearing, not hygiene. The CSRF hook skips
  // Bearer-authenticated requests on the grounds that a cross-site caller cannot
  // set an Authorization header without a preflight this allowlist rejects. A
  // permissive origin check would quietly invalidate that reasoning.
  /**
   * Normalises a configured entry to exactly what a browser puts in `Origin`:
   * scheme + host + optional port, never a trailing slash or path.
   *
   * This is not cosmetic. `CORS_ORIGIN` is hand-edited, and a value pasted from
   * a browser address bar arrives as "https://dash.vercel.app/" — with the
   * slash. A raw string compare against the browser's "https://dash.vercel.app"
   * then fails for every request from that site, and the symptom (all
   * cross-origin calls rejected) points nowhere near a stray character in an
   * env var.
   */
  const normalizeOrigin = (origin: string): string | null => {
    const trimmed = origin.trim();
    if (trimmed === '*') return '*'; // Allow wildcard explicitly
    try {
      return new URL(trimmed).origin;
    } catch {
      app.log.warn({ value: trimmed }, 'Ignoring unparseable CORS_ORIGIN entry');
      return null;
    }
  };

  const allowedOrigins = new Set(
    config.CORS_ORIGIN.split(',')
      .map(normalizeOrigin)
      .filter((o): o is string => o !== null),
  );

  // The API's own origin, so the Swagger UI this server hosts at /docs can call
  // it. Browsers send an Origin header on fetch even when it is same-origin, so
  // without this "Try it out" fails with a CORS rejection against the very
  // server serving the page.
  const ownOrigin = normalizeOrigin(config.APP_BASE_URL);
  if (ownOrigin) allowedOrigins.add(ownOrigin);

  const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

  // Vercel preview deploys for the admin dashboard, pinned to one project slug.
  // Never match a bare `.vercel.app` suffix: anyone can deploy there, and with
  // credentials:true that would hand the whole admin API to any attacker who
  // pushes a project. Previews are also barred in production — they point at
  // staging, and anyone on the Vercel team can create one.
  const previewOriginRe = config.CORS_VERCEL_PROJECT
    ? new RegExp(`^https://[a-z0-9-]+-${escapeRegExp(config.CORS_VERCEL_PROJECT)}\\.vercel\\.app$`)
    : null;

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header: same-origin, curl, native mobile, or app.inject().
      // Not a browser request, therefore not a CSRF vector.
      if (!origin) return cb(null, true);
      if (allowedOrigins.has('*')) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      if (config.NODE_ENV === 'development' && LOCALHOST_RE.test(origin)) return cb(null, true);
      if (config.NODE_ENV !== 'production' && previewOriginRe?.test(origin)) return cb(null, true);

      // A DataError, not a bare Error. A bare one falls through to the handler's
      // catch-all and is reported as 500 INTERNAL_ERROR — which says the server
      // broke when in fact it correctly refused an unlisted origin, and sends
      // anyone debugging it hunting for a crash that never happened.
      app.log.warn({ origin }, 'Rejected cross-origin request from unlisted origin');
      cb(createDataError('FORBIDDEN', `Origin ${origin} is not allowed.`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-csrf-token',
      'x-correlation-id',
      'x-auth-transport',
    ],
    exposedHeaders: ['x-correlation-id'],
    maxAge: 600,
  });

  // 3. Rate Limiting (Default 100 requests per minute)
  //
  // Keyed by user first, IP second. Keying on IP alone buckets every participant
  // behind campus NAT — or behind a single reverse proxy — into one shared 100/min
  // allowance, which takes the whole fest down rather than one abuser.
  // Requires `trustProxy` on the Fastify instance for req.ip to be the real client.
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.user?.id ?? request.ip,
    errorResponseBuilder: () => {
      return {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Rate limit exceeded. Please try again later.',
          statusCode: 429,
          retryable: true,
        },
      };
    },
  });

  // 4. Cookies
  await app.register(cookie, {
    secret: config.AUTH_SECRET,
    hook: 'onRequest',
  });

  // 5. Correlation ID Middleware & Request Logging
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || uuidv7();
    request.headers['x-correlation-id'] = correlationId;
    reply.header('x-correlation-id', correlationId);
  });

  app.setErrorHandler((error: any, request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || 'N/A';

    // Handle known DataError instances
    if (error instanceof DataError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          retryable: error.retryable,
          correlationId,
          details: error.details,
        },
      });
      return;
    }

    // Handle Fastify schema validation errors
    if (error.validation) {
      const validationError = createDataError(
        'VALIDATION_FAILED',
        'Request input schema validation failed',
        correlationId,
        { validation: error.validation }
      );
      reply.status(400).send({
        error: {
          code: validationError.code,
          message: validationError.message,
          statusCode: validationError.statusCode,
          retryable: validationError.retryable,
          correlationId,
          details: validationError.details,
        },
      });
      return;
    }

    // Handle standard Fastify HTTP errors (e.g. 415 Unsupported Media Type)
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: {
          code: 'BAD_REQUEST',
          message: error.message,
          statusCode: error.statusCode,
          retryable: false,
          correlationId,
        },
      });
      return;
    }

    // Log unhandled infrastructure / internal errors silently server-side
    app.log.error({ err: error, correlationId }, 'Unhandled server error');

    // Return safe public error response.
    //
    // The stack is deliberately withheld in production. It was previously sent
    // unconditionally, so a public 500 disclosed absolute server paths and the
    // internal module layout (e.g. /opt/render/project/src/dist/plugins/...) to
    // anyone who could trigger an error. The full stack is still logged above
    // against the same correlationId, which is where an operator should read it.
    const isProduction = config.NODE_ENV === 'production' || config.NODE_ENV === 'preproduction';
    const internalErr = createDataError('INTERNAL_ERROR', error?.message || 'An unexpected error occurred.', correlationId);
    reply.status(500).send({
      error: {
        code: internalErr.code,
        message: isProduction ? 'An unexpected error occurred.' : internalErr.message,
        statusCode: 500,
        retryable: false,
        correlationId,
        ...(isProduction ? {} : { details: error?.stack }),
      },
    });
  });
}

/**
 * CSRF Protection — Double-Submit Cookie Pattern.
 *
 * MUST be registered AFTER registerSessionHook(). Fastify runs `onRequest` hooks
 * in registration order, and this hook reads `request.authTransport`, which the
 * session hook sets. Registering it earlier (as it was originally, inside
 * registerPlugins) leaves that flag undefined and silently breaks the
 * Bearer-skip below — failing open in the "skip" direction is the dangerous way
 * round, so the ordering is load-bearing, not cosmetic.
 *
 * On state-changing requests (POST/PUT/PATCH/DELETE):
 *   - Read the `csrf_token` cookie (readable, NOT httpOnly — frontend JS sends it back)
 *   - Compare against the `x-csrf-token` request header (timing-safe)
 *   - Skip entirely for Bearer-authenticated requests (see below)
 *   - Skip for CSRF_EXEMPT_PATHS, where no session exists yet
 *
 * CSRF token issuance: the auth service sets the csrf_token cookie on login for
 * cookie-transport clients only. Bearer clients never receive one.
 */
export async function registerCsrfHook(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!CSRF_ENFORCED_METHODS.has(request.method)) return;
    if (CSRF_EXEMPT_PATHS.has(request.url.split('?')[0])) return;

    // Bearer-authenticated requests are not CSRF-able: browsers do not attach the
    // Authorization header automatically, and a cross-site caller cannot set it
    // without a preflight that the origin allowlist rejects. That argument depends
    // on CORS being strict — see the origin allowlist above; do not reintroduce a
    // permissive `origin: true` without revisiting this skip.
    //
    // Both conditions are checked deliberately. They are set together on a single
    // line in the session hook, only after the session row is verified, so a forged
    // or malformed Authorization header leaves BOTH unset and CSRF stays enforced.
    if (request.user && request.authTransport === 'bearer') return;

    const cookieToken = request.cookies[CSRF_COOKIE_NAME];
    const headerToken = request.headers[CSRF_HEADER_NAME] as string | undefined;

    if (!cookieToken || !headerToken) {
      throw createDataError('VALIDATION_FAILED', 'CSRF token missing.');
    }

    // Timing-safe comparison to prevent timing oracle attacks
    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);

    if (
      cookieBuf.length !== headerBuf.length ||
      !crypto.timingSafeEqual(cookieBuf, headerBuf)
    ) {
      throw createDataError('VALIDATION_FAILED', 'CSRF token mismatch.');
    }
  });
}
