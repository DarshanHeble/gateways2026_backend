-- Adds the ORGANIZER visibility key to audit_log.
--
-- event_id is populated at write time by the call sites that already know the
-- event. It is deliberately not derived on read: inferring an event from
-- target_type would require a correlated join per row type, and is ambiguous for
-- payment_receipt (one-to-many via registrations). NULL means "not event-scoped"
-- (sign-ins, role grants, profile edits) and those rows stay ADMIN-only.
--
-- No foreign key, matching actor_user_id: audit rows must outlive the things
-- they reference.
ALTER TABLE `audit_log` ADD COLUMN `event_id` varchar(36);
--> statement-breakpoint
-- (event_id, id) rather than (event_id, created_at): reads order and paginate on
-- the uuidv7 primary key, so this index covers the ORGANIZER-scoped query end to
-- end without a filesort.
CREATE INDEX `audit_event_idx` ON `audit_log` (`event_id`,`id`);
