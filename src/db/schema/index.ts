import { mysqlTable, varchar, text, timestamp, boolean, int, bigint, primaryKey, uniqueIndex, index } from 'drizzle-orm/mysql-core';

// ==========================================
// 1. AUTH DOMAIN
// ==========================================

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'), // ACTIVE, SUSPENDED, DELETED
  emailVerified: timestamp('email_verified', { mode: 'string', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', fsp: 3 }).notNull().defaultNow().onUpdateNow(),
});

export const accounts = mysqlTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: bigint('expires_at', { mode: 'number' }),
  tokenType: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  idToken: text('id_token'),
  sessionState: varchar('session_state', { length: 255 }),
}, (table) => ({
  providerAccountIdx: uniqueIndex('provider_providerAccountId_idx').on(table.provider, table.providerAccountId),
}));

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'string', fsp: 3 }).notNull(),
});

export const verificationTokens = mysqlTable('verification_tokens', {
  identifier: varchar('identifier', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expires: timestamp('expires', { mode: 'string', fsp: 3 }).notNull(),
  purpose: varchar('purpose', { length: 64 }).notNull().default('EMAIL_VERIFICATION'),
}, (table) => ({
  pk: primaryKey({ columns: [table.identifier, table.token] }),
}));

// ==========================================
// 2. IDENTITY & ROLES DOMAIN
// ==========================================

export const colleges = mysqlTable('colleges', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
});

export const departments = mysqlTable('departments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  collegeId: varchar('college_id', { length: 36 }).references(() => colleges.id),
  name: varchar('name', { length: 255 }).notNull(),
  active: boolean('active').notNull().default(true),
});

export const profiles = mysqlTable('profiles', {
  userId: varchar('user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  collegeId: varchar('college_id', { length: 36 }).references(() => colleges.id),
  departmentId: varchar('department_id', { length: 36 }).references(() => departments.id),
  yearOfStudy: int('year_of_study'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', fsp: 3 }).notNull().defaultNow().onUpdateNow(),
});

export const userRoles = mysqlTable('user_roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 64 }).notNull(), // ADMIN, ORGANIZER, SCANNER, PAYMENT_REVIEWER, PARTICIPANT
  eventScopeId: varchar('event_scope_id', { length: 36 }),
  grantedAt: timestamp('granted_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  grantedBy: varchar('granted_by', { length: 36 }),
}, (table) => ({
  userRoleScopeIdx: uniqueIndex('user_role_scope_idx').on(table.userId, table.role, table.eventScopeId),
}));

// ==========================================
// 3. PROGRESSION DOMAIN
// ==========================================

export const characters = mysqlTable('characters', {
  userId: varchar('user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  playerName: varchar('player_name', { length: 64 }).notNull().unique(),
  totalXp: bigint('total_xp', { mode: 'number' }).notNull().default(0),
  levelId: varchar('level_id', { length: 36 }),
  avatarAssetId: varchar('avatar_asset_id', { length: 255 }),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', fsp: 3 }).notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  xpRankIdx: index('xp_rank_idx').on(table.totalXp, table.createdAt),
}));

export const levels = mysqlTable('levels', {
  id: varchar('id', { length: 36 }).primaryKey(),
  levelNumber: int('level_number').notNull().unique(),
  title: varchar('title', { length: 128 }).notNull(),
  minXp: bigint('min_xp', { mode: 'number' }).notNull(),
  badgeUrl: text('badge_url'),
});

export const xpLedger = mysqlTable('xp_ledger', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: int('amount').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  sourceType: varchar('source_type', { length: 64 }).notNull(), // ATTENDANCE, EVENT_WIN, ACHIEVEMENT
  sourceId: varchar('source_id', { length: 128 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  awardedBy: varchar('awarded_by', { length: 36 }),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  idempotencyIdx: uniqueIndex('source_idempotency_idx').on(table.sourceType, table.sourceId, table.userId),
  userLedgerIdx: index('user_ledger_idx').on(table.userId, table.createdAt),
}));

export const achievements = mysqlTable('achievements', {
  id: varchar('id', { length: 36 }).primaryKey(),
  key: varchar('key', { length: 64 }).notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  xpReward: int('xp_reward').notNull().default(0),
  badgeAssetUrl: text('badge_asset_url'),
});

export const userAchievements = mysqlTable('user_achievements', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  achievementId: varchar('achievement_id', { length: 36 }).notNull().references(() => achievements.id),
  seen: boolean('seen').notNull().default(false),
  grantedAt: timestamp('granted_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  userAchievementIdx: uniqueIndex('user_achievement_idx').on(table.userId, table.achievementId),
  userSeenIdx: index('user_achievement_seen_idx').on(table.userId, table.seen),
}));

// ==========================================
// 4. EVENTS DOMAIN
// ==========================================

export const eventCategories = mysqlTable('event_categories', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  description: text('description'),
});

