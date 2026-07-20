#!/bin/sh
set -e

DB_FILE="${DATABASE_URL#file:}"

# Create / migrate the schema on every boot (idempotent)
npx prisma db push --skip-generate

# First boot on an empty volume. SEED_ON_FIRST_BOOT:
#   1    (default) load the full demo dataset — good for evaluation
#   prod load config essentials only (chart of accounts, UOMs,
#        permissions, approval pipeline, settings) — no demo content;
#        claim the instance to create your admin
#   0    start truly empty
SEED_MODE="${SEED_ON_FIRST_BOOT:-1}"
if [ ! -f "$DB_FILE.seeded" ]; then
  if [ "$SEED_MODE" = "1" ]; then
    npm run db:seed
    touch "$DB_FILE.seeded"
  elif [ "$SEED_MODE" = "prod" ]; then
    npm run db:seed:prod
    touch "$DB_FILE.seeded"
  fi
fi

exec "$@"
