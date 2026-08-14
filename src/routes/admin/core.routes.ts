import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppConfig } from '../../config/env.js';
import { getAppDb, getWriterDb } from '../../db/index.js';
import { users } from '../../db/schema/auth.js';
import { profiles } from '../../db/schema/identity.js';
import { userRoles } from '../../db/schema/identity.js';
import { events } from '../../db/schema/events.js';
import { paymentReceipts } from '../../db/schema/payments.js';
import { registrations } from '../../db/schema/registrations.js';
import { teams, teamMembers } from '../../db/schema/teams.js';
import { createDataError } from '../../errors/DataError.js';
import { assertAdmin, assertEventAccess, assertStaff, accessibleEventIds, UserRole } from '../../security/roles.js';
import { hashPassword } from '../../security/password.js';
import { assertAuthenticated } from '../../plugins/jwt-auth.js';
import { insertAuditLogEntry } from '../../repositories/audit-log.repository.js';
import { getUserRoleAssignments } from '../../repositories/user-roles.repository.js';
import { listEvents } from '../../repositories/events.repository.js';
import { listProfiles, getProfile, updateProfile } from '../../repositories/profiles.repository.js';
import { getRegistration, listRegistrations } from '../../repositories/registrations.repository.js';
import { getTeam, listTeamMembers } from '../../repositories/teams.repository.js';
import { withTransaction } from '../../db/transaction.js';
import { cancelRegistration, registerParticipant, setRegistrationStatus } from '../../services/registration.service.js';

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number(),
    retryable: z.boolean(),
    correlationId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const ScopeQuery = z.object({ eventId: z.string().optional() });
const RegistrationStatus = z.enum(['pending', 'confirmed', 'waitlisted', 'cancelled', 'rejected']);
const StaffRole = z.enum(['ADMIN', 'ORGANIZER', 'SCANNER']);
const AssignmentBody = z.object({ role: StaffRole, eventId: z.string().nullable().optional() });
const StaffCreateBody = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().max(255),
  phone: z.string().min(7).max(32),
  temporaryPassword: z.string().min(8).max(72),
  assignments: z.array(AssignmentBody).min(1),
});
const ProfilePatchBody = z.object({
  fullName: z.string().min(2).max(255).optional(),
  phone: z.string().min(7).max(32).optional(),
  collegeId: z.string().max(36).nullable().optional(),
  departmentId: z.string().max(36).nullable().optional(),
  yearOfStudy: z.number().int().min(1).max(6).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  category: z.enum(['participant', 'delegate', 'accompanist', 'faculty', 'volunteer', 'guest']).nullable().optional(),
  tshirtSize: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL']).nullable().optional(),
  emergencyName: z.string().max(255).nullable().optional(),
  emergencyPhone: z.string().max(32).nullable().optional(),
  dietaryPref: z.enum(['veg', 'non_veg', 'vegan', 'jain']).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
});

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

function serializeEvent(row: any) {
  const event = row.event ?? row;
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: iso(event.startsAt),
    endsAt: iso(event.endsAt),
    capacity: event.capacity,
    isTeamEvent: Boolean(event.isTeamEvent),
    minTeamSize: event.minTeamSize ?? 1,
    maxTeamSize: event.maxTeamSize ?? 1,
    status: String(event.status).toLowerCase(),
    paymentRequired: Boolean(event.paymentRequired),
    feeAmount: event.feeAmount ?? 0,
    xpReward: event.xpReward ?? 0,
    categoryId: event.categoryId,
    categorySlug: row.categorySlug ?? null,
  };
}

