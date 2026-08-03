import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

import fs from 'fs';

// Determine environment file based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = `.env.${nodeEnv}`;
const envPath = path.resolve(process.cwd(), envFile);

// Load specific environment file if it exists, otherwise fall back to .env
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production', 'preproduction']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),

  // Dual DB URLs (WRITER_DATABASE_URL falls back to DATABASE_URL if omitted)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  WRITER_DATABASE_URL: z.string().optional(),

  // Security secrets
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters long'),
  CHECKIN_TOKEN_SECRET: z.string().min(32, 'CHECKIN_TOKEN_SECRET must be at least 32 characters long'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Storage / Mail optional
  SMTP_URL: z.string().optional(),
  STORAGE_BUCKET_URL: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid Environment Variables Configuration:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Process initialization failed due to invalid environment variables.');
  }

  cachedConfig = result.data;
  return cachedConfig;
}
