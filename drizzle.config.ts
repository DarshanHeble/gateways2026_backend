import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import path from 'path';

import fs from 'fs';

// Determine environment file based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = `.env.${nodeEnv}`;
const envPath = path.resolve(process.cwd(), envFile);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

// Auto-construct connection URL if individual DB credentials exist
let dbUrl = process.env.WRITER_DATABASE_URL || process.env.DATABASE_URL || '';

if (!dbUrl && process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER;
  const pass = encodeURIComponent(process.env.DB_PASSWORD || '');
  const dbName = process.env.DB_NAME;
  dbUrl = `mysql://${user}:${pass}@${host}:${port}/${dbName}`;
}

// ⚠️ See the warning comment atop src/db/schema/index.ts before running
// `generate` or `push` — this schema barrel doesn't yet cover every table
// in the existing database, and diffing against it can propose destructive
// DROP TABLE statements for other contributors' tables.
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'mysql',
  dbCredentials: {
    url: dbUrl,
  },
  strict: true,
  verbose: true,
});
