import { MySql2Database } from 'drizzle-orm/mysql2';
import { DataError, createDataError } from '../errors/DataError.js';
import * as schema from './schema/index.js';

export async function withTransaction<T>(
  db: MySql2Database<typeof schema>,
  callback: (tx: MySql2Database<typeof schema>) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    try {
      return await callback(tx as MySql2Database<typeof schema>);
    } catch (err: any) {
      if (err instanceof DataError) {
        throw err;
      }
      // Convert database driver errors to DataError
      throw mapDatabaseError(err);
    }
  });
}

export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialBackoffMs: number = 50
): Promise<T> {
  let attempt = 0;
  let backoff = initialBackoffMs;

  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isDeadlockOrTimeout =
        err?.code === 'ER_LOCK_DEADLOCK' ||
        err?.errno === 1213 ||
        err?.code === 'ER_LOCK_WAIT_TIMEOUT' ||
        err?.errno === 1205;

      if (isDeadlockOrTimeout && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 20);
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
        backoff *= 2;
        continue;
      }

      throw err;
    }
  }

  throw createDataError('INTERNAL_ERROR', 'Transaction failed after maximum deadlock retries.');
}

export function mapDatabaseError(err: any): DataError {
  if (err instanceof DataError) {
    return err;
  }

  const code = err?.code || '';
  const errno = err?.errno || 0;

  // Duplicate key entry (1062)
  if (code === 'ER_DUP_ENTRY' || errno === 1062) {
    const msg = String(err?.message || '');
    if (msg.includes('email')) return createDataError('EMAIL_TAKEN');
    if (msg.includes('player_name')) return createDataError('PLAYER_NAME_TAKEN');
    if (msg.includes('event_user_reg_idx')) return createDataError('ALREADY_REGISTERED');
    if (msg.includes('user_achievement_idx')) return createDataError('VALIDATION_FAILED', 'Achievement already granted.');
    if (msg.includes('source_idempotency_idx')) return createDataError('VALIDATION_FAILED', 'XP award already processed.');
    if (msg.includes('attendance_event_user_idx')) return createDataError('VALIDATION_FAILED', 'Attendance already recorded.');
    if (msg.includes('payment_receipts_user_id_unique')) return createDataError('RECEIPT_ALREADY_SUBMITTED');
    return createDataError('VALIDATION_FAILED', 'Duplicate resource conflict.');
  }

  // Foreign key violation (1452)
  if (code === 'ER_NO_REFERENCED_ROW_2' || errno === 1452) {
    return createDataError('NOT_FOUND', 'Referenced parent record does not exist.');
  }

  return createDataError('INTERNAL_ERROR', 'A database transaction error occurred.');
}
