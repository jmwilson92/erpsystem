#!/bin/sh
# Protessera on-premise installer.
#
#   ./install.sh                 standard install
#   ./install.sh --airgap        ITAR/CUI: no outbound requests, ever
#   ./install.sh --version 1.2.0 pin a release instead of :latest
#
# Generates secrets, writes .env, pulls the published image, and starts the
# stack. Everything runs on this machine — the database is a container beside
# the app and its data never leaves.
#
# Safe to re-run: an existing .env is NEVER rewritten. That is not politeness,
# it is the difference between an upgrade and an outage — regenerating
# MFA_SECRET_KEY would make every enrolled second factor undecryptable, with no
# recovery path, and regenerating POSTGRES_PASSWORD would orphan the database
# volume.
set -eu

IMAGE="${PROTESSERA_IMAGE:-ghcr.io/jmwilson92/erpsystem}"
VERSION="latest"
AIRGAP=0
PORT="${HTTP_PORT:-3000}"

while [ $# -gt 0 ]; do
  case "$1" in
    --airgap) AIRGAP=1 ;;
    --version) shift; VERSION="${1:-latest}" ;;
    --port) shift; PORT="${1:-3000}" ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '  %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

echo ""
echo "Protessera on-premise installer"
echo "════════════════════════════════"

# ── prerequisites ────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die \
"Docker is not installed.

  Linux:            https://docs.docker.com/engine/install/
  Windows / macOS:  https://docs.docker.com/desktop/

Install it, then run this again."

if ! docker compose version >/dev/null 2>&1; then
  die "Docker is installed but 'docker compose' is not available.
Docker Compose v2 ships with Docker Desktop and recent Docker Engine.
See https://docs.docker.com/compose/install/"
fi

docker info >/dev/null 2>&1 || die \
"Docker is installed but not running (or this user cannot reach it).
Start Docker Desktop, or add yourself to the 'docker' group and log back in."

say "Docker OK"

# ── secrets ──────────────────────────────────────────────────────────────
# openssl is the common case; fall back to /dev/urandom so a minimal host still
# works. Never a shell RANDOM — that is predictable, and these protect a
# database and everyone's second factor.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "${1:-36}" | tr -d '\n=+/' | cut -c1-"${2:-40}"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "${2:-40}"
  fi
}

if [ -f .env ]; then
  say ".env already exists — keeping it (secrets are never regenerated)"
  # shellcheck disable=SC1091
  . ./.env 2>/dev/null || true
  [ -n "${MFA_SECRET_KEY:-}" ] || die \
".env exists but has no MFA_SECRET_KEY. Add one before starting:
  MFA_SECRET_KEY=$(gen_secret 48 64)
If this instance already had users enrolled in two-factor, you need the
ORIGINAL value — a new one cannot decrypt their existing secrets."
  [ -n "${POSTGRES_PASSWORD:-}" ] || die ".env exists but has no POSTGRES_PASSWORD."
else
  say "Generating secrets"
  POSTGRES_PASSWORD="$(gen_secret 32 40)"
  MFA_SECRET_KEY="$(gen_secret 48 64)"
  TAG="$VERSION"
  [ "$AIRGAP" = "1" ] && TAG="${VERSION}-airgap"

  umask 077   # .env holds both secrets; do not create it world-readable
  cat > .env <<ENV
# Protessera on-premise configuration. Generated $(date -u +%Y-%m-%dT%H:%M:%SZ).
#
# KEEP A BACKUP OF THIS FILE, somewhere other than this machine.
# MFA_SECRET_KEY encrypts every enrolled second factor. Lose it and those users
# cannot sign in, and there is no recovery path.

PROTESSERA_IMAGE=$IMAGE
IMAGE_TAG=$TAG

POSTGRES_PASSWORD=$POSTGRES_PASSWORD
MFA_SECRET_KEY=$MFA_SECRET_KEY

# The address staff will use. Change this if it is not localhost.
APP_URL=http://localhost:$PORT
HTTP_PORT=$PORT

# 1 = make no third-party request, and refuse to start if an outbound
# integration key is configured.
AIRGAP=$AIRGAP
ENV
  say "Wrote .env (contains secrets — back it up, keep it private)"
fi

# ── compose file ─────────────────────────────────────────────────────────
[ -f docker-compose.release.yml ] || die \
"docker-compose.release.yml is missing. It must sit beside this script."

# ── pull + start ─────────────────────────────────────────────────────────
say "Pulling the image (this takes a few minutes the first time)"
docker compose -f docker-compose.release.yml pull

say "Starting"
docker compose -f docker-compose.release.yml up -d

# Wait on the app's own health endpoint rather than declaring success the
# instant compose returns — the container is up long before migrations and the
# first-boot seed have finished, and "installed" should mean usable.
say "Waiting for the first-boot migration and seed"
i=0
until curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    echo ""
    echo "Not healthy after ~3 minutes. What it is doing:"
    docker compose -f docker-compose.release.yml logs --tail 40 app
    die "Startup did not complete. The logs above usually say why."
  fi
  sleep 2
done

echo ""
echo "════════════════════════════════"
echo "  Protessera is running"
echo ""
echo "    http://localhost:$PORT"
echo ""
echo "  Open it and claim the instance — the first account you create is the"
echo "  administrator."
[ "$AIRGAP" = "1" ] && echo "  Air-gapped: no third-party requests, verified at boot."
echo ""
echo "  Back up .env somewhere off this machine. Losing MFA_SECRET_KEY locks"
echo "  out everyone enrolled in two-factor."
echo ""
echo "  Nightly backups:  scripts/backup-db.sh   (see docs)"
echo "  Stop:             docker compose -f docker-compose.release.yml down"
echo "  Update:           ./install.sh --version X.Y.Z"
echo "════════════════════════════════"
echo ""
