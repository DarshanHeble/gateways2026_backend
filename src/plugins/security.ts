import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { AppConfig } from '../config/env.js';
import { DataError, createDataError } from '../errors/DataError.js';
import { v7 as uuidv7 } from 'uuid';

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

  // 6. Global Security Error Handler
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

    // Return safe public error response
    const internalErr = createDataError('INTERNAL_ERROR', error.message || 'An unexpected error occurred.', correlationId);
    reply.status(500).send({
      error: {
        code: internalErr.code,
        message: internalErr.message,
        statusCode: 500,
        retryable: false,
        correlationId,
        details: error.stack,
      },
    });
  });
}
