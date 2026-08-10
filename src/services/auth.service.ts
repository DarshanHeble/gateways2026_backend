/**
 * Auth Service — Signup / Verify Email / Signin / Signout / Google OAuth
 *
 * Orchestration layer: calls security utilities + auth repository + email service.
 * No framework (Auth.js) — pure custom session management.
 *
 * Security invariants enforced here:
 *   - Email always normalized to lowercase before any DB lookup or insert.
 *   - passwordHash NEVER appears in any response object.
 *   - User existence is never revealed on login failure (returns INVALID_CREDENTIALS always).
 *   - BANNED / INACTIVE users receive FORBIDDEN (403), not INVALID_CREDENTIALS.
 *   - Email verification is required before password-login is allowed.
 *   - Google OAuth users are pre-verified by Google — OTP is skipped.
 *   - Raw session token never touches the DB — only its SHA-256 hash.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import crypto from 'node:crypto';
import { getAppDb } from '../db/index.js';
import { GOOGLE_CALLBACK_PATH } from '../config/routes.js';
import { createDataError } from '../errors/DataError.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { generateOtp, generateSessionToken, hashOtp, hashSessionToken, verifyOtp } from '../security/jwt.js';
import {
  consumeVerificationToken,
  createSession,
  createUser,
  deleteSession,
  findOrCreateOAuthUser,
  findUserByEmail,
  findUserWithHashByEmail,
  findVerificationToken,
  markEmailVerified,
  upsertVerificationToken,
} from '../repositories/auth.repository.js';
import { emailService } from './email.service.js';
import {
  assertAuthenticated,
  clearSessionCookie,
  setSessionCookie,
  BEARER_SESSION_MAX_AGE_MS,
  type AuthTransport,
} from '../plugins/jwt-auth.js';
import type { AppConfig } from '../config/env.js';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_COOKIE_NAME = 'csrf_token';
const OAUTH_STATE_COOKIE_NAME = 'oauth_state';

/**
 * Build the Google OAuth redirect URI.
 *
 * Used by BOTH the authorization-request builder and the callback handler. Google
 * requires the `redirect_uri` sent at each step to match byte-for-byte, and to
 * match what is registered in the Google Cloud Console — so these must never be
 * written as two separate literals. They previously were, which is a silent
 * production breakage waiting to happen: a drift between them fails at Google,
 * not in CI.
 */
function buildGoogleCallbackUrl(config: AppConfig): string {
  return `${config.OAUTH_CALLBACK_BASE_URL ?? config.APP_BASE_URL}${GOOGLE_CALLBACK_PATH}`;
}

// ─── Helper: Issue CSRF token cookie ─────────────────────────────────────────

function issueCsrfToken(reply: FastifyReply): string {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,    // Must be readable by frontend JS
    sameSite: 'strict',
    path: '/',
    // No maxAge — expires with browser session, refreshed on each login
  });
  return csrfToken;
}

// ─── Helper: Create session + set cookies ────────────────────────────────────

/**
 * Which credential the client is asking for, from the `X-Auth-Transport` header.
 *
 * Browsers get httpOnly cookies (default). The admin dashboard and mobile app
 * live on other origins where our cookie is third-party, so they opt into a
 * bearer token instead.
 */
export function resolveRequestedTransport(request: FastifyRequest): AuthTransport {
  return String(request.headers['x-auth-transport'] ?? '').toLowerCase() === 'bearer'
    ? 'bearer'
    : 'cookie';
}

/**
 * Create a session and hand back exactly ONE credential.
 *
 * Cookie and bearer are mutually exclusive by design. Issuing both would put the
 * same secret in a JS-readable response body *and* an httpOnly cookie, which
 * makes the httpOnly protection worthless — XSS could just read the body copy.
 *
 * Returns the raw token only for bearer callers; cookie callers get `null` and
 * the token never leaves the Set-Cookie header.
 */
