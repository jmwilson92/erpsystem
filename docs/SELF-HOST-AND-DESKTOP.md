# Self-hosting & the desktop app (the "install it as a program" track)

Two deployment tracks share one codebase:

| Track | Who | Data location | How |
|---|---|---|---|
| **Hosted SaaS** | smaller / lighter-regulation customers | your servers, one instance per customer | website signup → provisioned instance |
| **Self-host / desktop** | larger / stricter customers (ITAR/CMMC path) | the customer's own hardware | Docker or the desktop app — data never touches your servers |

Because every customer already runs an isolated instance with its own database,
"self-host" is the same app pointed at the customer's infrastructure.

## Air-gapped mode (`AIRGAP=1`) — the on-premise guarantee

For an ITAR/CUI customer the claim is that nothing leaves their boundary. That is
enforced, not documented:

| Behaviour | Effect |
|---|---|
| Product analytics | Not rendered, and the collector URL is not in the bundle |
| Address type-ahead | Disabled; `/api/geocode` returns 204 and the field is a plain textarea |
| Plaid bank feeds | Unavailable; `/api/plaid/link-src` declines, so the CDN script is never loaded |
| Resend / Stripe / xAI / Plaid keys | **Server refuses to start** if any are set |

Build *and* run with the flag — a runtime flag alone still ships third-party URLs
in the client bundle:

```bash
npm run build:airgap        # AIRGAP=1 next build
AIRGAP=1 npm start
```

`npm run verify:airgap` builds and then greps the client bundle for forbidden
hosts, so an import that reintroduces egress fails CI rather than shipping. It
already caught one: gating `<Analytics />` in JSX stopped it rendering but still
bundled its collector URL, because a conditional render does not drop the
dependency.

### 800-171 controls the software now implements

| Control | What the software does | Where |
|---|---|---|
| **3.1.11** Session termination | Terminates a session after inactivity — the row is deleted, so a captured cookie cannot be replayed. Defaults to 15 minutes under `AIRGAP=1`, off otherwise. `SESSION_IDLE_MINUTES` overrides. | `src/lib/auth-core.ts` |
| **3.3.8** Audit protection | `AuditLog` is append-only: database triggers refuse `UPDATE` and `DELETE` while still allowing `INSERT`. Applied to every schema on every provisioning path and re-applied on every container boot. | `scripts/apply-audit-hardening.ts` |
| **3.5.3** Multi-factor auth | TOTP second factor, enrolment and challenge. | `src/lib/services/mfa.ts` |
| **3.13.11** FIPS crypto | **Inherited.** Crypto is Node's `crypto` over OpenSSL, so this is satisfied by deploying on a FIPS-mode host — the customer's control, not ours. | — |

The idle timeout and the `lastSeenAt` refresh interval are deliberately coupled:
`lastSeenAt` is only written once per interval to avoid a database write on every
request, so if that lag could exceed the timeout, the timeout would log out people
who never stopped working. The refresh stays at a third of the window.

**Audit immutability, scoped honestly:** the triggers stop the application and
casual database access. A superuser or the table owner can still
`ALTER TABLE ... DISABLE TRIGGER`, so this is not tamper-proof against a
determined DBA. Full non-repudiation needs audit records shipped off-box to
append-only storage, which is a customer infrastructure decision.

Re-run `npx tsx scripts/apply-audit-hardening.ts` after any migration —
recreating a table drops its triggers. `--check` reports without changing
anything and exits non-zero if a schema is unprotected, which makes it usable as
a compliance probe.

## Installing on-premise (air-gapped)

```bash
# 1. Configure. DOMAIN is the LAN name staff will use — no public DNS needed.
cat > .env <<'ENV'
DOMAIN=erp.internal
POSTGRES_PASSWORD=<a long random string>
MFA_SECRET_KEY=<openssl rand -base64 48>
ENV

# 2. Build the image with AIRGAP=1 so third-party URLs are not even bundled.
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.airgap.yml build \
               --build-arg AIRGAP=1

# 3. Start.
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.airgap.yml up -d
```

The airgap overlay is applied **last** so it wins. It sets `AIRGAP=1`, turns on
the session timeout and password policy, and **explicitly blanks** every external
integration variable — leaving them unset would let a value in `.env` fall
through, so they are set to empty rather than omitted.

