import { afterEach, describe, expect, it } from 'vitest';
import { getAppDb } from '../db/index.js';
import { createTestUser, deleteTestUser } from '../test-helpers/db.js';
import { awardXp } from './xp.service.js';
import { getTotalXpForUser } from '../repositories/xp.repository.js';

const db = getAppDb();
let cleanupUserId: string | null = null;

afterEach(async () => {
  if (cleanupUserId) {
    await deleteTestUser(db, cleanupUserId);
    cleanupUserId = null;
  }
});

describe('awardXp', () => {
  it('inserts a ledger row and the total reflects it', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await awardXp(db, {
      userId: user.id,
      amount: 10,
      reason: 'test award',
      sourceType: 'payment_verification',
      sourceId: 'receipt-1',
    });

    const total = await getTotalXpForUser(db, user.id);
    expect(total).toBe(10);
  });

  it('rejects a second award for the same (sourceType, sourceId, userId)', async () => {
    const user = await createTestUser(db);
    cleanupUserId = user.id;

    await awardXp(db, {
      userId: user.id,
      amount: 10,
      reason: 'test award',
      sourceType: 'payment_verification',
      sourceId: 'receipt-2',
    });

    await expect(
      awardXp(db, {
        userId: user.id,
        amount: 10,
        reason: 'test award',
        sourceType: 'payment_verification',
        sourceId: 'receipt-2',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
