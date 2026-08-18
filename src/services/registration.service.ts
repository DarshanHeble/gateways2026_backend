import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { getAppDb, getWriterDb } from '../db/index.js';
import { withDeadlockRetry, withTransaction } from '../db/transaction.js';
import { createDataError } from '../errors/DataError.js';
import { events } from '../db/schema/events.js';
import { registrations } from '../db/schema/registrations.js';
import { teams, teamMembers } from '../db/schema/teams.js';
import { paymentReceipts } from '../db/schema/payments.js';
import { profiles } from '../db/schema/identity.js';
import { characters } from '../db/schema/characters.js';

type Db = ReturnType<typeof getAppDb>;

function registrationCode(): string {
  return `GWS26-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function teamJoinCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function hasVerifiedPass(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: paymentReceipts.id })
    .from(paymentReceipts)
    .where(and(eq(paymentReceipts.userId, userId), eq(paymentReceipts.status, 'verified')))
    .limit(1);
  return Boolean(rows[0]);
}

async function assertCompleteProfile(db: Db, userId: string): Promise<void> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const profile = rows[0];
  const characterRows = await db.select().from(characters).where(eq(characters.userId, userId)).limit(1);
  const character = characterRows[0];
  if (!profile || !profile.fullName?.trim() || !profile.phone || !profile.gender || !profile.dateOfBirth || !profile.category || !profile.tshirtSize || !profile.emergencyName || !profile.emergencyPhone || !profile.dietaryPref || !character?.collegeId || !character.departmentId || !character.yearOfStudy) {
    throw createDataError('VALIDATION_FAILED', 'Complete your participant profile before registering.');
  }
}

async function countHeld(db: Db, eventId: string): Promise<number> {
  const rows = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId));
  return rows.filter((row) => ['confirmed', 'pending'].includes(row.status)).length;
}

async function countConfirmed(db: Db, eventId: string, excludedTeamId?: string): Promise<number> {
  const rows = await db.select({ status: registrations.status, teamId: registrations.teamId })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  return rows.filter((row) => row.status === 'confirmed' && row.teamId !== excludedTeamId).length;
}

async function registerInTransaction(
  tx: Db,
  input: {
    participantId: string;
    eventId: string;
    teamId?: string | null;
    source?: string;
    overrideActorId?: string | null;
    overrideReason?: string | null;
  },
) {
  const eventRows = await tx.select().from(events).where(eq(events.id, input.eventId)).for('update').limit(1);
  const event = eventRows[0];
  if (!event) throw createDataError('NOT_FOUND', 'Event not found.');
  if (!['published', 'ongoing'].includes(event.status)) throw createDataError('REGISTRATION_CLOSED');
  const now = Date.now();
  if (event.registrationOpensAt && new Date(event.registrationOpensAt as any).getTime() > now) throw createDataError('REGISTRATION_CLOSED');
  if (event.registrationClosesAt && new Date(event.registrationClosesAt as any).getTime() < now) throw createDataError('REGISTRATION_CLOSED');

  const existing = await tx.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.eventId, input.eventId), eq(registrations.userId, input.participantId))).limit(1);
  if (existing[0]) throw createDataError('ALREADY_REGISTERED');

  let paymentStatus = 'verified';
  if (!input.overrideActorId) {
    const paid = await hasVerifiedPass(tx, input.participantId);
    if (!paid) throw createDataError('PAYMENT_NOT_VERIFIED');
  } else {
    paymentStatus = 'override';
  }

  if (event.isTeamEvent && !input.teamId) throw createDataError('VALIDATION_FAILED', 'Create or join a team before registering for this event.');
  if (input.teamId) {
    const teamRows = await tx.select().from(teams).where(and(eq(teams.id, input.teamId), eq(teams.eventId, input.eventId))).for('update').limit(1);
    const team = teamRows[0];
    if (!team) throw createDataError('NOT_FOUND', 'Team not found for this event.');
    if (team.isLocked) throw createDataError('TEAM_LOCKED', 'This team is locked.');
    const memberRows = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (!memberRows.some((member) => member.userId === input.participantId)) throw createDataError('FORBIDDEN', 'Join the team before registering.');
    const max = event.maxTeamSize ?? 1;
    if (memberRows.length > max) throw createDataError('TEAM_FULL');
  }

  const held = await countHeld(tx, input.eventId);
  let status: string;
  let teamMemberRows: Array<{ userId: string }> = [];

  if (event.isTeamEvent && input.teamId) {
    teamMemberRows = await tx.select({ userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, input.teamId));

    if (teamMemberRows.length < (event.minTeamSize ?? 1)) {
      // Incomplete teams are pending and do not consume event capacity.
      status = 'pending';
    } else {
      // A complete team is one atomic capacity allocation. Existing pending
      // rows from the same team are excluded from the capacity calculation so
      // the team can move from pending to confirmed together.
      const otherConfirmed = await countConfirmed(tx, input.eventId, input.teamId);
      const hasCapacity = event.capacity == null || otherConfirmed + teamMemberRows.length <= event.capacity;
      status = hasCapacity ? 'confirmed' : 'waitlisted';
    }
  } else {
    status = event.capacity != null && held >= event.capacity ? 'waitlisted' : 'confirmed';
  }

  const id = uuidv7();
  await tx.insert(registrations).values({
    id,
    code: registrationCode(),
    eventId: input.eventId,
    userId: input.participantId,
    teamId: input.teamId ?? null,
    status,
    paymentStatus,
    source: input.source ?? 'online',
    overrideActorId: input.overrideActorId ?? null,
    overrideReason: input.overrideReason ?? null,
    overrideAt: input.overrideActorId ? new Date() : null,
    confirmedAt: status === 'confirmed' ? new Date() : null,
    waitlistPosition: status === 'waitlisted' ? held + 1 : null,
  });

  if (event.isTeamEvent && input.teamId && teamMemberRows.length >= (event.minTeamSize ?? 1)) {
    const finalStatus = status as 'confirmed' | 'waitlisted';
    // The newly inserted row plus every existing row in the team move as a
    // group. This prevents the second member from becoming confirmed while the
    // leader remains pending, and prevents partial team waitlisting.
    await tx.update(registrations)
      .set({
        status: finalStatus,
        confirmedAt: finalStatus === 'confirmed' ? new Date() : null,
        waitlistPosition: finalStatus === 'waitlisted' ? Math.max(1, held + 1) : null,
      })
      .where(and(eq(registrations.eventId, input.eventId), eq(registrations.teamId, input.teamId)));
  }

  return (await tx.select().from(registrations).where(eq(registrations.id, id)).limit(1))[0];
}

export async function registerParticipant(input: {
  participantId: string;
  eventId: string;
  teamId?: string | null;
  source?: string;
  overrideActorId?: string | null;
  overrideReason?: string | null;
}) {
  const db = getAppDb();
  // An ADMIN payment override bypasses only the festival-pass gate. It must
  // never turn into a bypass of the participant profile requirements.
  await assertCompleteProfile(db, input.participantId);
  return withDeadlockRetry(() => withTransaction(db, (tx) => registerInTransaction(tx, input)));
}

export async function cancelRegistration(registrationId: string, _actorId?: string, note?: string) {
  const db = getWriterDb();
  return withDeadlockRetry(() => withTransaction(db, async (tx) => {
    const rows = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for('update').limit(1);
    const registration = rows[0];
    if (!registration) throw createDataError('NOT_FOUND', 'Registration not found.');
    if (registration.status === 'cancelled') return { cancelled: registration, promoted: null };

    // Team registrations consume seats as one atomic group. Cancelling one
    // member therefore cancels the team's registrations for this event, so a
    // team can never remain partially confirmed.
    const groupCondition = registration.teamId
      ? and(
          eq(registrations.eventId, registration.eventId),
          eq(registrations.teamId, registration.teamId),
          inArray(registrations.status, ['pending', 'confirmed', 'waitlisted', 'rejected']),
        )
      : eq(registrations.id, registrationId);
    await tx.update(registrations).set({ status: 'cancelled', cancelledAt: new Date(), notes: note ?? null }).where(groupCondition);

    const waiters = await tx.select().from(registrations)
      .where(and(eq(registrations.eventId, registration.eventId), eq(registrations.status, 'waitlisted')))
      .orderBy(asc(registrations.registeredAt))
      .limit(1);
    const candidate = waiters[0] ?? null;
    let promoted: (typeof waiters)[number] | null = candidate;
    if (candidate) {
      const eventRows = await tx.select().from(events).where(eq(events.id, registration.eventId)).limit(1);
      const event = eventRows[0];
      const confirmedRows = await tx.select({ id: registrations.id, teamId: registrations.teamId, status: registrations.status })
        .from(registrations)
        .where(and(eq(registrations.eventId, registration.eventId), eq(registrations.status, 'confirmed')));
      const group = candidate.teamId
        ? await tx.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.eventId, registration.eventId), eq(registrations.teamId, candidate.teamId), eq(registrations.status, 'waitlisted')))
        : [{ id: candidate.id }];
      const groupFits = event?.capacity == null || confirmedRows.length + group.length <= event.capacity;
      if (groupFits) {
        await tx.update(registrations).set({ status: 'confirmed', confirmedAt: new Date(), waitlistPosition: null })
          .where(and(eq(registrations.eventId, registration.eventId), candidate.teamId ? eq(registrations.teamId, candidate.teamId) : eq(registrations.id, candidate.id), eq(registrations.status, 'waitlisted')));
      } else {
        promoted = null;
      }
    }
    const cancelled = (await tx.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1))[0];
    const promotedRow = promoted ? (await tx.select().from(registrations).where(eq(registrations.id, promoted.id)).limit(1))[0] : null;
    return { cancelled, promoted: promotedRow };
  }));
}

export async function setRegistrationStatus(registrationId: string, status: string, note?: string) {
  if (status === 'cancelled') return cancelRegistration(registrationId, undefined, note);
  if (!['pending', 'confirmed', 'waitlisted', 'rejected'].includes(status)) throw createDataError('VALIDATION_FAILED', 'Unsupported registration status.');
  const db = getWriterDb();
  return withDeadlockRetry(() => withTransaction(db, async (tx) => {
    const rows = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for('update').limit(1);
    const registration = rows[0];
    if (!registration) throw createDataError('NOT_FOUND', 'Registration not found.');
    if (registration.status === 'cancelled') throw createDataError('VALIDATION_FAILED', 'A cancelled registration cannot be reopened.');

    // Organizer status changes use the same atomic group rule as online
    // registration. This prevents an operator action from splitting a team
    // across pending/confirmed/waitlisted states.
    const groupCondition = registration.teamId
      ? and(
          eq(registrations.eventId, registration.eventId),
          eq(registrations.teamId, registration.teamId),
          inArray(registrations.status, ['pending', 'confirmed', 'waitlisted', 'rejected']),
        )
      : eq(registrations.id, registrationId);
    const groupRows = registration.teamId
      ? await tx.select().from(registrations).where(groupCondition).for('update')
      : [registration];
    const existingPosition = groupRows.find((row) => row.waitlistPosition != null)?.waitlistPosition ?? 1;
    await tx.update(registrations).set({
      status,
      notes: note ?? null,
      confirmedAt: status === 'confirmed' ? new Date() : null,
      cancelledAt: null,
      waitlistPosition: status === 'waitlisted' ? existingPosition : null,
    }).where(groupCondition);
    return (await tx.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1))[0];
  }));
}

export async function createTeamWithLeader(input: { userId: string; eventId: string; name: string }) {
  const db = getAppDb();
  return withDeadlockRetry(() => withTransaction(db, async (tx) => {
    const eventRows = await tx.select().from(events).where(eq(events.id, input.eventId)).for('update').limit(1);
    const event = eventRows[0];
    if (!event) throw createDataError('NOT_FOUND', 'Event not found.');
    if (!event.isTeamEvent) throw createDataError('VALIDATION_FAILED', 'This event does not use teams.');
    await assertCompleteProfile(tx, input.userId);
    if (!(await hasVerifiedPass(tx, input.userId))) throw createDataError('PAYMENT_NOT_VERIFIED');
    const teamId = uuidv7();
    await tx.insert(teams).values({ id: teamId, eventId: input.eventId, name: input.name.trim(), joinCode: teamJoinCode(), leaderUserId: input.userId });
    await tx.insert(teamMembers).values({ teamId, userId: input.userId, role: 'leader' });
    const registration = await registerInTransaction(tx, { participantId: input.userId, eventId: input.eventId, teamId, source: 'online' });
    const team = (await tx.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0];
    return { team, registration };
  }));
}

export async function joinTeamWithMember(input: { userId: string; joinCode: string }) {
  const db = getAppDb();
  return withDeadlockRetry(() => withTransaction(db, async (tx) => {
    const teamRows = await tx.select().from(teams).where(eq(teams.joinCode, input.joinCode.trim().toUpperCase())).for('update').limit(1);
    const team = teamRows[0];
    if (!team) throw createDataError('INVALID_JOIN_CODE');
    if (team.isLocked) throw createDataError('TEAM_LOCKED');
    const eventRows = await tx.select().from(events).where(eq(events.id, team.eventId)).limit(1);
    const event = eventRows[0];
    if (!event) throw createDataError('NOT_FOUND', 'Event not found.');
    await assertCompleteProfile(tx, input.userId);
    if (!(await hasVerifiedPass(tx, input.userId))) throw createDataError('PAYMENT_NOT_VERIFIED');
    const members = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (members.some((member) => member.userId === input.userId)) return { team, registration: null };
    if (members.length >= (event.maxTeamSize ?? 1)) throw createDataError('TEAM_FULL');

    /*
      A team must come from one college AND one department.

      Compared against the LEADER rather than against every member: the leader
      created the team, so their pairing is the team's pairing, and checking one
      row keeps this a single lookup inside an already-locked transaction.
      `assertCompleteProfile` above guarantees both sides have a profile row.
    */
    const [joiner] = await tx
      .select({ collegeId: profiles.collegeId, departmentId: profiles.departmentId })
      .from(profiles)
      .where(eq(profiles.userId, input.userId))
      .limit(1);
    const [leader] = await tx
      .select({ collegeId: profiles.collegeId, departmentId: profiles.departmentId })
      .from(profiles)
      .where(eq(profiles.userId, team.leaderUserId))
      .limit(1);
    if (
      !joiner?.collegeId ||
      !joiner.departmentId ||
      joiner.collegeId !== leader?.collegeId ||
      joiner.departmentId !== leader?.departmentId
    ) {
      throw createDataError(
        'VALIDATION_FAILED',
        'You can only join a team from your own college and department.',
      );
    }
    await tx.insert(teamMembers).values({ teamId: team.id, userId: input.userId, role: 'member' });
    const registration = await registerInTransaction(tx, { participantId: input.userId, eventId: team.eventId, teamId: team.id, source: 'online' });
    return { team, registration };
  }));
}
