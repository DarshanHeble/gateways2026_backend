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
 * Fetches all rows from the first tab of the configured Google Sheet.
 * Each row is converted to a plain object using the sheet's header row as keys.
 *
 * Throws DataError('STORAGE_UNAVAILABLE') — which maps to HTTP 503 — on any
 * Google Sheets API failure, so the global error handler in security.ts handles
 * the response shape automatically.
 */
export async function fetchEventsFromSheet(): Promise<Record<string, unknown>[]> {
  try {
    const doc = getSheetClient();

    // loadInfo() fetches sheet metadata (title, tabs, etc.) from the API.
    // This must be called before accessing sheetsByIndex.
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    // row.toObject() converts each row into a plain { header: value } object
    // based on the sheet's first-row column headers.
    return rows.map((row) => row.toObject() as Record<string, unknown>);
  } catch (err: unknown) {
    // Re-throw known DataErrors directly (defensive — shouldn't occur here).
    if (err && typeof err === 'object' && 'code' in err && (err as any).name === 'DataError') {
      throw err;
    }

    // Map all Google API / network errors to a standardized 503.
    throw createDataError(
      'STORAGE_UNAVAILABLE',
      'Failed to fetch events from Google Sheets. The service may be temporarily unavailable.'
    );
  }
}
