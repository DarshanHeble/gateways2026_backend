import { eq } from 'drizzle-orm';
import { eventCategories, events, scheduleSlots } from './schema/events.js';
import { getWriterDb } from './index.js';

/**
 * The website and registration console share this catalogue. Keep the IDs
 * stable: existing registrations and frontend links use them as identifiers.
 * Dates include the IST offset and are stored by MySQL as UTC timestamps.
 */
const CATEGORIES = [
  ['cat-hack', 'Hackathon Mine', 'hackathon-mine'],
  ['cat-photo', 'Photography Forest', 'photography-forest'],
  ['cat-design', 'Design Workshop', 'design-workshop'],
  ['cat-quiz', 'Quiz Library', 'quiz-library'],
  ['cat-gaming', 'Gaming Arena', 'gaming-arena'],
  ['cat-culture', 'Culture Stage', 'culture-stage'],
  ['cat-robotics', 'Circuit Lab', 'circuit-lab'],
  // The taxonomy the public events page filters on: All / Technical /
  // Non-Technical. The seven above are kept because the 3D world map keys its
  // locations off their slugs, but no 2026 event is filed under them.
  ['cat-technical', 'Technical', 'technical'],
  ['cat-nontechnical', 'Non-Technical', 'non-technical'],
] as const;

const at = (value: string) => new Date(`${value}+05:30`);

/**
 * One row per event, and the SINGLE source of the public schedule: the loop
 * below writes a `scheduleSlots` row per entry, which is what /schedule and the
 * homepage schedule modal both read. Change a time here and every surface moves
 * with it.
 */
type SeedEvent = {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  description: string;
  venue: string;
  start: string;
  end: string;
  capacity: number | null;
  team: boolean;
  min: number;
  max: number;
  xp: number;
  /**
   * Omitted means 'published'. Used to retire an event without deleting it.
   * Must be a member of the frontend's `EventStatus` union — 'archived' is not
   * one, and `toEvent` passes status through verbatim, so an invented value
   * reaches the UI as an unrecognised string.
   */
  status?: string;
};

/**
 * The 13 events for 2026.
 *
 * IDs are REUSED from the previous catalogue rather than reissued — the note at
 * the top of this file is not decorative: registrations, team rows and schedule
 * slots key off these ids, so renaming an event must not orphan them. Only
 * slug/title/description change, and those are what the site renders.
 *
 * `evt-game-valorant` is reused for Gaming rather than retired — reusing the
 * row keeps the catalogue at exactly 13 with no orphaned schedule slot, which
 * is what a status-retired row would otherwise have left behind.
 *
 * Four events are non-technical (Twin Protocol, Pixel Quest, Mystery Block,
 * Gaming); the other nine are technical.
 *
 * PLACEHOLDERS pending the organising team — `start`/`end` are inherited from
 * the slots the old catalogue occupied, and venue/capacity/team-size/xp are
 * best guesses. The published schedule is generated from these times, so they
 * need confirming before anyone treats them as final.
 */