export const events = mysqlTable('events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  categoryId: varchar('category_id', { length: 36 }).notNull().references(() => eventCategories.id),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  venue: varchar('venue', { length: 255 }),
  startsAt: timestamp('starts_at', { mode: 'string', fsp: 3 }).notNull(),
  endsAt: timestamp('ends_at', { mode: 'string', fsp: 3 }).notNull(),
  capacity: int('capacity').notNull(),
  isTeamEvent: boolean('is_team_event').notNull().default(false),
  minTeamSize: int('min_team_size').default(1),
  maxTeamSize: int('max_team_size').default(1),
  status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // DRAFT, OPEN, CLOSED, COMPLETED
  paymentRequired: boolean('payment_required').notNull().default(false),
  feeAmount: int('fee_amount').default(0),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', fsp: 3 }).notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  eventStatusDateIdx: index('event_status_date_idx').on(table.status, table.startsAt),
}));

export const eventOrganizers = mysqlTable('event_organizers', {
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.eventId, table.userId] }),
}));

export const scheduleSlots = mysqlTable('schedule_slots', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  roundName: varchar('round_name', { length: 128 }).notNull(),
  venue: varchar('venue', { length: 255 }),
  startsAt: timestamp('starts_at', { mode: 'string', fsp: 3 }).notNull(),
  endsAt: timestamp('ends_at', { mode: 'string', fsp: 3 }).notNull(),
});

export const announcements = mysqlTable('announcements', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).references(() => events.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  targetAudience: varchar('target_audience', { length: 64 }).notNull().default('ALL'), // ALL, PARTICIPANTS, ORGANIZERS
  publishedAt: timestamp('published_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { mode: 'string', fsp: 3 }),
}, (table) => ({
  publishedIdx: index('announcement_published_idx').on(table.publishedAt),
}));

// ==========================================
// 5. PARTICIPATION DOMAIN
// ==========================================

export const teams = mysqlTable('teams', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  joinCode: varchar('join_code', { length: 32 }).notNull().unique(),
  leaderUserId: varchar('leader_user_id', { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
});

export const teamMembers = mysqlTable('team_members', {
  teamId: varchar('team_id', { length: 36 }).notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 32 }).notNull().default('MEMBER'), // LEADER, MEMBER
  joinedAt: timestamp('joined_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamId, table.userId] }),
}));

export const registrations = mysqlTable('registrations', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  teamId: varchar('team_id', { length: 36 }).references(() => teams.id),
  status: varchar('status', { length: 32 }).notNull().default('CONFIRMED'), // CONFIRMED, WAITLISTED, CANCELLED
  paymentStatus: varchar('payment_status', { length: 32 }).notNull().default('NOT_REQUIRED'), // NOT_REQUIRED, PENDING, VERIFIED, REJECTED
  registeredAt: timestamp('registered_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  eventUserIdx: uniqueIndex('event_user_reg_idx').on(table.eventId, table.userId),
  eventStatusIdx: index('reg_event_status_idx').on(table.eventId, table.status),
  userRegIdx: index('user_reg_date_idx').on(table.userId, table.registeredAt),
}));

export const attendance = mysqlTable('attendance', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  scannedBy: varchar('scanned_by', { length: 36 }).notNull(),
  method: varchar('method', { length: 32 }).notNull().default('QR'), // QR, MANUAL
  checkedInAt: timestamp('checked_in_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  eventUserCheckinIdx: uniqueIndex('attendance_event_user_idx').on(table.eventId, table.userId),
  eventCheckinIdx: index('attendance_event_date_idx').on(table.eventId, table.checkedInAt),
}));

export const checkinTokenRedemptions = mysqlTable('checkin_token_redemptions', {
  jti: varchar('jti', { length: 128 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  redeemedAt: timestamp('redeemed_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
});

// ==========================================
// 6. PLATFORM DOMAIN
// ==========================================

export const paymentReceipts = mysqlTable('payment_receipts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  registrationId: varchar('registration_id', { length: 36 }).notNull().references(() => registrations.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  storageKey: varchar('storage_key', { length: 512 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('SUBMITTED'), // SUBMITTED, VERIFIED, REJECTED
  reviewerUserId: varchar('reviewer_user_id', { length: 36 }),
  rejectionReason: text('rejection_reason'),
  submittedAt: timestamp('submitted_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { mode: 'string', fsp: 3 }),
}, (table) => ({
  statusDateIdx: index('payment_receipt_status_idx').on(table.status, table.submittedAt),
}));

export const auditLog = mysqlTable('audit_log', {
  id: varchar('id', { length: 36 }).primaryKey(),
  actorUserId: varchar('actor_user_id', { length: 36 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: varchar('target_id', { length: 128 }).notNull(),
  correlationId: varchar('correlation_id', { length: 128 }),
  metadata: text('metadata'), // JSON string
  createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  actorIdx: index('audit_actor_idx').on(table.actorUserId, table.createdAt),
  actionIdx: index('audit_action_idx').on(table.action, table.createdAt),
}));

export const sponsors = mysqlTable('sponsors', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  tier: varchar('tier', { length: 64 }).notNull().default('PARTNER'),
  active: boolean('active').notNull().default(true),
});

export const certificates = mysqlTable('certificates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 36 }).notNull().references(() => events.id),
  type: varchar('type', { length: 64 }).notNull(), // PARTICIPATION, WINNER, RUNNER_UP
  certificateUrl: text('certificate_url').notNull(),
  issuedAt: timestamp('issued_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
}, (table) => ({
  userEventCertIdx: uniqueIndex('user_event_cert_idx').on(table.userId, table.eventId, table.type),
}));
