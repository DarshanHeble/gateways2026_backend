-- Give every existing account a default character before the website removes
-- the interactive character-builder route. Generated names are deterministic
-- from the user id and therefore do not collide with another account.
INSERT INTO `characters` (`user_id`, `player_name`, `total_xp`, `avatar_asset_id`)
SELECT
  u.`id`,
  CONCAT('Player_', REPLACE(u.`id`, '-', '')),
  0,
  'prospector'
FROM `users` u
LEFT JOIN `characters` c ON c.`user_id` = u.`id`
WHERE c.`user_id` IS NULL;
