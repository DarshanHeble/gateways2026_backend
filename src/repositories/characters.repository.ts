import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { characters } from '../db/schema/characters.js';

type Db = MySql2Database<typeof schema>;

export async function getCharacter(db: Db, userId: string) {
  const rows = await db.select().from(characters).where(eq(characters.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Generate a stable, readable fallback name for accounts that predate the
 * username field or arrive through Google OAuth. The user id suffix makes the
 * generated name unique without needing a second naming table.
 */
export function defaultCharacterName(seed: string | undefined, userId: string): string {
  const base = (seed ?? 'Player')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 30) || 'Player';
  return `${base}_${userId.replace(/-/g, '')}`.slice(0, 64);
}

/**
 * Ensure every authenticated account has a character row. New manual signups
 * supply their exact username; OAuth and legacy accounts use a deterministic
 * fallback and keep the same default avatar/XP state.
 */
export async function ensureDefaultCharacter(db: Db, userId: string, seed?: string) {
  const existing = await getCharacter(db, userId);
  if (existing) return existing;

  try {
    await db.insert(characters).values({
      userId,
      playerName: defaultCharacterName(seed, userId),
      totalXp: 0,
      avatarAssetId: 'prospector',
    });
  } catch (error) {
    // Two tabs can request `/characters/me` at the same time. If one won the
    // insert, return its row; otherwise preserve the original database error.
    const afterRace = await getCharacter(db, userId);
    if (afterRace) return afterRace;
    throw error;
  }

  return getCharacter(db, userId);
}

export async function isPlayerNameTaken(db: Db, playerName: string, excludeUserId?: string) {
  const rows = await db
    .select({ userId: characters.userId })
    .from(characters)
    .where(eq(sql`LOWER(${characters.playerName})`, playerName.trim().toLowerCase()))
    .limit(2);
  return rows.some((row) => row.userId !== excludeUserId);
}

export async function createCharacter(
  db: Db,
  userId: string,
  input: { playerName: string; collegeId: string; departmentId: string; yearOfStudy: number; bio?: string | null },
) {
  await db.insert(characters).values({
    userId,
    playerName: input.playerName.trim(),
    collegeId: input.collegeId,
    departmentId: input.departmentId,
    yearOfStudy: input.yearOfStudy,
    bio: input.bio ?? null,
  });
  return getCharacter(db, userId);
}

export async function updateCharacter(db: Db, userId: string, patch: Partial<typeof characters.$inferInsert>) {
  const allowed = {
    ...(patch.playerName === undefined ? {} : { playerName: patch.playerName }),
    ...(patch.collegeId === undefined ? {} : { collegeId: patch.collegeId }),
    ...(patch.departmentId === undefined ? {} : { departmentId: patch.departmentId }),
    ...(patch.yearOfStudy === undefined ? {} : { yearOfStudy: patch.yearOfStudy }),
    ...(patch.bio === undefined ? {} : { bio: patch.bio }),
  };
  if (Object.keys(allowed).length) await db.update(characters).set(allowed).where(eq(characters.userId, userId));
  return getCharacter(db, userId);
}
