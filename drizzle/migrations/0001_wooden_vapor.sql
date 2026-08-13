ALTER TABLE `payment_receipts` DROP FOREIGN KEY `payment_receipts_registration_id_registrations_id_fk`;
--> statement-breakpoint
ALTER TABLE `payment_receipts` MODIFY COLUMN `status` varchar(32) NOT NULL DEFAULT 'pending';--> statement-breakpoint
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