function serializeRegistration(row: any) {
  const registration = row.registration ?? row;
  return {
    id: registration.id,
    code: registration.code,
    eventId: registration.eventId,
    eventTitle: row.eventTitle ?? null,
    eventSlug: row.eventSlug ?? null,
    participantId: registration.userId,
    participantName: row.participantName ?? null,
    participantEmail: row.participantEmail ?? null,
    participantCode: row.participantCode ?? null,
    teamId: registration.teamId,
    status: String(registration.status).toLowerCase(),
    paymentStatus: String(registration.paymentStatus).toLowerCase(),
    source: registration.source,
    notes: registration.notes,
    overrideActorId: registration.overrideActorId,
    overrideReason: registration.overrideReason,
    overrideAt: iso(registration.overrideAt),
    registeredAt: iso(registration.registeredAt),
    confirmedAt: iso(registration.confirmedAt),
    cancelledAt: iso(registration.cancelledAt),
    waitlistPosition: registration.waitlistPosition,
  };
}

function serializeProfile(profile: any, receipt?: any) {
  if (!profile) return null;
  return {
    ...profile,
    userId: profile.id,
    createdAt: iso(profile.createdAt),
    updatedAt: iso(profile.updatedAt),
    payment: receipt
      ? {
          id: receipt.id,
          amountInr: receipt.amountInr,
          method: receipt.paymentMethod,
          transactionReference: receipt.transactionReference,
          status: receipt.status,
          submittedAt: iso(receipt.submittedAt),
          reviewedAt: iso(receipt.reviewedAt),
          reviewedBy: receipt.reviewedBy,
          rejectionReason: receipt.rejectionReason,
        }
      : null,
  };
}

async function resolveScope(request: any, eventId?: string) {
  const context = await assertStaff(request);
  const ids = await accessibleEventIds(context, eventId);
  if (eventId) {
    const rows = await getAppDb().select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!rows[0]) throw createDataError('NOT_FOUND', 'Event not found.');
  }
  return { context, ids };
}

function filterEventRows<T extends { event: { id: string } }>(rows: T[], ids: string[] | null): T[] {
  return ids ? rows.filter((row) => ids.includes(row.event.id)) : rows;
}

/**
 * A scanner must be able to find a paid participant who has not yet been
 * registered for the selected event. Organizers remain limited to participants
 * already associated with their event, and a dual-assigned operator gets the
 * organizer view for an event where both assignments exist.
 */
function scannerMaySearchPaidParticipants(
  context: Awaited<ReturnType<typeof assertStaff>>,
  eventId?: string,
): boolean {
  if (context.isAdmin || !context.scannerEventIds.length) return false;
  if (eventId) {
    return context.scannerEventIds.includes(eventId) && !context.organizerEventIds.includes(eventId);
  }
  return context.organizerEventIds.length === 0;
}

async function scopedRegistrations(ids: string[] | null, search?: string) {
  const rows = await listRegistrations(getAppDb(), { search });
  return ids ? rows.filter((row) => ids.includes(row.registration.eventId)) : rows;
}

async function validateAssignments(assignments: Array<{ role: string; eventId?: string | null }>) {
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const eventId = assignment.eventId ?? null;
    if (assignment.role === UserRole.ADMIN && eventId) {
      throw createDataError('VALIDATION_FAILED', 'ADMIN assignments are global and cannot have an event scope.');
    }
    if (assignment.role !== UserRole.ADMIN && !eventId) {
      throw createDataError('VALIDATION_FAILED', `${assignment.role} assignments require an event.`);
    }
    const key = `${assignment.role}:${eventId ?? 'global'}`;
    if (seen.has(key)) throw createDataError('VALIDATION_FAILED', 'Duplicate staff assignment.');
    seen.add(key);
    if (eventId) {
      const event = await getAppDb().select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
      if (!event[0]) throw createDataError('NOT_FOUND', 'Assigned event does not exist.');
    }
  }
}

