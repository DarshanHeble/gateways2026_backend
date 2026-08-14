import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { colleges, departments, levels, sponsors } from '../db/schema/reference.js';
import { eventCategories } from '../db/schema/events.js';

type Db = MySql2Database<typeof schema>;

export async function listColleges(db: Db) {
  return db.select().from(colleges).where(eq(colleges.active, true));
}

export async function listDepartments(db: Db, collegeId?: string) {
  const rows = await db.select().from(departments).where(eq(departments.active, true));
  return collegeId ? rows.filter((row) => row.collegeId === collegeId || row.collegeId === null) : rows;
}

export async function listCategories(db: Db) {
  return db.select().from(eventCategories);
}

export async function listLevels(db: Db) {
  return db.select().from(levels);
}

export async function listSponsors(db: Db) {
  return db.select().from(sponsors).where(eq(sponsors.active, true));
}
