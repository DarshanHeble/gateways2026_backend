/**
 * RBAC — Role definitions and authorization guard helpers.
 *
 * UserRole enum defines all valid role values stored in `user_roles.role`.
 *
 * assertAuthenticated / assertAdmin / assertOrganizer:
 *   - Always re-derives roles from the database — never trusts a cached claim.
 *   - Called inside route preHandlers, NOT in the global session hook.
 *
 * NOTE: requireRole() / assertAdmin() require the `user_roles` table, which lives
 * in the identity schema (implemented in Phase 4). The stubs below are marked
 * accordingly — assertAuthenticated works immediately (uses request.user only).
 */

import type { FastifyRequest } from 'fastify';
import { createDataError } from '../errors/DataError.js';

// ─── Role Enum ────────────────────────────────────────────────────────────────

export const UserRole = {
  PARTICIPANT: 'PARTICIPANT',
  ORGANIZER: 'ORGANIZER',
  SCANNER: 'SCANNER',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// ─── assertAuthenticated ──────────────────────────────────────────────────────

/**
 * Throws NOT_AUTHENTICATED (401) if the session hook has not decorated
 * request.user. Call this at the top of any protected route handler.
 *
 * Safe to use immediately — requires only the auth schema.
 */
export function assertAuthenticated(request: FastifyRequest): asserts request is FastifyRequest & {
  user: NonNullable<FastifyRequest['user']>;
} {
  if (!request.user) {
    throw createDataError('NOT_AUTHENTICATED');
  }
}

// ─── assertAdmin ──────────────────────────────────────────────────────────────

/**
 * Throws FORBIDDEN (403) if the authenticated user does not hold the ADMIN role.
 *
 * ⏳ Phase 4 — Full DB-backed implementation requires identity schema (user_roles table).
 * Currently stubs to a safe denial to avoid accidental privilege escalation.
 * Replace the TODO body once identity.ts schema + user_roles repository are implemented.
 */
export async function assertAdmin(request: FastifyRequest): Promise<void> {
  assertAuthenticated(request);
  // TODO(Phase 4): query user_roles WHERE user_id = request.user.id AND role = 'ADMIN'
  // Until then, deny all admin access to prevent accidental privilege escalation.
  throw createDataError(
    'FORBIDDEN',
    'Admin role enforcement requires the identity schema (Phase 4). Not yet available.',
  );
}

// ─── assertOrganizer ──────────────────────────────────────────────────────────

/**
 * Throws FORBIDDEN (403) if the authenticated user is not an organizer for the given event.
 *
 * ⏳ Phase 4 — Requires event_organizers table (events schema).
 */
export async function assertOrganizer(
  request: FastifyRequest,
  _eventId: string,
): Promise<void> {
  assertAuthenticated(request);
  // TODO(Phase 4): query event_organizers WHERE event_id = _eventId AND user_id = request.user.id
  throw createDataError(
    'FORBIDDEN',
    'Organizer role enforcement requires the events schema (Phase 4). Not yet available.',
  );
}
