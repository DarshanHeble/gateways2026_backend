/**
 * Route prefixes — the single source of truth for every path in the API.
 *
 * Three clients consume this backend (website, admin dashboard, mobile app),
 * split by AUDIENCE rather than by platform:
 *
 *   API_V1_PREFIX  → participant surface (website + mobile-user)
 *   ADMIN_PREFIX   → admin surface       (dashboard + mobile-admin)
 *
 * The mobile app spans both audiences, which is exactly why the split is by
 * audience and not by platform.
 *
 * Never write a prefix literal anywhere else. Two places in particular used to
 * duplicate the Google callback path — if those copies drift, OAuth breaks
 * silently at the provider rather than loudly in CI.
 *
 * `/health` and `/docs` deliberately stay at the root: load-balancer probes and
 * documentation links should not move when the API version does.
 */

export const API_V1_PREFIX = '/api/v1';
export const ADMIN_PREFIX = `${API_V1_PREFIX}/admin`;

/** Must match the authorized redirect URI registered in Google Cloud Console. */
export const GOOGLE_CALLBACK_PATH = `${API_V1_PREFIX}/auth/callback/google`;

/**
 * Routes exempt from CSRF double-submit verification: no session exists yet when
 * they are called, so there is no cookie to double-submit.
 *
 * Exact-match only — never suffix or regex matching. A `Set` lookup fails CLOSED
 * (an unrecognised path gets CSRF enforced); `endsWith('/signin')` fails OPEN the
 * moment anyone adds a route whose path happens to end the same way.
 */
export const CSRF_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  `${API_V1_PREFIX}/auth/signup`,
  `${API_V1_PREFIX}/auth/resend-verification`,
  `${API_V1_PREFIX}/auth/verify-email`,
  `${API_V1_PREFIX}/auth/signin`,
  `${API_V1_PREFIX}/auth/forgot-password`,
  `${API_V1_PREFIX}/auth/reset-password`,
  `${API_V1_PREFIX}/auth/callback/google`,
  `${API_V1_PREFIX}/auth/console-handoff/exchange`,
  `${ADMIN_PREFIX}/auth/signin`,
]);
