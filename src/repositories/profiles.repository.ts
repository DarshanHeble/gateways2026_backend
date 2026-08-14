import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { profiles } from '../db/schema/identity.js';
import { users } from '../db/schema/auth.js';

type Db = MySql2Database<typeof schema>;

export interface ProfileWithEmail {
  id: string;
  email: string;
  participantCode: string | null;
  fullName: string;
  phone: string | null;
  collegeId: string | null;
  departmentId: string | null;
  yearOfStudy: number | null;
  gender: string | null;
  dateOfBirth: string | null;
  category: string | null;
  tshirtSize: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  dietaryPref: string | null;
  isBanned: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export async function getProfile(db: Db, userId: string): Promise<ProfileWithEmail | null> {
  const rows = await db
    .select({ profile: profiles, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(eq(profiles.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.profile.userId, email: row.email, ...row.profile };
}

export async function updateProfile(
  db: Db,
  userId: string,
  patch: Partial<typeof profiles.$inferInsert>,
): Promise<ProfileWithEmail | null> {
  const allowed = {
    ...(patch.fullName === undefined ? {} : { fullName: patch.fullName }),
    ...(patch.phone === undefined ? {} : { phone: patch.phone }),
    ...(patch.collegeId === undefined ? {} : { collegeId: patch.collegeId }),
    ...(patch.departmentId === undefined ? {} : { departmentId: patch.departmentId }),
    ...(patch.yearOfStudy === undefined ? {} : { yearOfStudy: patch.yearOfStudy }),
    ...(patch.gender === undefined ? {} : { gender: patch.gender }),
    ...(patch.dateOfBirth === undefined ? {} : { dateOfBirth: patch.dateOfBirth }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
    ...(patch.tshirtSize === undefined ? {} : { tshirtSize: patch.tshirtSize }),
    ...(patch.emergencyName === undefined ? {} : { emergencyName: patch.emergencyName }),
    ...(patch.emergencyPhone === undefined ? {} : { emergencyPhone: patch.emergencyPhone }),
    ...(patch.dietaryPref === undefined ? {} : { dietaryPref: patch.dietaryPref }),
    ...(patch.bio === undefined ? {} : { bio: patch.bio }),
  };
  if (Object.keys(allowed).length) {
    await db.update(profiles).set(allowed).where(eq(profiles.userId, userId));
  }
  return getProfile(db, userId);
}

export async function listProfiles(db: Db, search?: string): Promise<ProfileWithEmail[]> {
  const rows = await db
    .select({ profile: profiles, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id));
  const needle = search?.trim().toLowerCase();
  return rows
    .map((row) => ({ id: row.profile.userId, email: row.email, ...row.profile }))
    .filter((row) => !needle || [row.email, row.fullName, row.phone, row.participantCode].some((v) => v?.toLowerCase().includes(needle)));
}
