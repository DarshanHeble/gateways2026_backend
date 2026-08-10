import Fastify from 'fastify';
import { z } from 'zod';
import { loadConfig } from './config/env.js';
import { registerCsrfHook, registerPlugins } from './plugins/security.js';
import { registerSwagger } from './plugins/swagger.js';
import fastifyMultipart from '@fastify/multipart';
import { uploadRoutes } from './routes/upload.routes.js';
import { registerSessionHook } from './plugins/jwt-auth.js';
import { registerV1Routes } from './routes/index.js';

export async function buildApp() {
  const config = loadConfig();

  const app = Fastify({
    // Render (and most PaaS) terminate TLS at a proxy, so without this every
    // request reports the proxy's IP — collapsing per-IP rate limiting into a
    // single global bucket and making request logs useless.
    trustProxy: true,
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['headers.authorization', 'headers.cookie', 'body.password'],
    },
  });

  // Register multipart plugin for file uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    }
  });

  // Register Swagger UI documentation FIRST
  await registerSwagger(app, config);

  // Register security plugins (CORS, Helmet, rate-limit, cookies, error handler)
  await registerPlugins(app, config);

  // Standalone upload endpoint, kept at the root outside /api/v1.
  await app.register(uploadRoutes);

  // Register global session validation hook (must be after the cookie plugin)
  await registerSessionHook(app);

  // CSRF must be registered AFTER the session hook: Fastify runs `onRequest`
  // hooks in registration order, and the CSRF hook reads `request.authTransport`,
  // which the session hook sets. Registered earlier, that flag is always
  // undefined — which breaks the Bearer skip in the fail-open direction.
  await registerCsrfHook(app);

  // All API routes, namespaced under /api/v1 and split by audience.
  await registerV1Routes(app, config);

  // Health check endpoint
  app.get('/health', {
    schema: {
      description: 'Check backend API health status',
      tags: ['Health System'],
      response: {
        200: z.object({
          status: z.string(),
          service: z.string(),
          timestamp: z.string(),
        }),
      },
    },
  }, async () => {
    return {
      status: 'ok',
      service: 'gateways2026_backend',
      timestamp: new Date().toISOString(),
    };
  });

  return { app, config };
}

async function start() {
  try {
    const { app, config } = await buildApp();
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`🚀 Server running on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
