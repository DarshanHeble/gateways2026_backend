-- Initialize privileged writer user alongside app_user
CREATE USER IF NOT EXISTS 'writer_user'@'%' IDENTIFIED BY 'writer_password';
GRANT ALL PRIVILEGES ON gateways2026_db.* TO 'writer_user'@'%';
GRANT ALL PRIVILEGES ON gateways2026_db.* TO 'app_user'@'%';
FLUSH PRIVILEGES;
