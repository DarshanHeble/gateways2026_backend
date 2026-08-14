import { eq, inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { teams, teamMembers } from '../db/schema/teams.js';

type Db = MySql2Database<typeof schema>;

export async function listTeamsForUser(db: Db, userId: string) {
  const membership = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId));
  if (!membership.length) return [];
  return db.select().from(teams).where(inArray(teams.id, membership.map((row) => row.teamId)));
}

export async function getTeam(db: Db, teamId: string) {
  const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return rows[0] ?? null;
}

export async function getTeamByJoinCode(db: Db, joinCode: string) {
  const rows = await db.select().from(teams).where(eq(teams.joinCode, joinCode.trim().toUpperCase())).limit(1);
  return rows[0] ?? null;
}

export async function listTeamMembers(db: Db, teamId: string) {
  return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
}
