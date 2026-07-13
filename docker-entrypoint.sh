#!/bin/sh
set -e

DB_FILE="${DATABASE_URL#file:}"

# Create / migrate the schema on every boot (idempotent)
npx prisma db push --skip-generate

# First boot on an empty volume: load the demo dataset so the app is
# usable immediately. Set SEED_ON_FIRST_BOOT=0 to start truly empty.
if [ ! -f "$DB_FILE.seeded" ] && [ "${SEED_ON_FIRST_BOOT:-1}" = "1" ]; then
  npm run db:seed
  touch "$DB_FILE.seeded"
fi

exec "$@"
