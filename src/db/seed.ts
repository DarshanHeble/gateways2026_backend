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
 * Descriptions, participation type (team vs individual and the team sizes),
 * and the hackathon's dates and venue all come from the organising team's
 * Event Information sheet. They are REAL, not placeholders.
 *
 * Still provisional: the times for the 8–9 October events, which the sheet
 * lists as TBD — the ones below are plausible slots so the schedule has
 * something to render. Venue is likewise "To be announced" for everything but
 * the hackathon, which runs Online. Capacity and XP remain our own numbers.
 */
const EVENTS: SeedEvent[] = [
  { id: 'evt-hack-24', categoryId: 'cat-technical', slug: '24-shift', title: '24\u00b0 Shift', description: 'A 24-hour build sprint where teams turn a cryptic brief into a working solution, pushing creativity, execution, and perspective to the limit.', venue: 'Online', start: '2026-09-30T10:00:00', end: '2026-10-01T10:00:00', capacity: 120, team: true, min: 2, max: 4, xp: 200 },
  { id: 'evt-past-workshop', categoryId: 'cat-technical', slug: 'the-twin-directive', title: 'The Twin Directive', description: 'Step into the role of an IT leader and navigate strategic challenges, making critical decisions that balance technology, people, and business.', venue: 'To be announced', start: '2026-10-08T09:30:00', end: '2026-10-08T12:30:00', capacity: 60, team: false, min: 1, max: 1, xp: 100 },
  { id: 'evt-quiz-tech', categoryId: 'cat-technical', slug: 'deviation', title: 'Deviation', description: 'A mind-bending IT quiz where familiar answers hide unexpected twists, testing how quickly you can spot what deviates from the obvious.', venue: 'To be announced', start: '2026-10-08T10:00:00', end: '2026-10-08T12:00:00', capacity: 64, team: true, min: 2, max: 2, xp: 100 },
  { id: 'evt-design-ui', categoryId: 'cat-technical', slug: 'pixel-paradox', title: 'Pixel Paradox', description: 'Design cutting edge interfaces for technologies, turning unconventional prompts into bold, intuitive experiences under time pressure.', venue: 'To be announced', start: '2026-10-08T13:00:00', end: '2026-10-08T16:00:00', capacity: 50, team: true, min: 2, max: 3, xp: 90 },
  { id: 'evt-game-retro', categoryId: 'cat-technical', slug: 'the-last-commit', title: 'The Last Commit', description: 'Race against the clock to diagnose and fix deliberately broken code using strategic edits, where every bug could be hiding in plain sight.', venue: 'To be announced', start: '2026-10-08T09:30:00', end: '2026-10-08T12:30:00', capacity: 60, team: true, min: 2, max: 3, xp: 120 },
  { id: 'evt-photo-walk', categoryId: 'cat-technical', slug: 'promptx', title: 'PromptX', description: 'Tackle ambiguous challenges by crafting precise prompts that push AI beyond predictable answers while navigating constraints, adversarial inputs, and hallucinations.', venue: 'To be announced', start: '2026-10-08T13:30:00', end: '2026-10-08T16:00:00', capacity: 60, team: false, min: 1, max: 1, xp: 90 },
  { id: 'evt-design-poster', categoryId: 'cat-technical', slug: 'renderrush', title: 'RenderRush', description: 'Transform a themed brief into a polished 3D scene, asset, or product, where technical precision, visual depth, and storytelling all matter.', venue: 'To be announced', start: '2026-10-09T10:00:00', end: '2026-10-09T13:00:00', capacity: 40, team: false, min: 1, max: 1, xp: 110 },
  { id: 'evt-robotics-line', categoryId: 'cat-technical', slug: 'alternate-thesis', title: 'Alternate Thesis', description: 'Present original research and defend your ideas, demonstrating technical depth, evidence, and the ability to approach questions from unexpected angles.', venue: 'To be announced', start: '2026-10-09T10:00:00', end: '2026-10-09T13:00:00', capacity: 40, team: false, min: 1, max: 1, xp: 110 },
  { id: 'evt-hack-ai', categoryId: 'cat-technical', slug: 'in-perspective', title: 'In Perspective', description: 'Turn a complex technical idea into a compelling visual argument, balancing research, clarity, design, and the power to communicate at a glance.', venue: 'To be announced', start: '2026-10-09T11:00:00', end: '2026-10-09T14:00:00', capacity: 60, team: false, min: 1, max: 1, xp: 100 },
  { id: 'evt-quiz-gk', categoryId: 'cat-nontechnical', slug: 'twin-protocol', title: 'Twin Protocol', description: 'Follow a trail of clues where every discovery reveals another layer, shifting perspectives and connecting the pieces to uncover the final destination.', venue: 'To be announced', start: '2026-10-08T14:00:00', end: '2026-10-08T17:00:00', capacity: 100, team: true, min: 2, max: 4, xp: 120 },
  { id: 'evt-photo-contest', categoryId: 'cat-nontechnical', slug: 'pixel-quest', title: 'Pixel Quest', description: 'Turn your lens toward the unexpected, capturing fleeting moments, striking perspectives, and details that tell a story.', venue: 'To be announced', start: '2026-10-08T09:00:00', end: '2026-10-08T18:00:00', capacity: null, team: false, min: 1, max: 1, xp: 80 },
  { id: 'evt-culture-band', categoryId: 'cat-nontechnical', slug: 'mystery-block', title: 'Mystery Block', description: 'A mystery challenge revealed only when you enter adapt quickly, think differently, and uncover what the event has in store.', venue: 'To be announced', start: '2026-10-09T15:00:00', end: '2026-10-09T17:00:00', capacity: 80, team: true, min: 2, max: 4, xp: 100 },
  { id: 'evt-game-valorant', categoryId: 'cat-nontechnical', slug: 'gaming', title: 'Gaming', description: 'Enter the arena for intense BGMI and Minecraft, where every move, decision, and goal could turn the game around. BGMI is played in teams of 4; the Minecraft format is still to be confirmed.', venue: 'To be announced', start: '2026-10-09T14:00:00', end: '2026-10-09T18:00:00', capacity: 80, team: true, min: 1, max: 4, xp: 100 },
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
