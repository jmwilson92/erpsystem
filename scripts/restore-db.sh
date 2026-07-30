#!/bin/sh
# Restore a Protessera Postgres backup produced by scripts/backup-db.sh.
#
#   ./scripts/restore-db.sh backups/protessera-2026-07-30-0215.sql.gz
#
# An untested backup is a hope, not a backup. Run this against a scratch stack
# once before you need it — that rehearsal is the only thing that turns the
# nightly cron into an actual recovery plan.
#
# Refuses to overwrite a database that already holds data unless you pass
# --force, because the realistic way to lose everything is restoring last
# month's dump over a working system at 2am.
set -eu

PG_CONTAINER="${PG_CONTAINER:-forgeerp-postgres}"
PG_USER="${PG_USER:-forgeerp}"
PG_DB="${PG_DB:-forgeerp}"
APP_CONTAINER="${APP_CONTAINER:-forgerp}"

FORCE=0
DUMP=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) DUMP="$arg" ;;
  esac
done

if [ -z "$DUMP" ]; then
  echo "usage: $0 <backup.sql.gz> [--force]" >&2
  exit 1
fi
if [ ! -f "$DUMP" ]; then
  echo "restore-db: no such file: $DUMP" >&2
  exit 1
fi

# Validate the dump BEFORE touching the database. Discovering the archive is
# truncated after dropping the schema is the worst possible ordering.
if ! gzip -t "$DUMP" 2>/dev/null; then
  echo "restore-db: $DUMP failed its gzip integrity check — not restoring" >&2
  exit 1
fi
if ! gzip -dc "$DUMP" | grep -q 'CREATE TABLE public."AuditLog"'; then
  echo "restore-db: $DUMP does not look like a Protessera dump — not restoring" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "restore-db: container '$PG_CONTAINER' is not running" >&2
  exit 1
fi

EXISTING=$(docker exec "$PG_CONTAINER" psql --username "$PG_USER" --dbname "$PG_DB" \
  -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
if [ "${EXISTING:-0}" -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  echo "restore-db: '$PG_DB' already has $EXISTING tables in public." >&2
  echo "            Re-run with --force to overwrite them." >&2
  exit 1
fi

# Stop the app so nothing writes mid-restore and lands in a half-restored state.
if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  echo "restore-db: stopping $APP_CONTAINER"
  docker stop "$APP_CONTAINER" >/dev/null
  STOPPED=1
else
  STOPPED=0
fi

echo "restore-db: restoring $DUMP into $PG_DB"
gzip -dc "$DUMP" | docker exec -i "$PG_CONTAINER" \
  psql --username "$PG_USER" --dbname "$PG_DB" -v ON_ERROR_STOP=1 >/dev/null

echo "restore-db: re-applying append-only audit protection"
# A restore recreates AuditLog, and recreating a table drops its triggers — so
# without this the recovered system would run with mutable audit records.
if [ "$STOPPED" -eq 1 ]; then
  docker start "$APP_CONTAINER" >/dev/null
  # The entrypoint re-applies hardening on boot; this is the belt to that braces.
  sleep 5
fi
docker exec "$APP_CONTAINER" npx tsx scripts/apply-audit-hardening.ts \
  || echo "restore-db: WARNING — could not re-apply audit hardening; run it manually"

echo "restore-db: done. Verify with: docker exec $APP_CONTAINER npx tsx scripts/apply-audit-hardening.ts --check"
