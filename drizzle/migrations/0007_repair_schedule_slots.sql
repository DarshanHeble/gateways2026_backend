-- The legacy database is missing the schedule table used by the canonical
-- event seed. Create it without touching any existing tables or rows.
CREATE TABLE IF NOT EXISTS `schedule_slots` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`round_name` varchar(128) NOT NULL,
	`venue` varchar(255),
	`starts_at` timestamp(3) NOT NULL,
	`ends_at` timestamp(3) NOT NULL,
	CONSTRAINT `schedule_slots_id` PRIMARY KEY(`id`)
);
