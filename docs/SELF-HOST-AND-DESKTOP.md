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
