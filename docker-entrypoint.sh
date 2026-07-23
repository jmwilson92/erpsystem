#!/bin/sh
set -e

# ForgeRP runs on PostgreSQL. Sync the schema on every boot (idempotent) and
# seed only when the database is empty. Connection comes from DATABASE_URL /
# DIRECT_URL in the environment (docker-compose points them at the bundled
# Postgres service).

echo "[entrypoint] syncing schema (waiting for Postgres if needed)..."
n=0
until npx prisma db push --skip-generate; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "[entrypoint] Postgres not reachable after 30 attempts — giving up" >&2
    exit 1
  fi
  echo "[entrypoint] database not ready (attempt $n) — retrying in 2s"
  sleep 2
done

# SEED_ON_FIRST_BOOT:
#   1    (default) full demo dataset — good for evaluation
#   prod config essentials only (chart of accounts, UOMs, permissions,
#        approval pipeline, settings); claim the instance to create your admin
#   0    start empty
SEED_MODE="${SEED_ON_FIRST_BOOT:-1}"
if [ "$SEED_MODE" != "0" ]; then
  # The seeds wipe + reload, so they must run only on a fresh database. First
  # boot = the permission catalog is empty (both seeds populate it).
  SEEDED=$(node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL});c.connect().then(()=>c.query('SELECT count(*)::int AS n FROM \"Permission\"')).then(r=>{console.log(r.rows[0].n);return c.end();}).catch(()=>{console.log('0');});" 2>/dev/null || echo 0)
  if [ "${SEEDED:-0}" = "0" ]; then
    echo "[entrypoint] first boot — seeding ($SEED_MODE)"
    if [ "$SEED_MODE" = "prod" ]; then
      npm run db:seed:prod
    else
      npm run db:seed
    fi
  else
    echo "[entrypoint] database already has data — skipping seed"
  fi
fi

exec "$@"
