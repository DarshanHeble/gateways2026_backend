CREATE TABLE IF NOT EXISTS `event_categories` (
	`id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`description` text,
	CONSTRAINT `event_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_categories_slug_unique` UNIQUE(`slug`)
);
