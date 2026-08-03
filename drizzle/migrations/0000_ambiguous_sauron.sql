CREATE TABLE `accounts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` varchar(255) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_account_id` varchar(255) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` bigint,
	`token_type` varchar(255),
	`scope` varchar(255),
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_providerAccountId_idx` UNIQUE(`provider`,`provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` varchar(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`xp_reward` int NOT NULL DEFAULT 0,
	`badge_asset_url` text,
	CONSTRAINT `achievements_id` PRIMARY KEY(`id`),
	CONSTRAINT `achievements_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36),
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`target_audience` varchar(64) NOT NULL DEFAULT 'ALL',
	`published_at` timestamp(3) NOT NULL DEFAULT (now()),
	`archived_at` timestamp(3),
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`scanned_by` varchar(36) NOT NULL,
	`method` varchar(32) NOT NULL DEFAULT 'QR',
	`checked_in_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_event_user_idx` UNIQUE(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`actor_user_id` varchar(36) NOT NULL,
	`action` varchar(128) NOT NULL,
	`target_type` varchar(64) NOT NULL,
	`target_id` varchar(128) NOT NULL,
	`correlation_id` varchar(128),
	`metadata` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`certificate_url` text NOT NULL,
	`issued_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_event_cert_idx` UNIQUE(`user_id`,`event_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`user_id` varchar(36) NOT NULL,
	`player_name` varchar(64) NOT NULL,
	`total_xp` bigint NOT NULL DEFAULT 0,
	`level_id` varchar(36),
	`avatar_asset_id` varchar(255),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `characters_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `characters_player_name_unique` UNIQUE(`player_name`)
);
--> statement-breakpoint
CREATE TABLE `checkin_token_redemptions` (
	`jti` varchar(128) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`redeemed_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `checkin_token_redemptions_jti` PRIMARY KEY(`jti`)
);
--> statement-breakpoint
CREATE TABLE `colleges` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `colleges_id` PRIMARY KEY(`id`),
	CONSTRAINT `colleges_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` varchar(36) NOT NULL,
	`college_id` varchar(36),
	`name` varchar(255) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_categories` (
	`id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`description` text,
	CONSTRAINT `event_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `event_organizers` (
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT `event_organizers_event_id_user_id_pk` PRIMARY KEY(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` varchar(36) NOT NULL,
	`category_id` varchar(36) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`venue` varchar(255),
	`starts_at` timestamp(3) NOT NULL,
	`ends_at` timestamp(3) NOT NULL,
	`capacity` int NOT NULL,
	`is_team_event` boolean NOT NULL DEFAULT false,
	`min_team_size` int DEFAULT 1,
	`max_team_size` int DEFAULT 1,
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`payment_required` boolean NOT NULL DEFAULT false,
	`fee_amount` int DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `levels` (
	`id` varchar(36) NOT NULL,
	`level_number` int NOT NULL,
	`title` varchar(128) NOT NULL,
	`min_xp` bigint NOT NULL,
	`badge_url` text,
	CONSTRAINT `levels_id` PRIMARY KEY(`id`),
	CONSTRAINT `levels_level_number_unique` UNIQUE(`level_number`)
);
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` varchar(36) NOT NULL,
	`registration_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'SUBMITTED',
	`reviewer_user_id` varchar(36),
	`rejection_reason` text,
	`submitted_at` timestamp(3) NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp(3),
	CONSTRAINT `payment_receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` varchar(36) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`phone` varchar(32),
	`college_id` varchar(36),
	`department_id` varchar(36),
	`year_of_study` int,
	`bio` text,
	`avatar_url` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `profiles_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `registrations` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`team_id` varchar(36),
	`status` varchar(32) NOT NULL DEFAULT 'CONFIRMED',
	`payment_status` varchar(32) NOT NULL DEFAULT 'NOT_REQUIRED',
	`registered_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_user_reg_idx` UNIQUE(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_slots` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`round_name` varchar(128) NOT NULL,
	`venue` varchar(255),
	`starts_at` timestamp(3) NOT NULL,
	`ends_at` timestamp(3) NOT NULL,
	CONSTRAINT `schedule_slots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`session_token` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires` timestamp(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_session_token_unique` UNIQUE(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `sponsors` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`logo_url` text,
	`website_url` text,
	`tier` varchar(64) NOT NULL DEFAULT 'PARTNER',
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `sponsors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`team_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'MEMBER',
	`joined_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `team_members_team_id_user_id_pk` PRIMARY KEY(`team_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`join_code` varchar(32) NOT NULL,
	`leader_user_id` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `teams_join_code_unique` UNIQUE(`join_code`)
);
--> statement-breakpoint
CREATE TABLE `user_achievements` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`achievement_id` varchar(36) NOT NULL,
	`seen` boolean NOT NULL DEFAULT false,
	`granted_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `user_achievements_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_achievement_idx` UNIQUE(`user_id`,`achievement_id`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(64) NOT NULL,
	`event_scope_id` varchar(36),
	`granted_at` timestamp(3) NOT NULL DEFAULT (now()),
	`granted_by` varchar(36),
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_role_scope_idx` UNIQUE(`user_id`,`role`,`event_scope_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255),
	`status` varchar(32) NOT NULL DEFAULT 'ACTIVE',
	`email_verified` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires` timestamp(3) NOT NULL,
	`purpose` varchar(64) NOT NULL DEFAULT 'EMAIL_VERIFICATION',
	CONSTRAINT `verification_tokens_identifier_token_pk` PRIMARY KEY(`identifier`,`token`),
	CONSTRAINT `verification_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `xp_ledger` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`amount` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`source_type` varchar(64) NOT NULL,
	`source_id` varchar(128) NOT NULL,
	`idempotency_key` varchar(128) NOT NULL,
	`awarded_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `xp_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_idempotency_idx` UNIQUE(`source_type`,`source_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `characters` ADD CONSTRAINT `characters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_college_id_colleges_id_fk` FOREIGN KEY (`college_id`) REFERENCES `colleges`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_organizers` ADD CONSTRAINT `event_organizers_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_organizers` ADD CONSTRAINT `event_organizers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_category_id_event_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `event_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipts_registration_id_registrations_id_fk` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_college_id_colleges_id_fk` FOREIGN KEY (`college_id`) REFERENCES `colleges`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_department_id_departments_id_fk` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_slots` ADD CONSTRAINT `schedule_slots_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_leader_user_id_users_id_fk` FOREIGN KEY (`leader_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_achievement_id_achievements_id_fk` FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `xp_ledger` ADD CONSTRAINT `xp_ledger_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `announcement_published_idx` ON `announcements` (`published_at`);--> statement-breakpoint
CREATE INDEX `attendance_event_date_idx` ON `attendance` (`event_id`,`checked_in_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_log` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `xp_rank_idx` ON `characters` (`total_xp`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_status_date_idx` ON `events` (`status`,`starts_at`);--> statement-breakpoint
CREATE INDEX `payment_receipt_status_idx` ON `payment_receipts` (`status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `reg_event_status_idx` ON `registrations` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `user_reg_date_idx` ON `registrations` (`user_id`,`registered_at`);--> statement-breakpoint
CREATE INDEX `user_achievement_seen_idx` ON `user_achievements` (`user_id`,`seen`);--> statement-breakpoint
CREATE INDEX `user_ledger_idx` ON `xp_ledger` (`user_id`,`created_at`);