const EVENTS: SeedEvent[] = [
  { id: 'evt-hack-24', categoryId: 'cat-technical', slug: '24-shift', title: '24\u00b0 Shift', description: '24 Hour Hackathon.', venue: 'To be announced', start: '2026-10-08T10:00:00', end: '2026-10-09T10:00:00', capacity: 120, team: true, min: 2, max: 4, xp: 200 },
  { id: 'evt-past-workshop', categoryId: 'cat-technical', slug: 'the-twin-directive', title: 'The Twin Directive', description: 'IT Manager.', venue: 'To be announced', start: '2026-10-08T09:00:00', end: '2026-10-08T12:00:00', capacity: 60, team: true, min: 2, max: 3, xp: 100 },
  { id: 'evt-quiz-tech', categoryId: 'cat-technical', slug: 'deviation', title: 'Deviation', description: 'IT Quiz.', venue: 'To be announced', start: '2026-10-08T10:00:00', end: '2026-10-08T13:00:00', capacity: 64, team: true, min: 2, max: 3, xp: 100 },
  { id: 'evt-design-ui', categoryId: 'cat-technical', slug: 'pixel-paradox', title: 'Pixel Paradox', description: 'UI/UX design.', venue: 'To be announced', start: '2026-10-08T13:00:00', end: '2026-10-08T16:00:00', capacity: 50, team: false, min: 1, max: 1, xp: 90 },
  { id: 'evt-game-retro', categoryId: 'cat-technical', slug: 'the-last-commit', title: 'The Last Commit', description: 'Coding and debugging.', venue: 'To be announced', start: '2026-10-08T14:00:00', end: '2026-10-08T18:00:00', capacity: 60, team: false, min: 1, max: 1, xp: 120 },
  { id: 'evt-photo-walk', categoryId: 'cat-technical', slug: 'promptx', title: 'PromptX', description: 'Prompt engineering.', venue: 'To be announced', start: '2026-10-08T16:00:00', end: '2026-10-08T19:00:00', capacity: 60, team: false, min: 1, max: 1, xp: 90 },
  { id: 'evt-design-poster', categoryId: 'cat-technical', slug: 'renderrush', title: 'RenderRush', description: '3D modelling.', venue: 'To be announced', start: '2026-10-09T09:00:00', end: '2026-10-09T12:00:00', capacity: 40, team: false, min: 1, max: 1, xp: 110 },
  { id: 'evt-robotics-line', categoryId: 'cat-technical', slug: 'alternate-thesis', title: 'Alternate Thesis', description: 'Paper presentation.', venue: 'To be announced', start: '2026-10-09T10:00:00', end: '2026-10-09T14:00:00', capacity: 40, team: true, min: 1, max: 2, xp: 110 },
  { id: 'evt-hack-ai', categoryId: 'cat-technical', slug: 'in-perspective', title: 'In Perspective', description: 'Poster presentation.', venue: 'To be announced', start: '2026-10-09T11:00:00', end: '2026-10-09T17:00:00', capacity: 60, team: true, min: 1, max: 2, xp: 100 },
  { id: 'evt-quiz-gk', categoryId: 'cat-nontechnical', slug: 'twin-protocol', title: 'Twin Protocol', description: 'Treasure hunt.', venue: 'To be announced', start: '2026-10-09T14:00:00', end: '2026-10-09T16:00:00', capacity: 100, team: true, min: 3, max: 5, xp: 120 },
  { id: 'evt-photo-contest', categoryId: 'cat-nontechnical', slug: 'pixel-quest', title: 'Pixel Quest', description: 'Photography.', venue: 'To be announced', start: '2026-10-08T09:00:00', end: '2026-10-09T18:00:00', capacity: null, team: false, min: 1, max: 1, xp: 80 },
  { id: 'evt-culture-band', categoryId: 'cat-nontechnical', slug: 'mystery-block', title: 'Mystery Block', description: 'Surprise event \u2014 gaming.', venue: 'To be announced', start: '2026-10-09T16:00:00', end: '2026-10-09T21:00:00', capacity: 80, team: false, min: 1, max: 1, xp: 100 },
  { id: 'evt-game-valorant', categoryId: 'cat-nontechnical', slug: 'gaming', title: 'Gaming', description: 'Gaming.', venue: 'To be announced', start: '2026-10-09T14:00:00', end: '2026-10-09T18:00:00', capacity: 80, team: false, min: 1, max: 1, xp: 100 },
];

export async function seedCanonicalEvents(): Promise<void> {
  const db = getWriterDb();
  for (const [id, name, slug] of CATEGORIES) {
    await db.insert(eventCategories).values({ id, name, slug }).onDuplicateKeyUpdate({ set: { name, slug } });
  }
  for (const event of EVENTS) {
    const values = {
      id: event.id,
      categoryId: event.categoryId,
      slug: event.slug,
      title: event.title,
      description: event.description,
      venue: event.venue,
      startsAt: at(event.start),
      endsAt: at(event.end),
      capacity: event.capacity,
      isTeamEvent: event.team,
      minTeamSize: event.min,
      maxTeamSize: event.max,
      status: event.status ?? 'published',
      paymentRequired: true,
      feeAmount: 0,
      xpReward: event.xp,
      requiresApproval: false,
    };
    await db.insert(events).values(values).onDuplicateKeyUpdate({
      set: {
        categoryId: values.categoryId,
        slug: values.slug,
        title: values.title,
        description: values.description,
        venue: values.venue,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        capacity: values.capacity,
        isTeamEvent: values.isTeamEvent,
        minTeamSize: values.minTeamSize,
        maxTeamSize: values.maxTeamSize,
        status: values.status,
        paymentRequired: values.paymentRequired,
        feeAmount: values.feeAmount,
        xpReward: values.xpReward,
        requiresApproval: values.requiresApproval,
      },
    });
    /*
      The schedule is generated from this list, so a retired event must not
      leave a slot behind — it would surface on the homepage schedule and the
      signed-in schedule, both of which read these rows. Deleting rather than
      skipping: this seed only ever upserts, so a slot written by a previous
      catalogue would otherwise persist forever.
    */
    if (values.status !== 'published') {
      await db.delete(scheduleSlots).where(eq(scheduleSlots.eventId, event.id));
      continue;
    }
    if (values.status !== 'published') {
      /*
        A retired event keeps its `events` row — registrations point at it — but
        must not sit on the public schedule. `listSchedule` is a bare select
        over this table with no status join, so the only way off the schedule is
        to not be in it. Deleting here (rather than skipping) makes the seed
        self-correcting: re-running it clears a slot left by an earlier run.
      */
      await db.delete(scheduleSlots).where(eq(scheduleSlots.id, `sch-${event.id}`));
      continue;
    }
    await db.insert(scheduleSlots).values({
      id: `sch-${event.id}`,
      eventId: event.id,
      roundName: event.title,
      venue: event.venue,
      startsAt: at(event.start),
      endsAt: at(event.end),
    }).onDuplicateKeyUpdate({
      set: { roundName: event.title, venue: event.venue, startsAt: at(event.start), endsAt: at(event.end) },
    });
  }
}

if (process.argv[1]?.endsWith('/seed.ts')) {
  seedCanonicalEvents()
    .then(() => console.log(`Seeded ${EVENTS.length} canonical events.`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
