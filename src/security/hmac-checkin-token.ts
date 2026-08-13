/**
 * HMAC-SHA256 Check-in Token — Issue & Verify
 *
 * Short-lived signed tokens for QR-code attendance check-in.
 * Lifetime: 60 seconds. Each token has a unique `jti` (JWT ID) that is
 * stored in `checkin_token_redemptions` after first use to prevent QR replay.
 *
 * Token format (URL-safe base64):
 *   <base64url(header)>.<base64url(payload)>.<base64url(hmac-signature)>
 *
 * Payload: { jti, eventId, userId, iat, exp }
 *
 * ⏳ Phase 4 — Full usage requires `checkin_token_redemptions` table (attendance schema).
 * issueCheckinToken / verifyCheckinToken are fully functional now.
 * The replay-prevention DB write will be wired in Phase 4.
 */

import crypto from 'node:crypto';

const TOKEN_LIFETIME_SECONDS = 60;

interface CheckinPayload {
  jti: string;
  eventId: string;
  userId: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer | string): string {
  const str = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return str.toString('base64url');
}

function hmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Issue a 60-second HMAC-signed check-in token for a user + event pair.
 * @param eventId  The event UUID
 * @param userId   The user UUID
 * @param secret   CHECKIN_TOKEN_SECRET from env
 * @returns        Opaque token string (pass to verifyCheckinToken to redeem)
 */
export function issueCheckinToken(eventId: string, userId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: CheckinPayload = {
    jti: crypto.randomBytes(16).toString('hex'),
    eventId,
    userId,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
  };

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'CHECKIN' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = hmacSign(signingInput, secret);

  return `${signingInput}.${sig}`;
}

/**
 * Verify a check-in token.
 * Throws a plain Error (not DataError) — callers should map to VALIDATION_FAILED.
 *
 * @returns  The decoded payload ({ jti, eventId, userId }) on success
 */
export function verifyCheckinToken(
  token: string,
  secret: string,
): Pick<CheckinPayload, 'jti' | 'eventId' | 'userId'> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed check-in token.');
  }

  const [header, body, sig] = parts;
  const signingInput = `${header}.${body}`;

  // Timing-safe signature verification
  const expected = hmacSign(signingInput, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(sig);

  if (
    expectedBuf.length !== actualBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw new Error('Invalid check-in token signature.');
  }

  // Decode and validate payload
  let payload: CheckinPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CheckinPayload;
  } catch {
    throw new Error('Malformed check-in token payload.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    throw new Error('Check-in token has expired.');
  }

  return { jti: payload.jti, eventId: payload.eventId, userId: payload.userId };
}
