# Self-hosting & the desktop app (the "install it as a program" track)

Two deployment tracks share one codebase:

| Track | Who | Data location | How |
|---|---|---|---|
| **Hosted SaaS** | smaller / lighter-regulation customers | your servers, one instance per customer | website signup → provisioned instance |
| **Self-host / desktop** | larger / stricter customers (ITAR/CMMC path) | the customer's own hardware | Docker or the desktop app — data never touches your servers |

Because every customer already runs an isolated instance with its own database,
"self-host" is the same app pointed at the customer's infrastructure.

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
