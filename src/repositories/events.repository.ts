import { and, eq, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { events, eventCategories, scheduleSlots } from '../db/schema/events.js';
import { registrations } from '../db/schema/registrations.js';

type Db = MySql2Database<typeof schema>;

export async function listEvents(
  db: Db,
  filters: { search?: string; status?: string; mode?: string } = {},
) {
  const rows = await db.select({ event: events, categorySlug: eventCategories.slug }).from(events).leftJoin(
    eventCategories,
    eq(events.categoryId, eventCategories.id),
  );
  const search = filters.search?.trim().toLowerCase();
  return rows.filter(({ event, categorySlug }) => {
    if (filters.status && event.status !== filters.status) return false;
    if (filters.mode && (filters.mode === 'team' ? !event.isTeamEvent : event.isTeamEvent)) return false;
    if (!search) return true;
    return [event.title, event.slug, event.description, event.venue, categorySlug]
      .some((value) => value?.toLowerCase().includes(search));
  });
}

export async function getEvent(db: Db, idOrSlug: string) {
  const rows = await db.select({ event: events, categorySlug: eventCategories.slug }).from(events).leftJoin(
    eventCategories,
    eq(events.categoryId, eventCategories.id),
  ).where(or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))).limit(1);
  return rows[0] ?? null;
}

export async function getEventStats(db: Db, eventId: string) {
  const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event[0]) return null;
  const rows = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId));
  const confirmedCount = rows.filter((row) => row.status === 'confirmed').length;
  const pendingCount = rows.filter((row) => row.status === 'pending').length;
  const waitlistCount = rows.filter((row) => row.status === 'waitlisted').length;
  const held = confirmedCount + pendingCount;
  return {
    eventId,
    confirmedCount,
    pendingCount,
    waitlistCount,
    capacity: event[0].capacity,
    seatsLeft: event[0].capacity == null ? null : Math.max(0, event[0].capacity - held),
  };
}

export async function listSchedule(db: Db) {
  return db.select().from(scheduleSlots);
}
