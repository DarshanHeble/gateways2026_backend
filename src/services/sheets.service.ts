import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { loadConfig } from '../config/env.js';
import { createDataError } from '../errors/DataError.js';

/**
 * Lazily initializes and returns a GoogleSpreadsheet client authenticated
 * via a service account JWT. The client is created once and reused across
 * all requests (module-level singleton).
 *
 * The GOOGLE_PRIVATE_KEY newline fix (.replace(/\\n/g, '\n')) is applied
 * here — once, at initialization — not scattered across route handlers.
 */
let docInstance: GoogleSpreadsheet | null = null;

function getSheetClient(): GoogleSpreadsheet {
  if (docInstance) return docInstance;

  const config = loadConfig();

  if (!config.GOOGLE_SERVICE_EMAIL || !config.GOOGLE_PRIVATE_KEY || !config.SHEET_ID) {
    throw createDataError('STORAGE_UNAVAILABLE', 'Google Sheets configuration missing.');
  }

  const auth = new JWT({
    email: config.GOOGLE_SERVICE_EMAIL,
    // Fix for newline encoding issues when storing PEM keys in .env files.
    // .env parsers often store literal "\n" (two chars) instead of an actual
    // newline character (one char). This replaces them back to real newlines.
    key: config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  docInstance = new GoogleSpreadsheet(config.SHEET_ID, auth);
  return docInstance;
}

/**
 * How long a fetched snapshot is served before Google is consulted again.
 *
 * This MUST exist now that the website polls every 5s. Each miss costs two
 * Google API calls (loadInfo + getRows) against a 300-reads/min/project quota,
 * so a single open browser tab would burn 24/min and roughly a dozen concurrent
 * visitors would exhaust it — every visitor then sees 503 until the minute
 * rolls over. With this cache the cost is independent of traffic: at most two
 * calls per TTL no matter how many people are watching.
 *
 * Matched to the poll interval, so a sheet edit is visible within ~10s worst
 * case (5s stale window + 5s until the next poll). The webhook below shortcuts
 * that to the next poll.
 */
const CACHE_TTL_MS = 5_000;

/** Longest a stale snapshot may be served after Google starts failing. */
const MAX_STALE_MS = 5 * 60_000;

interface Snapshot {
  at: number;
  rows: Record<string, unknown>[];
}

let snapshot: Snapshot | null = null;
let inFlight: Promise<Record<string, unknown>[]> | null = null;

/**
 * Drops the cached snapshot so the next read goes to Google.
 * Called by the sheet-update webhook.
 */
export function invalidateSheetCache(): void {
  snapshot = null;
}

async function fetchRowsFromGoogle(): Promise<Record<string, unknown>[]> {
  const doc = getSheetClient();

  // loadInfo() fetches sheet metadata (title, tabs, etc.) from the API.
  // This must be called before accessing sheetsByIndex.
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  // row.toObject() converts each row into a plain { header: value } object
  // based on the sheet's first-row column headers.
  return rows.map((row: any) => row.toObject() as Record<string, unknown>);
}

/**
 * Fetches all rows from the first tab of the configured Google Sheet, served
 * from a short-lived cache.
 *
 * Throws DataError('STORAGE_UNAVAILABLE') — which maps to HTTP 503 — on any
 * Google Sheets API failure, so the global error handler in security.ts handles
 * the response shape automatically.
 */
export async function fetchEventsFromSheet(): Promise<Record<string, unknown>[]> {
  if (snapshot && Date.now() - snapshot.at < CACHE_TTL_MS) return snapshot.rows;

  // Single-flight. Without this, every request arriving during a slow fetch
  // starts its own — precisely the stampede the cache exists to prevent, and
  // worst exactly when Google is already struggling.
  if (inFlight) return inFlight;

  inFlight = fetchRowsFromGoogle()
    .then((rows) => {
      snapshot = { at: Date.now(), rows };
      return rows;
    })
    .catch((err: unknown) => {
      // Re-throw known DataErrors directly (config missing, etc.).
      if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'DataError') {
        throw err;
      }

      // Serve stale rather than empty the events page for a transient blip.
      // At a 5s poll a single failed call would otherwise blank the UI for
      // every visitor at once; a few-minute-old event list is strictly better
      // than none, and MAX_STALE_MS stops it hiding a sustained outage.
      if (snapshot && Date.now() - snapshot.at < MAX_STALE_MS) {
        return snapshot.rows;
      }

      throw createDataError(
        'STORAGE_UNAVAILABLE',
        'Failed to fetch events from Google Sheets. The service may be temporarily unavailable.'
      );
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
