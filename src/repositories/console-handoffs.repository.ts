import crypto from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { consoleHandoffs } from '../db/schema/console.js';
import { withTransaction } from '../db/transaction.js';

type Db = MySql2Database<typeof schema>;

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function createHandoffCode(
  db: Db,
  params: { userId: string; returnTo: string; target?: string },
): Promise<string> {
  const rawCode = crypto.randomBytes(48).toString('base64url');
  return db
    .insert(consoleHandoffs)
    .values({
      id: crypto.randomUUID(),
      codeHash: hashCode(rawCode),
      userId: params.userId,
      target: params.target ?? 'registration-console',
      returnTo: params.returnTo,
      expiresAt: new Date(Date.now() + 90_000),
    })
    .then(() => rawCode);
}

export async function consumeHandoffCode(
  db: Db,
  rawCode: string,
  target = 'registration-console',
): Promise<schema.ConsoleHandoffRow | null> {
  return withTransaction(db, async (tx) => {
    const rows = await tx
      .select()
      .from(consoleHandoffs)
      .where(
        and(
          eq(consoleHandoffs.codeHash, hashCode(rawCode)),
          eq(consoleHandoffs.target, target),
          isNull(consoleHandoffs.consumedAt),
          gt(consoleHandoffs.expiresAt, new Date()),
        ),
      )
      .for('update')
      .limit(1);

    const handoff = rows[0];
    if (!handoff) return null;

    await tx
      .update(consoleHandoffs)
      .set({ consumedAt: new Date() })
      .where(eq(consoleHandoffs.id, handoff.id));

    return { ...handoff, consumedAt: new Date() };
  });
}

export async function purgeExpiredHandoffs(db: Db): Promise<void> {
  await db
    .delete(consoleHandoffs)
    .where(lt(consoleHandoffs.expiresAt, new Date()));
}