export async function registerAdminCoreRoutes(app: FastifyInstance, config: AppConfig) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get('/overview', { schema: { querystring: ScopeQuery, response: { 200: z.record(z.string(), z.unknown()), 401: ErrorResponseSchema, 403: ErrorResponseSchema } } }, async (request) => {
    const { ids } = await resolveScope(request, request.query.eventId);
    const rows = await scopedRegistrations(ids);
    const participantIds = new Set(rows.map((row) => row.registration.userId));
    const receipts = await getAppDb().select().from(paymentReceipts);
    const relevantReceipts = ids === null
      ? receipts
      : receipts.filter((receipt) => participantIds.has(receipt.userId));
    const eventRows = filterEventRows(await listEvents(getAppDb()), ids);
    const capacity = eventRows.some((row) => row.event.capacity == null)
      ? null
      : eventRows.reduce((total, row) => total + (row.event.capacity ?? 0), 0);
    // Pending rows are incomplete team registrations and deliberately do not
    // consume capacity. Capacity and seats-left therefore count confirmed
    // participants only; the pending KPI remains visible separately.
    const filledSeats = rows.filter((row) => row.registration.status === 'confirmed').length;
    return {
      totalParticipants: participantIds.size,
      totalRegistrations: rows.length,
      confirmedRegistrations: rows.filter((row) => row.registration.status === 'confirmed').length,
      pendingRegistrations: rows.filter((row) => row.registration.status === 'pending').length,
      waitlistedRegistrations: rows.filter((row) => row.registration.status === 'waitlisted').length,
      cancelledRegistrations: rows.filter((row) => row.registration.status === 'cancelled').length,
      pendingPayments: relevantReceipts.filter((receipt) => receipt.status === 'pending').length,
      verifiedPayments: relevantReceipts.filter((receipt) => receipt.status === 'verified').length,
      verifiedRevenueInr: relevantReceipts.filter((receipt) => receipt.status === 'verified').reduce((sum, receipt) => sum + (receipt.amountInr ?? 0), 0),
      entryPassAmountInr: config.ENTRY_PASS_AMOUNT_INR,
      capacity,
      filledSeats,
      eventCount: eventRows.length,
      refreshedAt: new Date().toISOString(),
    };
  });

  router.get('/events', { schema: { querystring: ScopeQuery } }, async (request) => {
    const { ids } = await resolveScope(request, request.query.eventId);
    return filterEventRows(await listEvents(getAppDb()), ids).map(serializeEvent);
  });

  router.get('/participants', { schema: { querystring: ScopeQuery.extend({ search: z.string().optional() }) } }, async (request) => {
    const { context, ids } = await resolveScope(request, request.query.eventId);
    const registrations = await scopedRegistrations(ids, request.query.search);
    const participantIds = ids === null ? undefined : new Set(registrations.map((row) => row.registration.userId));
    const profilesRows = await listProfiles(getAppDb(), request.query.search);
    const receipts = await getAppDb().select().from(paymentReceipts);
    const paidParticipantIds = new Set(
      receipts.filter((receipt) => receipt.status === 'verified').map((receipt) => receipt.userId),
    );
    const allowedParticipantIds = scannerMaySearchPaidParticipants(context, request.query.eventId)
      ? paidParticipantIds
      : participantIds;
    return profilesRows
      .filter((profile) => !allowedParticipantIds || allowedParticipantIds.has(profile.id))
      .map((profile) => serializeProfile(profile, receipts.find((receipt) => receipt.userId === profile.id)));
  });

  router.get('/participants/:id', { schema: { querystring: ScopeQuery } }, async (request, reply) => {
    const { context, ids } = await resolveScope(request, request.query.eventId);
    const participantId = (request.params as { id: string }).id;
    const profile = await getProfile(getAppDb(), participantId);
    if (!profile) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Participant not found.' } });
    const rows = await listRegistrations(getAppDb(), { userId: participantId });
    const receipt = (await getAppDb().select().from(paymentReceipts).where(eq(paymentReceipts.userId, participantId)).limit(1))[0];
    const isInScope = !ids || rows.some((row) => ids.includes(row.registration.eventId));
    const scannerCanOpenPaidProfile = scannerMaySearchPaidParticipants(context, request.query.eventId) && receipt?.status === 'verified';
    if (!isInScope && !scannerCanOpenPaidProfile) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Participant is outside this event scope.' } });
    }
    return { participant: serializeProfile(profile, receipt), registrations: (ids ? rows.filter((row) => ids.includes(row.registration.eventId)) : rows).map(serializeRegistration) };
  });

  router.patch('/participants/:id', { schema: { querystring: ScopeQuery, body: ProfilePatchBody } }, async (request) => {
    const { context, ids } = await resolveScope(request, request.query.eventId);
    const participantId = (request.params as { id: string }).id;
    if (!context.isAdmin) {
      if (!request.query.eventId) throw createDataError('VALIDATION_FAILED', 'eventId is required for event-scoped participant edits.');
      await assertEventAccess(request, request.query.eventId, 'ORGANIZER');
      const rows = await listRegistrations(getAppDb(), { userId: participantId, eventId: request.query.eventId });
      if (!rows.length) throw createDataError('FORBIDDEN', 'Participant is not registered for this event.');
    }
    const profile = await updateProfile(getAppDb(), participantId, request.body);
    if (!profile) throw createDataError('NOT_FOUND', 'Participant not found.');
    return serializeProfile(profile);
  });

  router.get('/registrations', { schema: { querystring: ScopeQuery.extend({ search: z.string().optional(), status: z.string().optional() }) } }, async (request) => {
    const { ids } = await resolveScope(request, request.query.eventId);
    const rows = await scopedRegistrations(ids, request.query.search);
    return rows
      .filter((row) => !request.query.status || request.query.status.split(',').includes(row.registration.status))
      .map(serializeRegistration);
  });

  router.get('/registrations/:id', async (request, reply) => {
    const registrationId = (request.params as { id: string }).id;
    const row = await getRegistration(getAppDb(), registrationId);
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Registration not found.' } });
    await assertEventAccess(request, row.registration.eventId, 'SCANNER');
    return serializeRegistration(row);
  });

  router.post('/registrations', { schema: { body: z.object({ participantId: z.string().min(1), eventId: z.string().min(1), teamId: z.string().nullable().optional(), source: z.string().max(32).optional(), paymentOverrideReason: z.string().trim().min(3).max(1000).optional() }) } }, async (request, reply) => {
    assertAuthenticated(request);
    await assertEventAccess(request, request.body.eventId, 'SCANNER');
    if (request.body.paymentOverrideReason) await assertAdmin(request);
    const registration = await registerParticipant({
      participantId: request.body.participantId,
      eventId: request.body.eventId,
      teamId: request.body.teamId ?? null,
      source: request.body.source ?? 'desk',
      overrideActorId: request.body.paymentOverrideReason ? request.user.id : null,
      overrideReason: request.body.paymentOverrideReason ?? null,
    });
    if (request.body.paymentOverrideReason) {
      await insertAuditLogEntry(getWriterDb(), {
        actorUserId: request.user.id,
        action: 'registration_payment_override',
        targetType: 'registration',
        targetId: registration.id,
        metadata: { reason: request.body.paymentOverrideReason },
      });
    }
    const row = await getRegistration(getAppDb(), registration.id);
    return reply.status(201).send(serializeRegistration(row));
  });

  router.patch('/registrations/:id/status', { schema: { body: z.object({ status: RegistrationStatus, note: z.string().max(2000).optional() }) } }, async (request) => {
    assertAuthenticated(request);
    const registrationId = (request.params as { id: string }).id;
    const existing = await getRegistration(getAppDb(), registrationId);
    if (!existing) throw createDataError('NOT_FOUND', 'Registration not found.');
    await assertEventAccess(request, existing.registration.eventId, 'ORGANIZER');
    if (request.body.status === 'cancelled') await cancelRegistration(existing.registration.id, request.user.id, request.body.note);
    else await setRegistrationStatus(existing.registration.id, request.body.status, request.body.note);
    const updated = await getRegistration(getAppDb(), existing.registration.id);
    return serializeRegistration(updated);
  });

  router.post('/registrations/:id/payment-override', { schema: { body: z.object({ reason: z.string().trim().min(3).max(1000) }) } }, async (request) => {
    assertAuthenticated(request);
    await assertAdmin(request);
    const registrationId = (request.params as { id: string }).id;
    const existing = await getRegistration(getAppDb(), registrationId);
    if (!existing) throw createDataError('NOT_FOUND', 'Registration not found.');
    const db = getWriterDb();
    await withTransaction(db, async (tx) => {
      await tx.update(registrations).set({ paymentStatus: 'override', overrideActorId: request.user.id, overrideReason: request.body.reason, overrideAt: new Date() }).where(eq(registrations.id, registrationId));
      await insertAuditLogEntry(tx, { actorUserId: request.user.id, action: 'registration_payment_override', targetType: 'registration', targetId: registrationId, metadata: { reason: request.body.reason } });
    });
    return serializeRegistration(await getRegistration(getAppDb(), registrationId));
  });

  router.get('/teams', { schema: { querystring: ScopeQuery } }, async (request) => {
    const { ids } = await resolveScope(request, request.query.eventId);
    const rows = await getAppDb().select({ team: teams, eventTitle: events.title }).from(teams).innerJoin(events, eq(teams.eventId, events.id));
    const scoped = ids ? rows.filter((row) => ids.includes(row.team.eventId)) : rows;
    const memberRows = await getAppDb().select().from(teamMembers);
    return scoped.map((row) => ({
      ...row.team,
      eventTitle: row.eventTitle,
      memberIds: memberRows.filter((member) => member.teamId === row.team.id).map((member) => member.userId),
      memberCount: memberRows.filter((member) => member.teamId === row.team.id).length,
    }));
  });

  router.get('/teams/:id', async (request, reply) => {
    const teamId = (request.params as { id: string }).id;
    const team = await getTeam(getAppDb(), teamId);
    if (!team) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    await assertEventAccess(request, team.eventId, 'SCANNER');
    const members = await listTeamMembers(getAppDb(), team.id);
    return { ...team, memberIds: members.map((member: any) => member.userId) };
  });

  router.get('/teams/:id/members', async (request, reply) => {
    const teamId = (request.params as { id: string }).id;
    const team = await getTeam(getAppDb(), teamId);
    if (!team) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    await assertEventAccess(request, team.eventId, 'SCANNER');
    return listTeamMembers(getAppDb(), team.id);
  });

  router.patch('/teams/:id', { schema: { body: z.object({ isLocked: z.boolean() }) } }, async (request) => {
    assertAuthenticated(request);
    const teamId = (request.params as { id: string }).id;
    const team = await getTeam(getAppDb(), teamId);
    if (!team) throw createDataError('NOT_FOUND', 'Team not found.');
    await assertEventAccess(request, team.eventId, 'ORGANIZER');
    const db = getWriterDb();
    await db.update(teams).set({ isLocked: request.body.isLocked }).where(eq(teams.id, teamId));
    await insertAuditLogEntry(db, {
      actorUserId: request.user.id,
      action: request.body.isLocked ? 'team_roster_locked' : 'team_roster_unlocked',
      targetType: 'team',
      targetId: teamId,
      metadata: { eventId: team.eventId },
    });
    const updated = await getTeam(getAppDb(), teamId);
    return { ...updated, memberIds: (await listTeamMembers(getAppDb(), teamId)).map((member: any) => member.userId) };
  });

  router.get('/staff', async (request) => {
    await assertAdmin(request);
    const rows = await getAppDb().select({ user: users, profile: profiles, assignment: userRoles }).from(userRoles).innerJoin(users, eq(userRoles.userId, users.id)).leftJoin(profiles, eq(profiles.userId, users.id));
    const byUser = new Map<string, any>();
    for (const row of rows) {
      const existing = byUser.get(row.user.id) ?? { id: row.user.id, email: row.user.email, name: row.profile?.fullName ?? row.user.email, phone: row.profile?.phone ?? null, mustChangePassword: row.user.mustChangePassword, emailVerified: iso(row.user.emailVerified), assignments: [] };
      existing.assignments.push({ id: row.assignment.id, role: row.assignment.role, eventId: row.assignment.eventScopeId, grantedAt: iso(row.assignment.grantedAt), grantedBy: row.assignment.grantedBy });
      byUser.set(row.user.id, existing);
    }
    return [...byUser.values()];
  });

  router.post('/staff', { schema: { body: StaffCreateBody } }, async (request, reply) => {
    assertAuthenticated(request);
    await assertAdmin(request);
    await validateAssignments(request.body.assignments);
    const db = getWriterDb();
    const userId = uuidv7();
    const passwordHash = await hashPassword(request.body.temporaryPassword);
    await withTransaction(db, async (tx) => {
      await tx.insert(users).values({ id: userId, email: request.body.email.trim().toLowerCase(), passwordHash, status: 'ACTIVE', emailVerified: new Date(), mustChangePassword: true });
      await tx.insert(profiles).values({ userId, participantCode: `GWS26-${userId.slice(0, 8).toUpperCase()}`, fullName: request.body.name.trim(), phone: request.body.phone });
      await tx.insert(userRoles).values(request.body.assignments.map((assignment) => ({ id: uuidv7(), userId, role: assignment.role, eventScopeId: assignment.eventId ?? null, grantedBy: request.user.id })));
    });
    await insertAuditLogEntry(db, { actorUserId: request.user.id, action: 'staff_account_created', targetType: 'user', targetId: userId, metadata: { assignments: request.body.assignments.map((assignment) => ({ role: assignment.role, eventId: assignment.eventId ?? null })) } });
    return reply.status(201).send({ id: userId, email: request.body.email.trim().toLowerCase(), mustChangePassword: true });
  });

  router.post('/staff/:id/assignments', { schema: { body: AssignmentBody } }, async (request) => {
    assertAuthenticated(request);
    await assertAdmin(request);
    await validateAssignments([request.body]);
    const staffId = (request.params as { id: string }).id;
    const db = getWriterDb();
    const target = await db.select({ id: users.id }).from(users).where(eq(users.id, staffId)).limit(1);
    if (!target[0]) throw createDataError('NOT_FOUND', 'Staff account not found.');
    const duplicate = await db.select({ id: userRoles.id }).from(userRoles).where(and(
      eq(userRoles.userId, staffId),
      eq(userRoles.role, request.body.role),
      request.body.eventId ? eq(userRoles.eventScopeId, request.body.eventId) : undefined,
    )).limit(1);
    if (duplicate[0]) throw createDataError('VALIDATION_FAILED', 'That staff assignment already exists.');
    await db.insert(userRoles).values({ id: uuidv7(), userId: staffId, role: request.body.role, eventScopeId: request.body.eventId ?? null, grantedBy: request.user.id });
    await insertAuditLogEntry(db, { actorUserId: request.user.id, action: 'staff_assignment_granted', targetType: 'user', targetId: staffId, metadata: { role: request.body.role, eventId: request.body.eventId ?? null } });
    return { message: 'Assignment granted.' };
  });

  router.delete('/staff/:id/assignments/:assignmentId', async (request) => {
    assertAuthenticated(request);
    await assertAdmin(request);
    const db = getWriterDb();
    const params = request.params as { id: string; assignmentId: string };
    const row = (await db.select().from(userRoles).where(and(eq(userRoles.id, params.assignmentId), eq(userRoles.userId, params.id))).limit(1))[0];
    if (!row) throw createDataError('NOT_FOUND', 'Assignment not found.');
    if (row.role === UserRole.ADMIN) {
      if (params.id === request.user.id) throw createDataError('FORBIDDEN', 'Use another administrator to change your ADMIN assignment.');
      const admins = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, UserRole.ADMIN));
      if (new Set(admins.map((admin) => admin.userId)).size <= 1) throw createDataError('FORBIDDEN', 'The last ADMIN account cannot be removed.');
    }
    await db.delete(userRoles).where(eq(userRoles.id, row.id));
    await insertAuditLogEntry(db, { actorUserId: request.user.id, action: 'staff_assignment_revoked', targetType: 'user', targetId: params.id, metadata: { role: row.role, eventId: row.eventScopeId } });
    return { message: 'Assignment revoked.' };
  });
}
