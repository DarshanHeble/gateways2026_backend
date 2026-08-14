-- Gateways 2026 core registration/RBAC migration.
-- This is intentionally forward-only. Review this file before applying it to
-- any environment; do not replace it with drizzle-kit push because the legacy
-- database contains tables that are not part of the original schema barrel.

ALTER TABLE `users`
  ADD COLUMN `must_change_password` boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE `profiles`
  ADD COLUMN `participant_code` varchar(32),
  ADD COLUMN `gender` varchar(16),
  ADD COLUMN `date_of_birth` varchar(10),
  ADD COLUMN `category` varchar(32),
  ADD COLUMN `tshirt_size` varchar(8),
  ADD COLUMN `emergency_name` varchar(255),
  ADD COLUMN `emergency_phone` varchar(32),
  ADD COLUMN `dietary_pref` varchar(16),
  ADD COLUMN `is_banned` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_participant_code_unique` UNIQUE(`participant_code`);
--> statement-breakpoint

ALTER TABLE `characters`
  ADD COLUMN `college_id` varchar(36),
  ADD COLUMN `department_id` varchar(36),
  ADD COLUMN `year_of_study` int,
  ADD COLUMN `bio` text;
--> statement-breakpoint

ALTER TABLE `events`
  MODIFY COLUMN `capacity` int NULL,
  ADD COLUMN `registration_opens_at` timestamp(3) NULL,
  ADD COLUMN `registration_closes_at` timestamp(3) NULL,
  ADD COLUMN `xp_reward` int NOT NULL DEFAULT 0,
  ADD COLUMN `requires_approval` boolean NOT NULL DEFAULT false,
  ADD COLUMN `contact_email` varchar(255) NULL,
  ADD COLUMN `created_by` varchar(36) NULL;
--> statement-breakpoint

ALTER TABLE `registrations`
  ADD COLUMN `code` varchar(32) NULL,
  ADD COLUMN `source` varchar(32) NOT NULL DEFAULT 'online',
  ADD COLUMN `notes` text NULL,
  ADD COLUMN `override_actor_id` varchar(36) NULL,
  ADD COLUMN `override_reason` text NULL,
  ADD COLUMN `override_at` timestamp(3) NULL,
  ADD COLUMN `confirmed_at` timestamp(3) NULL,
  ADD COLUMN `cancelled_at` timestamp(3) NULL,
  ADD COLUMN `waitlist_position` int NULL;
--> statement-breakpoint
UPDATE `registrations` SET `code` = CONCAT('GWS26-', UPPER(SUBSTRING(`id`, 1, 8))) WHERE `code` IS NULL;
--> statement-breakpoint
ALTER TABLE `registrations` MODIFY COLUMN `code` varchar(32) NOT NULL;
--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_code_unique` UNIQUE(`code`);
--> statement-breakpoint

ALTER TABLE `teams` ADD COLUMN `is_locked` boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE `payment_receipts`
  ADD COLUMN `amount_inr` int NOT NULL DEFAULT 250,
  ADD COLUMN `payment_method` varchar(32) NULL,
  ADD COLUMN `transaction_reference` varchar(128) NULL;
--> statement-breakpoint
-- Normalize legacy enum spellings before application code starts treating the
-- receipt state as a lowercase value. This keeps existing receipts visible in
-- the review queue instead of silently treating SUBMITTED/APPROVED rows as an
-- unknown status.
UPDATE `payment_receipts`
SET `status` = CASE UPPER(`status`)
  WHEN 'SUBMITTED' THEN 'pending'
  WHEN 'PENDING' THEN 'pending'
  WHEN 'APPROVED' THEN 'verified'
  WHEN 'VERIFIED' THEN 'verified'
  WHEN 'REJECTED' THEN 'rejected'
  ELSE LOWER(`status`)
END;
--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipt_transaction_reference_unique` UNIQUE(`transaction_reference`);
--> statement-breakpoint

CREATE TABLE `console_handoffs` (
  `id` varchar(36) NOT NULL,
  `code_hash` varchar(128) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `target` varchar(64) NOT NULL DEFAULT 'registration-console',
  `return_to` varchar(255) NOT NULL DEFAULT '/',
  `expires_at` timestamp(3) NOT NULL,
  `consumed_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT (now()),
  CONSTRAINT `console_handoffs_id` PRIMARY KEY(`id`),
  CONSTRAINT `console_handoffs_code_hash_unique` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE INDEX `console_handoffs_expiry_idx` ON `console_handoffs` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `user_roles`
  ADD CONSTRAINT `user_roles_event_scope_events_fk`
  FOREIGN KEY (`event_scope_id`) REFERENCES `events`(`id`)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
