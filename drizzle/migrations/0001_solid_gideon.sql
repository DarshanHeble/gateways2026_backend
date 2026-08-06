DROP TABLE `achievements`;--> statement-breakpoint
DROP TABLE `announcements`;--> statement-breakpoint
DROP TABLE `attendance`;--> statement-breakpoint
DROP TABLE `certificates`;--> statement-breakpoint
DROP TABLE `characters`;--> statement-breakpoint
DROP TABLE `checkin_token_redemptions`;--> statement-breakpoint
DROP TABLE `colleges`;--> statement-breakpoint
DROP TABLE `departments`;--> statement-breakpoint
DROP TABLE `event_categories`;--> statement-breakpoint
DROP TABLE `event_organizers`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
DROP TABLE `levels`;--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
DROP TABLE `registrations`;--> statement-breakpoint
DROP TABLE `schedule_slots`;--> statement-breakpoint
DROP TABLE `sponsors`;--> statement-breakpoint
DROP TABLE `team_members`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
DROP TABLE `user_achievements`;--> statement-breakpoint
ALTER TABLE `payment_receipts` DROP FOREIGN KEY `payment_receipts_registration_id_registrations_id_fk`;
--> statement-breakpoint
DROP INDEX `audit_actor_idx` ON `audit_log`;--> statement-breakpoint
DROP INDEX `audit_action_idx` ON `audit_log`;--> statement-breakpoint
DROP INDEX `payment_receipt_status_idx` ON `payment_receipts`;--> statement-breakpoint
DROP INDEX `user_ledger_idx` ON `xp_ledger`;--> statement-breakpoint
ALTER TABLE `payment_receipts` MODIFY COLUMN `status` varchar(32) NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `cloudinary_public_id` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `file_url` text NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `file_name` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `file_size_bytes` int NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `reviewed_by` varchar(36);--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipts_user_id_unique` UNIQUE(`user_id`);--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipts_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipts` DROP COLUMN `registration_id`;--> statement-breakpoint
ALTER TABLE `payment_receipts` DROP COLUMN `storage_key`;--> statement-breakpoint
ALTER TABLE `payment_receipts` DROP COLUMN `reviewer_user_id`;