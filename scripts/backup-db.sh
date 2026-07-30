#!/bin/sh
# Nightly Postgres backup for a Dockerised Protessera instance.
#
# Install on the host:
#   chmod +x scripts/backup-db.sh
#   crontab -e   →   15 2 * * * /path/to/erpsystem/scripts/backup-db.sh
#
# Keeps BACKUP_KEEP_DAYS (default 30) of gzipped dumps in ./backups.
#
# pg_dump runs inside the database container, so the dump is transactionally
# consistent even while the app is writing. --clean --if-exists makes it
# restorable over an existing database, which is what a real recovery looks like.
#
# WHY THIS VERIFIES ITSELF: a backup script that silently writes an empty file is
# worse than no backup script, because it buys false confidence for months and
# then fails on the one day it matters. This checks the dump is a real dump of
# THIS application and exits non-zero otherwise, so cron mails you the failure
# instead of leaving a plausible-looking file behind.
set -eu

# Database container, role, and database. Defaults match docker-compose.yml.
PG_CONTAINER="${PG_CONTAINER:-forgeerp-postgres}"
PG_USER="${PG_USER:-forgeerp}"
PG_DB="${PG_DB:-forgeerp}"

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/protessera-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "backup-db: container '$PG_CONTAINER' is not running" >&2
  exit 1
fi

# Write under a .partial name first, so an interrupted run never leaves a file
# that looks like a finished backup.
TMP="$OUT.partial"
docker exec "$PG_CONTAINER" \
  pg_dump --username "$PG_USER" --dbname "$PG_DB" --clean --if-exists \
  | gzip -9 > "$TMP"

# ── verify before trusting it ────────────────────────────────────────────
SIZE=$(wc -c < "$TMP" | tr -d ' ')
if [ "$SIZE" -lt 1024 ]; then
  echo "backup-db: dump is only ${SIZE} bytes — treating as failed" >&2
  rm -f "$TMP"
  exit 1
fi

if ! gzip -t "$TMP" 2>/dev/null; then
  echo "backup-db: dump failed its gzip integrity check" >&2
  rm -f "$TMP"
  exit 1
fi

# A marker proving this is this application's schema, not a well-formed dump of
# an empty or wrong database.
if ! gzip -dc "$TMP" | grep -q 'CREATE TABLE public."AuditLog"'; then
  echo "backup-db: dump does not contain the expected schema — refusing it" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"

# Retention. Only ever matches files this script named.
find "$BACKUP_DIR" -name 'protessera-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "backup-db: wrote $OUT ($(awk -v b="$SIZE" 'BEGIN{printf "%.1f MB", b/1048576}'))"
