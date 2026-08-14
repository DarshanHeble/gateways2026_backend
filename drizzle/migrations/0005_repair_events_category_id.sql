-- Legacy deployments may have an events table without the category relation.
-- Keep this nullable so existing legacy rows remain valid; canonical seed rows
-- provide their category_id explicitly.
ALTER TABLE `events`
  ADD COLUMN `category_id` varchar(36) NULL;
