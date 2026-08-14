-- The live events table predates the current schema. Add only columns that
-- are missing so existing event rows and dependent registrations are kept.
SET @codex_add_category_id = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'category_id') = 0,
  'ALTER TABLE events ADD COLUMN category_id varchar(36) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_category_id_stmt FROM @codex_add_category_id;
--> statement-breakpoint
EXECUTE codex_add_category_id_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_category_id_stmt;
--> statement-breakpoint
SET @codex_add_slug = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'slug') = 0,
  'ALTER TABLE events ADD COLUMN slug varchar(128) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_slug_stmt FROM @codex_add_slug;
--> statement-breakpoint
EXECUTE codex_add_slug_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_slug_stmt;
--> statement-breakpoint
SET @codex_add_title = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'title') = 0,
  'ALTER TABLE events ADD COLUMN title varchar(255) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_title_stmt FROM @codex_add_title;
--> statement-breakpoint
EXECUTE codex_add_title_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_title_stmt;
--> statement-breakpoint
SET @codex_add_description = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'description') = 0,
  'ALTER TABLE events ADD COLUMN description text NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_description_stmt FROM @codex_add_description;
--> statement-breakpoint
EXECUTE codex_add_description_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_description_stmt;
--> statement-breakpoint
SET @codex_add_venue = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'venue') = 0,
  'ALTER TABLE events ADD COLUMN venue varchar(255) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_venue_stmt FROM @codex_add_venue;
--> statement-breakpoint
EXECUTE codex_add_venue_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_venue_stmt;
--> statement-breakpoint
SET @codex_add_starts_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'starts_at') = 0,
  'ALTER TABLE events ADD COLUMN starts_at timestamp(3) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_starts_at_stmt FROM @codex_add_starts_at;
--> statement-breakpoint
EXECUTE codex_add_starts_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_starts_at_stmt;
--> statement-breakpoint
SET @codex_add_ends_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'ends_at') = 0,
  'ALTER TABLE events ADD COLUMN ends_at timestamp(3) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_ends_at_stmt FROM @codex_add_ends_at;
--> statement-breakpoint
EXECUTE codex_add_ends_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_ends_at_stmt;
--> statement-breakpoint
SET @codex_add_capacity = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'capacity') = 0,
  'ALTER TABLE events ADD COLUMN capacity int NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_capacity_stmt FROM @codex_add_capacity;
--> statement-breakpoint
EXECUTE codex_add_capacity_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_capacity_stmt;
--> statement-breakpoint
SET @codex_add_is_team_event = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'is_team_event') = 0,
  'ALTER TABLE events ADD COLUMN is_team_event boolean NOT NULL DEFAULT false',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_is_team_event_stmt FROM @codex_add_is_team_event;
--> statement-breakpoint
EXECUTE codex_add_is_team_event_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_is_team_event_stmt;
--> statement-breakpoint
SET @codex_add_min_team_size = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'min_team_size') = 0,
  'ALTER TABLE events ADD COLUMN min_team_size int NULL DEFAULT 1',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_min_team_size_stmt FROM @codex_add_min_team_size;
--> statement-breakpoint
EXECUTE codex_add_min_team_size_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_min_team_size_stmt;
--> statement-breakpoint
SET @codex_add_max_team_size = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'max_team_size') = 0,
  'ALTER TABLE events ADD COLUMN max_team_size int NULL DEFAULT 1',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_max_team_size_stmt FROM @codex_add_max_team_size;
--> statement-breakpoint
EXECUTE codex_add_max_team_size_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_max_team_size_stmt;
--> statement-breakpoint
SET @codex_add_status = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'status') = 0,
  'ALTER TABLE events ADD COLUMN status varchar(32) NOT NULL DEFAULT ''published''',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_status_stmt FROM @codex_add_status;
--> statement-breakpoint
EXECUTE codex_add_status_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_status_stmt;
--> statement-breakpoint
SET @codex_add_payment_required = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'payment_required') = 0,
  'ALTER TABLE events ADD COLUMN payment_required boolean NOT NULL DEFAULT true',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_payment_required_stmt FROM @codex_add_payment_required;
--> statement-breakpoint
EXECUTE codex_add_payment_required_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_payment_required_stmt;
--> statement-breakpoint
SET @codex_add_fee_amount = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'fee_amount') = 0,
  'ALTER TABLE events ADD COLUMN fee_amount int NULL DEFAULT 0',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_fee_amount_stmt FROM @codex_add_fee_amount;
--> statement-breakpoint
EXECUTE codex_add_fee_amount_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_fee_amount_stmt;
--> statement-breakpoint
SET @codex_add_registration_opens_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'registration_opens_at') = 0,
  'ALTER TABLE events ADD COLUMN registration_opens_at timestamp(3) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_registration_opens_at_stmt FROM @codex_add_registration_opens_at;
--> statement-breakpoint
EXECUTE codex_add_registration_opens_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_registration_opens_at_stmt;
--> statement-breakpoint
SET @codex_add_registration_closes_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'registration_closes_at') = 0,
  'ALTER TABLE events ADD COLUMN registration_closes_at timestamp(3) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_registration_closes_at_stmt FROM @codex_add_registration_closes_at;
--> statement-breakpoint
EXECUTE codex_add_registration_closes_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_registration_closes_at_stmt;
--> statement-breakpoint
SET @codex_add_xp_reward = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'xp_reward') = 0,
  'ALTER TABLE events ADD COLUMN xp_reward int NOT NULL DEFAULT 0',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_xp_reward_stmt FROM @codex_add_xp_reward;
--> statement-breakpoint
EXECUTE codex_add_xp_reward_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_xp_reward_stmt;
--> statement-breakpoint
SET @codex_add_requires_approval = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'requires_approval') = 0,
  'ALTER TABLE events ADD COLUMN requires_approval boolean NOT NULL DEFAULT false',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_requires_approval_stmt FROM @codex_add_requires_approval;
--> statement-breakpoint
EXECUTE codex_add_requires_approval_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_requires_approval_stmt;
--> statement-breakpoint
SET @codex_add_contact_email = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'contact_email') = 0,
  'ALTER TABLE events ADD COLUMN contact_email varchar(255) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_contact_email_stmt FROM @codex_add_contact_email;
--> statement-breakpoint
EXECUTE codex_add_contact_email_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_contact_email_stmt;
--> statement-breakpoint
SET @codex_add_created_by = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'created_by') = 0,
  'ALTER TABLE events ADD COLUMN created_by varchar(36) NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_created_by_stmt FROM @codex_add_created_by;
--> statement-breakpoint
EXECUTE codex_add_created_by_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_created_by_stmt;
--> statement-breakpoint
SET @codex_add_created_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'created_at') = 0,
  'ALTER TABLE events ADD COLUMN created_at timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_created_at_stmt FROM @codex_add_created_at;
--> statement-breakpoint
EXECUTE codex_add_created_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_created_at_stmt;
--> statement-breakpoint
SET @codex_add_updated_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'events'
     AND column_name = 'updated_at') = 0,
  'ALTER TABLE events ADD COLUMN updated_at timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE codex_add_updated_at_stmt FROM @codex_add_updated_at;
--> statement-breakpoint
EXECUTE codex_add_updated_at_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE codex_add_updated_at_stmt;
