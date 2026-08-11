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
    // Every route declares its schema through the Zod type provider, so this
    // transform is total. It used to be wrapped in a try/catch that fell back to
    // the raw schema for POST /upload's hand-written JSON schema; with that route
    // gone, the catch would only ever swallow a genuine Zod transform failure and
    // emit silently-wrong docs. Errors here should be loud.
    transform: jsonSchemaTransform,
  });

  // 3. Register Swagger UI Interface
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      requestInterceptor: function (request: any) {
        // Automatically attach CSRF token from cookie to header for Swagger requests.
        //
        // This function is serialized and executed in the BROWSER, so `document`
        // exists at runtime. Reached via globalThis rather than adding "dom" to
        // tsconfig's lib, which would make `document`/`window` typecheck
        // everywhere in a Node server — turning a compile error into a 3am one.
        const cookie = (globalThis as { document?: { cookie: string } }).document?.cookie ?? '';
        const match = cookie.match(/(^|;)\s*csrf_token\s*=\s*([^;]+)/);
        if (match) {
          request.headers['x-csrf-token'] = match[2];
        }
        return request;
      },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });
}
