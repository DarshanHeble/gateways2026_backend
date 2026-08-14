#!/usr/bin/env bash
set -e

echo "=== Gateways 2026 Local Database Setup Script ==="

# Check if MariaDB/MySQL is installed
if ! command -v mariadb &> /dev/null && ! command -v mysql &> /dev/null; then
    echo "⚠️ MariaDB/MySQL is not installed."
    echo "Please run: sudo pacman -S mariadb && sudo mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql"
    exit 1
fi

# Ensure MariaDB service is running
echo "Starting MariaDB service..."
sudo systemctl enable --now mariadb

DB_NAME="gateways2026_db"
APP_USER="app_user"
APP_PASS="app_password"
WRITER_USER="writer_user"
WRITER_PASS="writer_password"

echo "Setting up database '$DB_NAME' and dual roles ($APP_USER & $WRITER_USER)..."

sudo mariadb -e "
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create App User (Standard least-privilege role)
CREATE USER IF NOT EXISTS '${APP_USER}'@'localhost' IDENTIFIED BY '${APP_PASS}';
CREATE USER IF NOT EXISTS '${APP_USER}'@'127.0.0.1' IDENTIFIED BY '${APP_PASS}';

-- Create Writer User (Privileged server-only role)
CREATE USER IF NOT EXISTS '${WRITER_USER}'@'localhost' IDENTIFIED BY '${WRITER_PASS}';
CREATE USER IF NOT EXISTS '${WRITER_USER}'@'127.0.0.1' IDENTIFIED BY '${WRITER_PASS}';

-- Grant App User permissions on non-privileged tables
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${APP_USER}'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${APP_USER}'@'127.0.0.1';

-- Grant Writer User full permissions for privileged writes & audit
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${WRITER_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${WRITER_USER}'@'127.0.0.1';

FLUSH PRIVILEGES;
"

echo "✅ Database '$DB_NAME' and credentials configured successfully!"
