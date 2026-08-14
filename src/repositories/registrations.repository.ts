import { eq, inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { registrations } from '../db/schema/registrations.js';
import { events } from '../db/schema/events.js';
import { users } from '../db/schema/auth.js';
import { profiles } from '../db/schema/identity.js';

type Db = MySql2Database<typeof schema>;

export async function getRegistration(db: Db, id: string) {
  const rows = await db
    .select({ registration: registrations, eventTitle: events.title, participantEmail: users.email, participantName: profiles.fullName })
    .from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .innerJoin(users, eq(registrations.userId, users.id))
    .leftJoin(profiles, eq(registrations.userId, profiles.userId))
    .where(eq(registrations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRegistrations(
  db: Db,
  filters: { userId?: string; eventId?: string; status?: string[]; search?: string } = {},
) {
  const rows = await db
    .select({ registration: registrations, eventTitle: events.title, eventSlug: events.slug, participantEmail: users.email, participantName: profiles.fullName, participantCode: profiles.participantCode })
    .from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .innerJoin(users, eq(registrations.userId, users.id))
    .leftJoin(profiles, eq(registrations.userId, profiles.userId));
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.userId && row.registration.userId !== filters.userId) return false;
    if (filters.eventId && row.registration.eventId !== filters.eventId) return false;
    if (filters.status?.length && !filters.status.includes(row.registration.status)) return false;
    if (search && ![row.registration.id, row.registration.code, row.eventTitle, row.participantEmail, row.participantName, row.participantCode].some((value) => value?.toLowerCase().includes(search))) return false;
    return true;
  });
}

export async function listRegistrationsForUsers(db: Db, userIds: string[]) {
  if (!userIds.length) return [];
  return db.select().from(registrations).where(inArray(registrations.userId, userIds));
}
