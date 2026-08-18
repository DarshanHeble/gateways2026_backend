import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { loadConfig } from '../config/env.js';
import { createDataError } from '../errors/DataError.js';

let docInstance: GoogleSpreadsheet | null = null;

function getSheetClient(): GoogleSpreadsheet {
  if (docInstance) return docInstance;

  const config = loadConfig();

  if (!config.GOOGLE_SERVICE_EMAIL || !config.GOOGLE_PRIVATE_KEY || !config.SHEET_ID) {
    throw createDataError('STORAGE_UNAVAILABLE', 'Google Sheets configuration missing.');
  }

  const auth = new JWT({
    email: config.GOOGLE_SERVICE_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  docInstance = new GoogleSpreadsheet(config.SHEET_ID, auth);
  return docInstance;
}

export interface EventHead {
  name: string;
  role: string;
  phone: string;
  email: string;
}

export interface EventDetail {
  id: string;
  title: string;
  subtitle?: string;
  date: string;
  from_time: string;
  end_time: string;
  venue: string;
  type: string;
  image_url?: string;
  description: string;
  rules: string[];
  rules_pdf_url?: string;
  eligibility: string[];
  prizes: {
    winner?: string;
    runner_up?: string;
    second_runner_up?: string;
  };
  event_heads: EventHead[];
}

export interface ScheduleItem {
  id: string;
  title: string;
  subtitle?: string;
  date: string;
  from_time: string;
  end_time: string;
  venue: string;
  category: string;
  is_competition: boolean;
}

export interface ScheduleDay {
  day_number: number;
  date: string;
  display_date: string;
  timeline: ScheduleItem[];
}

export interface ScheduleResponse {
  days: ScheduleDay[];
}

function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

function parseListField(value: any): string[] {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(/\n|;/)
    .map((item) => item.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
}

const CACHE_TTL_MS = 5_000;
const MAX_STALE_MS = 5 * 60_000;
let eventsCache: { at: number; data: EventDetail[] } | null = null;
let cacheInvalidated = false;

export function invalidateSheetCache(): void {
  eventsCache = null;
  cacheInvalidated = true;
}

export async function fetchEventsFromSheet(): Promise<EventDetail[]> {
  if (!cacheInvalidated && eventsCache && Date.now() - eventsCache.at < CACHE_TTL_MS) {
    return eventsCache.data;
  }
  cacheInvalidated = false;

  try {
    const doc = getSheetClient();
    await doc.loadInfo();

    const eventsSheet = doc.sheetsByTitle['Events'] || doc.sheetsByIndex[0];
    const eventRows = await eventsSheet.getRows();

    const headsSheet = doc.sheetsByTitle['EventHeads'] || doc.sheetsByIndex[1];
    let headRows: any[] = [];
    if (headsSheet) {
      try { headRows = await headsSheet.getRows(); } catch { headRows = []; }
    }

    const headsByEventId = new Map<string, EventHead[]>();
    for (const row of headRows) {
      const obj = row.toObject();
      const rawEventId = obj.event_id || obj.eventId;
      if (!rawEventId) continue;
      const normalizedId = String(rawEventId).trim().toLowerCase();
      const head: EventHead = {
        name: String(obj.name || '').trim(),
        role: String(obj.role || '').trim(),
        phone: String(obj.phone || '').trim(),
        email: String(obj.email || '').trim(),
      };
      if (!headsByEventId.has(normalizedId)) headsByEventId.set(normalizedId, []);
      headsByEventId.get(normalizedId)!.push(head);
    }

    const events: EventDetail[] = [];
    for (const row of eventRows) {
      const obj = row.toObject();
      const id = String(obj.id || obj.event_id || '').trim().toLowerCase();
      const title = String(obj.title || '').trim();
      if (!id || !title) continue;

      events.push({
        id,
        title,
        subtitle: obj.subtitle ? String(obj.subtitle).trim() : undefined,
        date: String(obj.date || '').trim(),
        from_time: String(obj.from_time || obj.fromTime || '').trim(),
        end_time: String(obj.end_time || obj.endTime || '').trim(),
        venue: String(obj.venue || '').trim(),
        type: String(obj.type || 'General').trim(),
        image_url: obj.image_url || obj.imageUrl ? String(obj.image_url || obj.imageUrl).trim() : undefined,
        description: String(obj.description || '').trim(),
        rules: parseListField(obj.rules),
        rules_pdf_url: obj.rules_pdf_url || obj.rulesPdfUrl ? String(obj.rules_pdf_url || obj.rulesPdfUrl).trim() : undefined,
        eligibility: parseListField(obj.eligibility),
        prizes: {
          winner: obj.winner_prize || obj.winnerPrize ? String(obj.winner_prize || obj.winnerPrize).trim() : undefined,
          runner_up: obj.runner_up_prize || obj.runnerUpPrize ? String(obj.runner_up_prize || obj.runnerUpPrize).trim() : undefined,
          second_runner_up: obj.second_runner_up_prize || obj.secondRunnerUpPrize ? String(obj.second_runner_up_prize || obj.secondRunnerUpPrize).trim() : undefined,
        },
        event_heads: headsByEventId.get(id) || [],
      });
    }

    eventsCache = { at: Date.now(), data: events };
    return events;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'DataError') throw err;
    if (eventsCache && Date.now() - eventsCache.at < MAX_STALE_MS) return eventsCache.data;
    throw createDataError('STORAGE_UNAVAILABLE', 'Failed to fetch events from Google Sheets. The service may be temporarily unavailable.');
  }
}

export async function fetchScheduleFromSheet(): Promise<ScheduleResponse> {
  try {
    const doc = getSheetClient();
    await doc.loadInfo();

    const events = await fetchEventsFromSheet();
    const competitionItems: ScheduleItem[] = events.map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      date: e.date,
      from_time: e.from_time,
      end_time: e.end_time,
      venue: e.venue,
      category: e.type,
      is_competition: true,
    }));

    const generalSheet = doc.sheetsByTitle['Schedule'] || doc.sheetsByTitle['GeneralSchedule'];
    let generalItems: ScheduleItem[] = [];

    if (generalSheet) {
      try {
        const rows = await generalSheet.getRows();
        for (const row of rows) {
          const obj = row.toObject();
          const title = String(obj.title || '').trim();
          if (!title) continue;
          generalItems.push({
            id: String(obj.id || title.toLowerCase().replace(/\s+/g, '-')).trim(),
            title,
            subtitle: obj.subtitle ? String(obj.subtitle).trim() : undefined,
            date: String(obj.date || '').trim(),
            from_time: String(obj.from_time || obj.fromTime || '').trim(),
            end_time: String(obj.end_time || obj.endTime || '').trim(),
            venue: String(obj.venue || '').trim(),
            category: String(obj.category || 'General').trim(),
            is_competition: false,
          });
        }
      } catch { generalItems = []; }
    }

    const allItems = [...competitionItems, ...generalItems];
    const itemsByDate = new Map<string, ScheduleItem[]>();
    for (const item of allItems) {
      const date = item.date || 'TBD';
      if (!itemsByDate.has(date)) itemsByDate.set(date, []);
      itemsByDate.get(date)!.push(item);
    }

    const sortedDates = Array.from(itemsByDate.keys()).sort();
    const days: ScheduleDay[] = sortedDates.map((date, index) => {
      const timeline = itemsByDate.get(date)!;
      timeline.sort((a, b) => parseTimeToMinutes(a.from_time) - parseTimeToMinutes(b.from_time));

      let display_date = `Day ${index + 1}`;
      if (date !== 'TBD') {
        try {
          const parsed = new Date(date);
          if (!isNaN(parsed.getTime())) {
            display_date = `Day ${index + 1} - ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          } else {
            display_date = `Day ${index + 1} - ${date}`;
          }
        } catch { display_date = `Day ${index + 1} - ${date}`; }
      }

      return { day_number: index + 1, date, display_date, timeline };
    });

    return { days };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'DataError') throw err;
    throw createDataError('STORAGE_UNAVAILABLE', 'Failed to fetch schedule from Google Sheets. The service may be temporarily unavailable.');
  }
}