Confirm what the stack will actually run before starting it:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.airgap.yml config | grep -E 'AIRGAP|RESEND|PLAID|STRIPE|XAI'
```

### TLS on a disconnected network

The production `Caddyfile` uses automatic HTTPS, which needs a public DNS name and
a reachable ACME server — neither exists on an isolated LAN, and Caddy would retry
issuance forever while serving nothing. `Caddyfile.airgap` makes TLS explicit:

- `TLS_MODE=internal` (default) — Caddy issues from its own local CA. Trust that
  root once per workstation and the LAN name is properly HTTPS, entirely offline.
- `TLS_MODE="/certs/erp.crt /certs/erp.key"` — use your own internal CA; mount the
  certificates (see the commented volume in `docker-compose.airgap.yml`).

### Backup and restore

```bash
# Nightly, via cron on the host
15 2 * * * /path/to/erpsystem/scripts/backup-db.sh

# Recovery
./scripts/restore-db.sh backups/protessera-2026-07-30-0215.sql.gz
```

Both scripts verify the archive before trusting it — gzip integrity plus a schema
marker — because a backup job that silently writes an empty file buys false
confidence for months and then fails on the one day it matters. `restore-db.sh`
validates the dump *before* touching the database, refuses to overwrite a
populated one without `--force`, stops the app during the restore, and re-applies
the append-only audit triggers afterwards (a restore recreates the table, and
recreating a table drops its triggers).

**Rehearse a restore onto a scratch stack before you need it.** An untested backup
is a hope, not a backup.

### What this is and is not

This makes the software's behaviour **defensible and demonstrable**. It does not
make a deployment *compliant* — NIST 800-171 and CMMC are assessed against the
customer's whole environment by their C3PAO, and no application can be
"CMMC certified" on its own. Claiming otherwise to a defense prime is a real
liability. What you can hand them is a control matrix: what the software
provides, what they configure, what they inherit from their environment.

Still open before that matrix is honest: session inactivity timeout (3.1.11),
audit-log immutability (3.3.8), and FIPS-validated crypto (3.13.11 — inherited
from the host, so "deploy on a FIPS-mode host" is the correct entry).


## Option A — Docker self-host (available today)

The repo already includes `Dockerfile` and `docker-compose.prod.yml`.

```bash
cp .env.example .env          # set DEMO_MODE=0, DATABASE_URL, secrets
docker compose -f docker-compose.prod.yml up -d
docker compose exec app npm run db:seed:prod   # first run only
```

The SQLite database lives on a named volume (or point `DATABASE_URL` at the
customer's Postgres — see `SCALING-POSTGRES.md`). Nothing leaves their network.
This is the fastest path for a security-conscious customer today.

## Option B — Desktop app (Tauri) — "install it as a program"

Tauri wraps the app in a small native window (Windows/macOS/Linux) with a
Rust-based shell that's far lighter than Electron. Two models:

1. **Thin client** — the desktop app is a native window pointed at the
   customer's self-hosted server URL. Simplest; the server still runs via
   Docker/Node on their box or network.
2. **Fully bundled (offline)** — ship the Next.js standalone server + SQLite as
   a Tauri *sidecar* so everything runs locally on the workstation with no
   network. Best for air-gapped / export-controlled sites. This is the ITAR/CMMC
   direction.

### Prerequisites

- Rust toolchain + [Tauri CLI](https://tauri.app) (`cargo`, `npm i -g @tauri-apps/cli`)
- Build the web app first: `npm run build`

### Scaffold

A starter Tauri config lives in `desktop/tauri.conf.json`. To wire it up:

```bash
npm create tauri-app@latest         # or: npm i -D @tauri-apps/cli && npx tauri init
# replace the generated tauri.conf.json with desktop/tauri.conf.json
# (adjust the icons/identifier), then:
npx tauri dev                       # run against a local server
npx tauri build                     # produce installers (.msi/.dmg/.AppImage)
```

### For the bundled/offline build

1. Set `output: "standalone"` in `next.config.ts` and `npm run build` — this
   emits a self-contained Node server under `.next/standalone`.
2. Add that server (with a bundled Node runtime, e.g. via `pkg` or a Node
   sidecar binary) as a Tauri `externalBin` sidecar started on app launch.
3. The Tauri window loads `http://127.0.0.1:<port>` served by the sidecar.
4. Ship the seeded SQLite DB in app data on first run.

The result is a signed installer the customer double-clicks — the whole ERP runs
on their machine, data included.

### Signing & updates

- Code-sign installers (Windows Authenticode, Apple notarization) for trust.
- Tauri's updater can deliver signed updates; for stricter customers, ship
  manual installers instead so they control what runs.

## Which to lead with

Lead the beta on **hosted SaaS** for reach, and offer **Docker self-host** to any
customer who asks about data residency today. Build the **bundled desktop app**
when you take on the first ITAR/CMMC-bound customer — that's also when GFP /
government-property module and export-controlled hosting turn on.
