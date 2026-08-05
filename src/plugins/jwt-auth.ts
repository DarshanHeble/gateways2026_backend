/**
 * Session Auth Plugin — Global onRequest Hook
 *
 * Validates the `__session` httpOnly cookie on every request:
 *   1. Reads + unsigns the session cookie using @fastify/cookie's built-in signing.
 *   2. SHA-256 hashes the raw token to look up the session in DB.
 *   3. If valid & not expired: decorates `request.user` + slides the session expiry.
 *   4. If missing/invalid/expired: does nothing — routes that require auth
 *      must call assertAuthenticated() to enforce protection.
 *
 * This plugin also exports:
 *   - assertAuthenticated(request) — throws NOT_AUTHENTICATED if no user is set
 *   - SESSION_COOKIE_NAME — the canonical cookie name used everywhere
 *
 * IDOR invariant: request.user is ONLY set from a DB-verified session row.
 * Client-supplied userId values are never trusted.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAppDb } from '../db/index.js';
import { createDataError } from '../errors/DataError.js';
import { hashSessionToken } from '../security/jwt.js';
import {
  deleteExpiredSessions,
  findSessionByHashedToken,
  touchSession,
} from '../repositories/auth.repository.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: string;
  emailVerified: Date | string | null;
}

// Augment FastifyRequest so TypeScript knows about request.user everywhere
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    /** Raw (unsigned) session token — stored only during this request lifecycle */
    _rawSessionToken?: string;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = '__session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Slide expiry only if the session is within the last day of its window
// to avoid a DB write on every single request
const SLIDE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

// ─── Plugin Registration ──────────────────────────────────────────────────────

export async function registerSessionHook(app: FastifyInstance): Promise<void> {
  // Purge stale sessions once on startup (fire-and-forget)
  deleteExpiredSessions(getAppDb()).catch((err) => {
    app.log.warn({ err }, 'Failed to purge expired sessions on startup — non-fatal');
  });

  app.addHook('onRequest', async (request) => {
    // @fastify/cookie with `secret` automatically unsigns cookies.
    // Use unsignCookie for explicit error handling.
    const rawCookieValue = request.cookies[SESSION_COOKIE_NAME];
    if (!rawCookieValue) return; // No cookie — unauthenticated request, proceed

    const unsigned = request.unsignCookie(rawCookieValue);
    if (!unsigned.valid || !unsigned.value) {
      // Cookie exists but signature is invalid — clear it silently
      return;
    }

    const rawToken = unsigned.value;
    const hashedToken = hashSessionToken(rawToken);

    const db = getAppDb();
    const result = await findSessionByHashedToken(db, hashedToken);
    if (!result) return; // Session not found or expired

    const { session, user } = result;

    // Reject suspended / banned accounts immediately
    if (user.status === 'BANNED' || user.status === 'INACTIVE') {
      return; // Treat as unauthenticated — route handler will throw FORBIDDEN
    }

    // Slide session expiry if it's within the last 1 day of its window
    const expiresMs =
      typeof session.expires === 'string'
        ? new Date(session.expires).getTime()
        : session.expires.getTime();

    const now = Date.now();
    if (expiresMs - now < SLIDE_THRESHOLD_MS) {
      const newExpires = new Date(now + SESSION_MAX_AGE_MS);
      touchSession(db, session.id, newExpires).catch((err) => {
        app.log.warn({ err }, 'Failed to slide session expiry — non-fatal');
      });
    }

    // Decorate request.user — this is the ONLY place this gets set
    request.user = {
      id: user.id,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
    };

    // Store raw token for signout (needed to call deleteSession with the hash)
    request._rawSessionToken = rawToken;
  });
}

// ─── Guard Helpers ────────────────────────────────────────────────────────────

/**
 * Throws NOT_AUTHENTICATED (401) if request.user is not set.
 * Call at the top of any route handler that requires a valid session.
 *
 * TypeScript assertion: after this call, request.user is non-null.
 */
export function assertAuthenticated(request: FastifyRequest): asserts request is FastifyRequest & {
  user: AuthenticatedUser;
} {
  if (!request.user) {
    throw createDataError('NOT_AUTHENTICATED');
  }
}

/**
 * Set the session cookie on a reply.
 * Always call this after creating a session row in the DB.
 */
export function setSessionCookie(
  reply: import('fastify').FastifyReply,
  rawToken: string,
  config: { isProd: boolean },
): void {
  reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: config.isProd,   // Secure in prod/preprod; allows HTTP in local dev
    sameSite: 'lax',         // 'lax' allows cookie on top-level navigations (OAuth redirects)
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000, // seconds
    signed: true,            // @fastify/cookie signs with AUTH_SECRET
  });
}

/**
 * Clear the session cookie on logout.
 */
export function clearSessionCookie(reply: import('fastify').FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie('csrf_token', { path: '/' });
}
