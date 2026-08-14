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
] as const;

const at = (value: string) => new Date(`${value}+05:30`);

const EVENTS = [
  { id: 'evt-photo-contest', categoryId: 'cat-photo', slug: 'realm-through-lens', title: 'Realm Through a Lens', description: 'Themed photo contest.', venue: 'Online submission', start: '2026-10-08T09:00:00', end: '2026-10-09T18:00:00', capacity: null, team: false, min: 1, max: 1, xp: 80 },
  { id: 'evt-past-workshop', categoryId: 'cat-design', slug: 'git-basics-workshop', title: 'Git Basics Workshop', description: 'Version control from zero.', venue: 'CS Lab 1', start: '2026-10-08T09:00:00', end: '2026-10-08T12:00:00', capacity: 60, team: false, min: 1, max: 1, xp: 40 },
  { id: 'evt-hack-24', categoryId: 'cat-hack', slug: 'code-crafters-24h', title: 'CodeCrafters 24H', description: 'Build a working product in a day.', venue: 'Main Auditorium', start: '2026-10-08T10:00:00', end: '2026-10-09T10:00:00', capacity: 120, team: true, min: 2, max: 4, xp: 200 },
  { id: 'evt-quiz-tech', categoryId: 'cat-quiz', slug: 'brainmines-tech-quiz', title: 'BrainMines Tech Quiz', description: 'Three rounds, no mercy.', venue: 'Seminar Hall A', start: '2026-10-08T10:00:00', end: '2026-10-08T13:00:00', capacity: 64, team: true, min: 2, max: 3, xp: 100 },
  { id: 'evt-game-valorant', categoryId: 'cat-gaming', slug: 'arena-fps-cup', title: 'Arena FPS Cup', description: '5v5 elimination bracket.', venue: 'Gaming Arena', start: '2026-10-08T10:00:00', end: '2026-10-09T18:00:00', capacity: 80, team: true, min: 5, max: 5, xp: 150 },
  { id: 'evt-design-ui', categoryId: 'cat-design', slug: 'pixel-perfect-ui', title: 'Pixel Perfect UI', description: 'Design a game UI in 3 hours.', venue: 'Design Studio', start: '2026-10-08T13:00:00', end: '2026-10-08T16:00:00', capacity: 50, team: false, min: 1, max: 1, xp: 90 },
  { id: 'evt-game-retro', categoryId: 'cat-gaming', slug: 'retro-block-battle', title: 'Retro Block Battle', description: 'Classic games, modern stakes.', venue: 'Gaming Arena', start: '2026-10-08T14:00:00', end: '2026-10-08T18:00:00', capacity: 32, team: false, min: 1, max: 1, xp: 70 },
  { id: 'evt-photo-walk', categoryId: 'cat-photo', slug: 'golden-hour-walk', title: 'Golden Hour Walk', description: 'Campus photo walk with critique.', venue: 'Meet at Main Gate', start: '2026-10-08T16:00:00', end: '2026-10-08T19:00:00', capacity: 40, team: false, min: 1, max: 1, xp: 60 },
  { id: 'evt-design-poster', categoryId: 'cat-design', slug: 'poster-forge', title: 'Poster Forge', description: 'Rapid poster design battle.', venue: 'Design Studio', start: '2026-10-09T09:00:00', end: '2026-10-09T12:00:00', capacity: 30, team: true, min: 2, max: 2, xp: 70 },
  { id: 'evt-robotics-line', categoryId: 'cat-robotics', slug: 'circuit-line-follower', title: 'Line Follower Championship', description: 'Fastest bot wins.', venue: 'Robotics Lab', start: '2026-10-09T10:00:00', end: '2026-10-09T14:00:00', capacity: 40, team: true, min: 1, max: 3, xp: 110 },
  { id: 'evt-hack-ai', categoryId: 'cat-hack', slug: 'ai-dungeon-sprint', title: 'AI Dungeon Sprint', description: '6-hour ML sprint.', venue: 'CS Lab 2', start: '2026-10-09T11:00:00', end: '2026-10-09T17:00:00', capacity: 60, team: true, min: 1, max: 3, xp: 150 },
  { id: 'evt-quiz-gk', categoryId: 'cat-quiz', slug: 'general-knowledge-gauntlet', title: 'GK Gauntlet', description: 'Everything under the sun.', venue: 'Seminar Hall B', start: '2026-10-09T14:00:00', end: '2026-10-09T16:00:00', capacity: 100, team: false, min: 1, max: 1, xp: 60 },
  { id: 'evt-culture-band', categoryId: 'cat-culture', slug: 'battle-of-bands', title: 'Battle of the Bands', description: 'Live music finals.', venue: 'Open Air Stage', start: '2026-10-09T16:00:00', end: '2026-10-09T21:00:00', capacity: 20, team: true, min: 3, max: 8, xp: 120 },
] as const;

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
      status: 'published',
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
