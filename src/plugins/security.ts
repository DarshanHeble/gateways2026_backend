import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import { AppConfig } from '../config/env.js';
import { DataError, createDataError } from '../errors/DataError.js';
import { v7 as uuidv7 } from 'uuid';

/** CSRF-exempt routes (no session exists yet — Double-Submit is meaningless here) */
const CSRF_EXEMPT_PATHS = new Set(['/auth/signup', '/auth/verify-email', '/auth/signin', '/auth/callback/google']);
/** State-changing HTTP methods that require the CSRF header */
const CSRF_ENFORCED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';


export async function registerPlugins(app: FastifyInstance, config: AppConfig) {
  // 1. Security Headers via Helmet
  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  // 2. CORS Configuration
  const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || config.NODE_ENV === 'development') {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // 3. Rate Limiting (Default 100 requests per minute)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
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

  // 6. CSRF Protection — Double-Submit Cookie Pattern
  //
  // On state-changing requests (POST/PUT/PATCH/DELETE):
  //   - Read the `csrf_token` cookie (readable, NOT httpOnly — frontend JS must send it)
  //   - Compare against the `x-csrf-token` request header (timing-safe)
  //   - Exempt: /auth/signup, /auth/signin (no session exists yet), /auth/callback/google
  //
  // CSRF token issuance: auth service sets the csrf_token cookie on login/signup.
  // The frontend reads it and includes it as a header on subsequent mutating requests.
  app.addHook('onRequest', async (request, reply) => {
    if (!CSRF_ENFORCED_METHODS.has(request.method)) return;
    if (CSRF_EXEMPT_PATHS.has(request.url.split('?')[0])) return;


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

  app.setErrorHandler((error, request, reply) => {
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
    if ((error as any).validation) {
      const validationError = createDataError(
        'VALIDATION_FAILED',
        'Request input schema validation failed',
        correlationId,
        { validation: (error as any).validation }
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

    // Log unhandled infrastructure / internal errors silently server-side
    app.log.error({ err: error, correlationId }, 'Unhandled server error');

    // Return safe public error response
    const internalErr = createDataError('INTERNAL_ERROR', 'An unexpected error occurred.', correlationId);
    reply.status(500).send({
      error: {
        code: internalErr.code,
        message: internalErr.message,
        statusCode: 500,
        retryable: false,
        correlationId,
      },
    });
  });
}
