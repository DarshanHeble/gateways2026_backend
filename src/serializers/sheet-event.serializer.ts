/**
 * Maps a Google Sheet row onto the event shape `/api/v1/events` already served
 * from MySQL.
 *
 * The mapping lives here, on the backend, so the website's `toEvent()` and every
 * screen consuming `FestEvent` keep working untouched. Moving events to Sheets
 * is a change of source, not of contract.
 *
 * Sheet columns:
 *   id, title, subtitle, date, from_time, end_time, venue, type, image_url,
 *   description, rules, rules_pdf_url, eligibility,
 *   winner_prize, runner_up_prize, second_runner_up_prize
 */

/** IST. The sheet is maintained by staff who write local times. */
const IST_OFFSET = '+05:30';

function str(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** "Technical" -> "technical"; used for both categoryId and categorySlug. */
function slugify(value: unknown): string | null {
  const raw = str(value);
  return raw == null ? null : raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Combines the sheet's separate date and time columns into one UTC ISO instant.
 *
 * `date` is `YYYY-MM-DD` and `time` is a 12-hour string like "9:00 AM". They are
 * interpreted as IST and converted to UTC, because the DB-backed route this
 * replaces emitted UTC ISO strings and the frontend formats for display. Parsing
 * them as UTC instead would shift every event on the schedule by 5h30m — a skew
 * nobody notices until the day of the fest.
 *
 * Returns null when either part is missing or unparseable, which the frontend
 * already tolerates.
 */
export function combineDateTime(date: unknown, time: unknown): string | null {
  const day = str(date);
  if (day == null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const raw = str(time);
  if (raw == null) return null;

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toUpperCase();

  if (hours > 23 || minutes > 59) return null;

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const parsed = new Date(`${day}T${hh}:${mm}:00.000${IST_OFFSET}`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface SheetEvent {
  id: string;
  slug: string;
  title: string | null;
  tagline: string | null;
  description: string | null;
  rules: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  status: string;
  mode: string;
  minTeamSize: number;
  maxTeamSize: number;
  capacity: number | null;
  venue: string | null;
  startsAt: string | null;
  endsAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  xpReward: number;
  entryFeeInr: number;
  requiresApproval: boolean;
  contactEmail: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  rulesPdfUrl: string | null;
  eligibility: string | null;
  prizes: { winner: string | null; runnerUp: string | null; secondRunnerUp: string | null };
}

export function serializeSheetEvent(row: Record<string, unknown>): SheetEvent {
  const id = str(row.id) ?? '';

  return {
    id,
    // The sheet has no separate slug column; its `id` is already a human
    // handle ("hackathon"), so it serves as both and /events/:id keeps working
    // for slug-shaped lookups.
    slug: id,
    title: str(row.title),
    tagline: str(row.subtitle) ?? str(row.description),
    description: str(row.description),
    rules: str(row.rules),
    categoryId: slugify(row.type),
    categorySlug: slugify(row.type),

    // The sheet carries no lifecycle column. Anything present in it is meant to
    // be public — staff publish by adding the row — and the website filters on
    // status, so a row that reported anything else would be silently invisible.
    status: 'published',

    // No structured team columns exist. Team sizes appear only inside the free
    // -text `rules` ("Team size: 2 to 4 members"), which is not safe to parse,
    // so this reports solo rather than inventing limits. Add explicit
    // mode/min_team_size/max_team_size columns to the sheet if registration
    // needs to enforce them.
    mode: 'solo',
    minTeamSize: 1,
    maxTeamSize: 1,

    capacity: null,
    venue: str(row.venue),
    startsAt: combineDateTime(row.date, row.from_time),
    endsAt: combineDateTime(row.date, row.end_time),
    registrationOpensAt: null,
    registrationClosesAt: null,
    xpReward: 0,
    entryFeeInr: 0,
    requiresApproval: false,
    contactEmail: null,
    createdBy: null,
    createdAt: null,
    updatedAt: null,

    // Sheet-only fields with no MySQL equivalent. The website's current
    // `toEvent()` drops them, so they cost nothing today and are here so the
    // detail page can show posters, prizes and the rules PDF without another
    // backend change.
    imageUrl: str(row.image_url),
    rulesPdfUrl: str(row.rules_pdf_url),
    eligibility: str(row.eligibility),
    prizes: {
      winner: str(row.winner_prize),
      runnerUp: str(row.runner_up_prize),
      secondRunnerUp: str(row.second_runner_up_prize),
    },
  };
}
