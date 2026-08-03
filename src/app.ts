import Fastify from 'fastify';
import { z } from 'zod';
import { loadConfig } from './config/env.js';
import { registerPlugins } from './plugins/security.js';
import { registerSwagger } from './plugins/swagger.js';

export async function buildApp() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['headers.authorization', 'headers.cookie', 'body.password'],
    },
  });

  // Register Swagger UI documentation FIRST
  await registerSwagger(app, config);

  // Register security plugins
  await registerPlugins(app, config);

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
