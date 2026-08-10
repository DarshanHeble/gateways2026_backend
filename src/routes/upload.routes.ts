import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { storageService } from '../storage/cloudinary.storage.js';
import { z } from 'zod';

export const uploadRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/upload', {
    schema: {
      description: 'Upload a file to Cloudinary',
      tags: ['Uploads'],
      // Fastify swagger doesn't easily support multipart through JSON schema,
      // but we can document that it expects multipart/form-data.
      consumes: ['multipart/form-data'],
      body: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' }
        }
      } as any,
      response: {
        200: z.object({
          success: z.boolean(),
          url: z.string(),
        }),
        400: z.object({
          error: z.string(),
        }),
        500: z.object({
          error: z.string(),
        }),
      }
    },
    validatorCompiler: () => {
      return () => true;
    }
  }, async (request, reply) => {
    try {
      const data = await request.file();
      
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Convert stream to buffer
      const buffer = await data.toBuffer();

      // Upload the file to Cloudinary using the StorageService
      const fileUrl = await storageService.uploadFile(
        buffer,
        data.filename,
        data.mimetype
      );

      return {
        success: true,
        url: fileUrl,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to upload file' });
    }
  });
};
