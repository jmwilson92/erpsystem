#!/usr/bin/env bash
# Build the demo_template schema on Supabase (so /demo "Take the live demo" works).
#
# Usage in Codespaces:
#   1. Put DATABASE_URL (pooler) in .env — copy from Vercel env vars
#      (host should be *.pooler.supabase.com, NOT db.*.supabase.co)
#   2. Run:
#        bash scripts/build-demo-template.sh
#
# Or one-shot with the URL inline (don't commit secrets):
#   DATABASE_URL='postgresql://...' bash scripts/build-demo-template.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if present (does not override vars already in the environment)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" && -z "${DIRECT_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL (preferred) or DIRECT_URL."
  echo ""
  echo "Copy DATABASE_URL from Vercel → Settings → Environment Variables."
  echo "It should look like:"
  echo "  postgresql://postgres.XXX:PASS@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true"
  echo ""
  echo "Do NOT use db.XXXX.supabase.co (IPv6-only — fails in Codespaces)."
  exit 1
fi

# If DIRECT_URL is the IPv6-only Supabase host, force pooler for this run
if [[ "${DIRECT_URL:-}" == *"db."*".supabase.co"* ]]; then
  echo "⚠ DIRECT_URL uses db.*.supabase.co (IPv6) — using DATABASE_URL only for this run"
  export DIRECT_URL="${DATABASE_URL}"
fi

# Prefer pooler for both so seed + DDL stay reachable
if [[ -n "${DATABASE_URL:-}" ]]; then
  export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
fi

echo "→ Building demo_template (this can take several minutes)…"
npx tsx scripts/build-demo-template.ts

echo ""
echo "Done. Try: https://www.protessera.com/demo"
