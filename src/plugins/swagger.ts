import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppConfig } from '../config/env.js';

export async function registerSwagger(app: FastifyInstance, config: AppConfig) {
  // 1. Configure Zod schema compiler and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // 2. Register OpenAPI Generator
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Gateways 2026 API Documentation',
        description: 'REST API backend for Gateways 2026 fest web portal and companion mobile app.',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${config.PORT}`,
          description: 'Local environment',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Provide your JWT authorization token',
          },
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'session',
            description: 'Session cookie authorization',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // 3. Register Swagger UI Interface
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });
}