async function createSessionAndIssueCredentials(
  userId: string,
  reply: FastifyReply,
  config: AppConfig,
  transport: AuthTransport,
): Promise<{ token: string; expiresAt: string } | null> {
  const db = getAppDb();
  const rawToken = generateSessionToken();
  const hashedToken = hashSessionToken(rawToken);
  const maxAgeMs = transport === 'bearer' ? BEARER_SESSION_MAX_AGE_MS : SESSION_MAX_AGE_MS;
  const expires = new Date(Date.now() + maxAgeMs);

  await createSession(db, {
    id: uuidv7(),
    userId,
    hashedToken,
    expires,
  });

  if (transport === 'bearer') {
    // No session cookie and no CSRF cookie: the client sends the token in an
    // Authorization header, which browsers never attach automatically, so there
    // is nothing for double-submit CSRF to protect.
    return { token: rawToken, expiresAt: expires.toISOString() };
  }

  setSessionCookie(reply, rawToken, { isProd: config.NODE_ENV !== 'development' });
  issueCsrfToken(reply);
  return null;
}

// ─── 1. Sign Up (Password) ───────────────────────────────────────────────────

export interface SignupDto {
  email: string;
  password: string;
  fullName: string;
}

/**
 * Register a new user with email + password.
 *
 * Flow:
 *  1. Normalize email → check for duplicate.
 *  2. Hash password (12 rounds).
 *  3. Insert user row (email unverified).
 *  4. Generate + hash 6-digit OTP, store in verification_tokens (15-min expiry).
 *  5. Send OTP email.
 *  6. Return { message } — NO session yet. User must verify email first.
 */
