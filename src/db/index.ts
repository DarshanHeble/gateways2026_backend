import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { loadConfig } from '../config/env.js';
import * as schema from './schema/index.js';

let appDbInstance: MySql2Database<typeof schema> | null = null;
let writerDbInstance: MySql2Database<typeof schema> | null = null;

let appPool: mysql.Pool | null = null;
let writerPool: mysql.Pool | null = null;

export function getAppDb(): MySql2Database<typeof schema> {
  if (appDbInstance) {
    return appDbInstance;
  }

  const config = loadConfig();

  appPool = mysql.createPool({
    uri: config.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    timezone: '+00:00', // UTC
    dateStrings: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });

  appDbInstance = drizzle(appPool, { schema, mode: 'default' });
  return appDbInstance;
}

export function getWriterDb(): MySql2Database<typeof schema> {
  if (writerDbInstance) {
    return writerDbInstance;
  }

  const config = loadConfig();
  const writerUrl = config.WRITER_DATABASE_URL || config.DATABASE_URL;

  writerPool = mysql.createPool({
    uri: writerUrl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00', // UTC
    dateStrings: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });

  writerDbInstance = drizzle(writerPool, { schema, mode: 'default' });
  return writerDbInstance;
}

export async function closeDatabaseConnections(): Promise<void> {
  if (appPool) {
    await appPool.end();
    appPool = null;
    appDbInstance = null;
  }
  if (writerPool) {
    await writerPool.end();
    writerPool = null;
    writerDbInstance = null;
  }
}
