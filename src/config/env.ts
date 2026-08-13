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

  // Individual DB connection variables
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),

  // Dual DB URLs (Optional if individual DB_* variables are provided)
  DATABASE_URL: z.string().optional(),
  WRITER_DATABASE_URL: z.string().optional(),

  // Security secrets
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters long'),
  CHECKIN_TOKEN_SECRET: z.string().min(32, 'CHECKIN_TOKEN_SECRET must be at least 32 characters long'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Storage / Mail optional
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_FROM: z.string().optional(),

  // Fallback SMTP config
  SMTP_FALLBACK_URL: z.string().optional(),
  SMTP_FALLBACK_HOST: z.string().optional(),
  SMTP_FALLBACK_PORT: z.coerce.number().optional(),
  SMTP_FALLBACK_USER: z.string().optional(),
  SMTP_FALLBACK_PASS: z.string().optional(),
  SMTP_FALLBACK_SECURE: z.coerce.boolean().optional(),
  SMTP_FALLBACK_FROM: z.string().optional(),

  STORAGE_BUCKET_URL: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),

  // Google Sheets Integration (Storage Strategy: Sheets is the live source of truth)
  GOOGLE_SERVICE_EMAIL: z.string().min(1, 'GOOGLE_SERVICE_EMAIL is required'),
  GOOGLE_PRIVATE_KEY: z.string().min(1, 'GOOGLE_PRIVATE_KEY is required'),
  SHEET_ID: z.string().min(1, 'SHEET_ID is required'),

  // Webhook shared secret — secures POST /api/webhook/sheet-update
  SHEET_WEBHOOK_SECRET: z.string().min(16, 'SHEET_WEBHOOK_SECRET must be at least 16 characters'),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Pre-process process.env to auto-construct DATABASE_URL if missing
  if (!process.env.DATABASE_URL && process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || '3306';
    const user = process.env.DB_USER;
    const pass = encodeURIComponent(process.env.DB_PASSWORD || '');
    const dbName = process.env.DB_NAME;
    process.env.DATABASE_URL = `mysql://${user}:${pass}@${host}:${port}/${dbName}`;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success || (!result.data.DATABASE_URL && !result.data.DB_HOST)) {
    console.error('❌ Invalid Environment Variables Configuration:');
    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    } else {
      console.error('Either DATABASE_URL or (DB_HOST, DB_USER, DB_NAME) must be provided.');
    }
    throw new Error('Process initialization failed due to invalid environment variables.');
  }

  cachedConfig = result.data;
  return cachedConfig;
}