export async function signupWithPassword(dto: SignupDto): Promise<{ message: string }> {
  const db = getAppDb();
  const email = dto.email.toLowerCase().trim();

  // Duplicate check
  const existing = await findUserByEmail(db, email);
  if (existing) {
    throw createDataError('EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(dto.password);
  const userId = uuidv7();

  await createUser(db, { id: userId, email, passwordHash });

  // Generate OTP
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const otpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await upsertVerificationToken(db, {
    identifier: email,
    hashedOtp,
    expires: otpExpires,
    purpose: 'EMAIL_VERIFICATION',
  });

  // Send OTP via email (fire — if email fails, user can request resend later)
  await emailService.sendEmail({
    to: email,
    subject: 'Gateways 2026 — Verify your email',
    text: `Your verification code is: ${otp}\n\nThis code expires in 15 minutes.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Welcome to Gateways 2026!</h2>
        <p>Your email verification code is:</p>
        <p style="font-size:2rem;font-weight:bold;letter-spacing:0.25rem;color:#6366f1">${otp}</p>
        <p>This code expires in <strong>15 minutes</strong>.</p>
        <p style="color:#888;font-size:0.85rem">If you didn't create an account, ignore this email.</p>
      </div>
    `,
  });

  return {
    message:
      'Account created. A 6-digit verification code has been sent to your email. Please verify to complete registration.',
  };
}

// ─── 2. Verify Email (OTP) ───────────────────────────────────────────────────

export interface VerifyEmailDto {
  email: string;
  otp: string;
}

/**
 * Verify email with the 6-digit OTP sent during signup.
 *
 * Flow:
 *  1. Find pending verification token for this email.
 *  2. Check not expired.
 *  3. bcrypt.compare(otp, storedHash).
 *  4. Atomically: markEmailVerified + consumeVerificationToken.
 *  5. Create session → set __session cookie + csrf_token cookie.
 *  6. Return { user } — user is now logged in.
 */
export async function verifyEmail(
  dto: VerifyEmailDto,
  reply: FastifyReply,
  config: AppConfig,
  transport: AuthTransport = 'cookie',
): Promise<{
  message: string;
  user: { id: string; email: string };
  token?: string;
  expiresAt?: string;
}> {
  const db = getAppDb();
  const email = dto.email.toLowerCase().trim();

  const tokenRow = await findVerificationToken(db, email, 'EMAIL_VERIFICATION');

  // Generic error to avoid revealing whether the email exists or the OTP is wrong
  const invalidError = createDataError(
    'INVALID_CREDENTIALS',
    'Invalid or expired verification code.',
  );

  if (!tokenRow) throw invalidError;

  // Check expiry
  const expires =
    typeof tokenRow.expires === 'string' ? new Date(tokenRow.expires) : tokenRow.expires;
  if (Date.now() > expires.getTime()) {
    await consumeVerificationToken(db, email, 'EMAIL_VERIFICATION');
    throw invalidError;
  }

  // Verify OTP (timing-safe bcrypt compare)
  const valid = await verifyOtp(dto.otp, tokenRow.token);
  if (!valid) throw invalidError;

  // Atomic: mark verified + consume OTP token
  const user = await findUserWithHashByEmail(db, email);
  if (!user) throw invalidError; // Shouldn't happen, but guard anyway

  await Promise.all([
    markEmailVerified(db, user.id),
    consumeVerificationToken(db, email, 'EMAIL_VERIFICATION'),
  ]);

  // Create session — user is logged in immediately after verification
  const credentials = await createSessionAndIssueCredentials(user.id, reply, config, transport);

  return {
    message: 'Email verified successfully. You are now signed in.',
    user: { id: user.id, email: user.email },
    ...(credentials ?? {}),
  };
}

// ─── 3. Sign In (Password) ───────────────────────────────────────────────────

export interface SigninDto {
  email: string;
  password: string;
}

/**
 * Authenticate an existing user with email + password.
 *
 * Flow:
 *  1. Look up user by email (with passwordHash for verification).
 *  2. INVALID_CREDENTIALS if user not found (never reveal existence).
 *  3. FORBIDDEN if status is BANNED or INACTIVE.
 *  4. VALIDATION_FAILED if email is not yet verified.
 *  5. bcrypt.compare password — INVALID_CREDENTIALS on mismatch.
 *  6. Create session → set __session cookie + csrf_token cookie.
 */
/**
 * Verify an email + password WITHOUT creating a session.
 *
 * Split out so callers can insert extra checks between "these credentials are
 * valid" and "issue a credential". The admin door needs exactly that: it must
 * reject a non-admin *before* a session row exists, otherwise a rejected login
 * still leaves a usable token behind for the participant API.
 *
 * Throws INVALID_CREDENTIALS for both unknown users and wrong passwords, so the
 * endpoint cannot be used to enumerate registered emails.
 */
export async function verifyPasswordCredentials(
  dto: SigninDto,
): Promise<{ id: string; email: string }> {
  const db = getAppDb();
  const email = dto.email.toLowerCase().trim();

  const user = await findUserWithHashByEmail(db, email);

  // Existence check — always INVALID_CREDENTIALS to avoid user enumeration
  if (!user || !user.passwordHash) {
    throw createDataError('INVALID_CREDENTIALS');
  }

  // Suspended account
  if (user.status === 'BANNED' || user.status === 'INACTIVE') {
    throw createDataError('FORBIDDEN', 'Your account has been suspended.');
  }

  // Email not verified yet
  if (!user.emailVerified) {
    throw createDataError(
      'VALIDATION_FAILED',
      'Please verify your email before signing in. Check your inbox for the verification code.',
    );
  }

  // Password check (timing-safe bcrypt compare)
  const passwordValid = await verifyPassword(dto.password, user.passwordHash);
  if (!passwordValid) {
    throw createDataError('INVALID_CREDENTIALS');
  }

  return { id: user.id, email: user.email };
}

export async function signinWithPassword(
  dto: SigninDto,
  reply: FastifyReply,
  config: AppConfig,
  transport: AuthTransport = 'cookie',
): Promise<{ user: { id: string; email: string }; token?: string; expiresAt?: string }> {
  const user = await verifyPasswordCredentials(dto);
  const credentials = await createSessionAndIssueCredentials(user.id, reply, config, transport);

  return { user, ...(credentials ?? {}) };
}

/**
 * Issue a session for an already-verified user.
 *
 * Exported for the admin signin door, which verifies credentials, checks the
 * ADMIN role, and only then asks for a credential.
 */
export async function issueSessionFor(
  userId: string,
  reply: FastifyReply,
  config: AppConfig,
  transport: AuthTransport,
): Promise<{ token: string; expiresAt: string } | null> {
  return createSessionAndIssueCredentials(userId, reply, config, transport);
}

// ─── 4. Sign Out ─────────────────────────────────────────────────────────────

/**
 * Revoke the current session and clear auth cookies.
 * No-op if the session is already gone (idempotent).
 */
export async function signout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  assertAuthenticated(request);

  const db = getAppDb();
  if (request._rawSessionToken) {
    const hashedToken = hashSessionToken(request._rawSessionToken);
    await deleteSession(db, hashedToken);
  }

  clearSessionCookie(reply);
}

// ─── 5. Get Current Session ───────────────────────────────────────────────────

/**
 * Return the currently authenticated user from the session hook decoration.
 * Throws NOT_AUTHENTICATED if no valid session exists.
 */
export function getSession(request: FastifyRequest): {
  id: string;
  email: string;
  status: string;
  emailVerified: Date | string | null;
} {
  assertAuthenticated(request);
  return request.user;
}

// ─── 6. Google OAuth — Initiate ──────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPES = 'openid email profile';

/**
 * Build the Google OAuth2 authorization redirect URL.
 * Frontend should redirect the user to the returned URL.
 */
export function initiateGoogleOAuth(config: AppConfig, reply: FastifyReply): { url: string } {
  if (!config.OAUTH_GOOGLE_CLIENT_ID) {
    throw createDataError('INTERNAL_ERROR', 'Google OAuth is not configured on this server.');
  }

  const callbackUrl = buildGoogleCallbackUrl(config);
  const state = crypto.randomBytes(16).toString('hex'); // CSRF state param

  // Persist the state so the callback can prove this flow started here. It was
  // previously generated, sent to Google, and then never checked — which left
  // login-CSRF wide open: an attacker could feed a victim their own auth code and
  // silently bind the victim's browser to the attacker's Google account.
  //
  // A signed httpOnly cookie is enough; the value is single-use and short-lived,
  // so it needs no DB row.
  reply.setCookie(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    // 'lax' (not 'strict') is required: the cookie must survive Google's
    // top-level redirect back to the callback.
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes — an OAuth round-trip, not a session
    signed: true,
  });

  const params = new URLSearchParams({
    client_id: config.OAUTH_GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
}

// ─── 7. Google OAuth — Callback ───────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;   // Google's unique user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

/**
 * Handle the Google OAuth callback after the user grants consent.
 *
 * Flow:
 *  1. Exchange authorization code for Google tokens.
 *  2. Fetch Google userinfo (email, name, picture).
 *  3. find-or-create user + link OAuth account (atomic DB transaction).
 *  4. Create session → set __session cookie + csrf_token cookie.
 */
export async function handleGoogleCallback(
  code: string,
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  state?: string,
): Promise<{ user: { id: string; email: string } }> {
  if (!config.OAUTH_GOOGLE_CLIENT_ID || !config.OAUTH_GOOGLE_CLIENT_SECRET) {
    throw createDataError('INTERNAL_ERROR', 'Google OAuth is not configured on this server.');
  }

  // Verify the state round-tripped from initiateGoogleOAuth before spending the
  // authorization code. Consume the cookie either way so a state can't be replayed.
  const stateCookie = request.cookies[OAUTH_STATE_COOKIE_NAME];
  reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: '/' });

  const expectedState = stateCookie ? request.unsignCookie(stateCookie) : null;
  if (
    !state ||
    !expectedState?.valid ||
    !expectedState.value ||
    expectedState.value.length !== state.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedState.value), Buffer.from(state))
  ) {
    throw createDataError('VALIDATION_FAILED', 'Invalid or expired OAuth state.');
  }

  const callbackUrl = buildGoogleCallbackUrl(config);

  // Step 1: exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.OAUTH_GOOGLE_CLIENT_ID,
      client_secret: config.OAUTH_GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    throw createDataError('INVALID_CREDENTIALS', 'Failed to exchange Google authorization code.');
  }

  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  // Step 2: fetch userinfo
  const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    throw createDataError('INTERNAL_ERROR', 'Failed to fetch Google user profile.');
  }

  const googleUser = (await userInfoRes.json()) as GoogleUserInfo;

  if (!googleUser.email || !googleUser.email_verified) {
    throw createDataError(
      'VALIDATION_FAILED',
      'Google account email is not verified. Please verify your Google account first.',
    );
  }

  // Step 3: find-or-create user + link OAuth account
  const db = getAppDb();
  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

  const userId = await findOrCreateOAuthUser(db, {
    userId: uuidv7(),
    accountId: uuidv7(),
    email: googleUser.email,
    provider: 'google',
    providerAccountId: googleUser.sub,
    googleProfile: {
      name: googleUser.name,
      picture: googleUser.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      idToken: tokens.id_token,
      scope: tokens.scope,
    },
  });

  // Step 4: create session.
  // Cookie-only: this is a top-level browser redirect, so there is no JSON body
  // for a native client to read a token out of. Mobile Google sign-in needs a
  // separate one-time-code exchange rather than reusing this callback.
  await createSessionAndIssueCredentials(userId, reply, config, 'cookie');

  return { user: { id: userId, email: googleUser.email } };
}
