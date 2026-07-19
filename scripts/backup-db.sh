#!/bin/sh
# Nightly SQLite backup for a Dockerized ForgeRP instance.
#
# Install on the host:
#   chmod +x scripts/backup-db.sh
#   crontab -e   →   15 2 * * * /path/to/erpsystem/scripts/backup-db.sh
#
# Keeps 30 days of backups in ./backups (override with BACKUP_DIR).
# Uses sqlite3's .backup through the container for a consistent copy even
# while the app is writing.
set -eu

CONTAINER="${CONTAINER:-forgerp}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
STAMP="$(date +%F)"

mkdir -p "$BACKUP_DIR"

# Consistent online copy inside the container, then pull it out
docker exec "$CONTAINER" sh -c \
  "node -e \"require('better-sqlite3')('/data/forgerp.db').backup('/data/backup-$STAMP.db').then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})\""
docker cp "$CONTAINER:/data/backup-$STAMP.db" "$BACKUP_DIR/forgerp-$STAMP.db"
docker exec "$CONTAINER" rm -f "/data/backup-$STAMP.db"

# Retention: 30 days
find "$BACKUP_DIR" -name 'forgerp-*.db' -mtime +30 -delete

echo "Backed up to $BACKUP_DIR/forgerp-$STAMP.db"
