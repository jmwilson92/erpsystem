# Deploy ForgeRP on Vercel + Supabase (all-Postgres)

Goal: run ForgeRP on **Vercel** with **Supabase Postgres for everything**, as a
permanent instance ForgeRP uses as its own ERP (dogfooding). Login required, no
demo data.

> ⚠️ Read this first. ForgeRP ships hard-wired to **SQLite**: the Prisma
> datasource is `sqlite`, `src/lib/db.ts` always builds a `better-sqlite3`
> adapter, and the "test-drive" sandbox clones `.db` files on the local disk.
> Vercel is serverless (ephemeral, read-only filesystem) so **switching
> `DATABASE_URL` alone will NOT work** — Part 1 is required code changes. Do
> them on a branch, verify locally against Supabase, then deploy.

---

## Part 1 — Required code changes (the blockers)

### 1.1 Prisma datasource → Postgres
`prisma/schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"          // was: sqlite
  url       = env("DATABASE_URL")   // pooled (runtime)
  directUrl = env("DIRECT_URL")     // direct (migrations / db push)
}
```
- [ ] Change `provider` to `postgresql`
- [ ] Add `url` and `directUrl` (the CLI needs these; the runtime uses the adapter)

### 1.2 `src/lib/db.ts` → Postgres client on serverless
Today `createClientForFile()` / `currentClient()` always use
`PrismaBetterSqlite3` + a file path. Make the client **Postgres-aware** and skip
the filesystem sandbox when `DATABASE_URL` is Postgres.

- [ ] Install the pg driver adapter (matches the existing adapter pattern):
      `npm i @prisma/adapter-pg pg && npm i -D @types/pg`
- [ ] In `db.ts`, detect Postgres and branch:
```ts
const isPg = (process.env.DATABASE_URL ?? "").startsWith("postgres");

// Postgres: one pooled client, no filesystem, no sandbox.
function createPgClient() {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}
```
- [ ] `currentClient()` (and the `prisma` export): when `isPg`, return a single
      cached `createPgClient()` — never call `createClientForFile`, `masterDbPath`,
      `sandboxDir`, or any `fs`/`better-sqlite3` path.
- [ ] Guard the sandbox entry points (`getSandboxClient`, sandbox sweep, the
      `SANDBOX_COOKIE` handling) to no-op when `isPg` — the test-drive sandbox
      cannot run on serverless. (Keeping it for SQLite/self-host is fine.)

### 1.3 Keep the native SQLite deps from breaking the Vercel build
`better-sqlite3` is a native module; Vercel's `npm install` will try to compile
it. If that fails or you just want it out of the Postgres image:
- [ ] Move `better-sqlite3` and `@prisma/adapter-better-sqlite3` to
      `optionalDependencies` in `package.json` (the Postgres path never
      `require`s them), **or** leave them and confirm the Vercel build succeeds.

### 1.4 Confirm nothing else writes to disk at runtime
- File uploads are stored as **data URLs in the DB** (WI photos, certs, SDS,
  policy files, inspection photos) — ✅ serverless-safe, no blob store needed.
- [ ] Grep for stray `fs.write*` outside `db.ts`'s sandbox code:
      `grep -rn "fs.write\|writeFileSync\|createWriteStream" src` — there should
      be none in request paths.

### 1.5 Verify locally against Supabase before deploying
- [ ] `.env` → `DATABASE_URL` = Supabase **pooled** URL, `DIRECT_URL` = **direct** URL
- [ ] `npx prisma generate && npx prisma db push` (creates the schema in Supabase)
- [ ] `npm run build && npm start` locally with `NODE_ENV=production DEMO_MODE=0`
- [ ] Click through Dashboard, Purchasing, MRB, Quality Programs — confirm reads/writes hit Postgres

---

## Part 2 — Supabase project

- [ ] Create a Supabase project (Postgres 15). Pick a strong DB password; save it.
- [ ] Project → **Connect** → grab both strings:
  - **Pooled** (Transaction, port **6543**) → `DATABASE_URL`, append
    `?pgbouncer=true&connection_limit=1`
  - **Direct** (Session, port **5432**) → `DIRECT_URL`
- [ ] (Optional) Restrict network access / rotate the anon keys — ForgeRP talks
      to Postgres directly via Prisma, so you do **not** need the Supabase JS
      client, PostgREST, or RLS. It's just managed Postgres.
- [ ] Enable **daily backups / PITR** (Supabase dashboard → Database → Backups).

Example:
```
DATABASE_URL="postgresql://postgres.xxxx:PW@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.xxxx:PW@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

---

## Part 3 — Vercel project

- [ ] Import the repo into Vercel (Framework: Next.js — autodetected)
- [ ] Build command: default `next build` (the repo's `postinstall`/`prebuild`
      already run `prisma generate`). **Do not** add `db push` to the Vercel
      build — run schema changes yourself (Part 4) so a deploy never mutates the DB.
- [ ] Set **Environment Variables** (Production, and Preview if you use it):

**Required**
- [ ] `DATABASE_URL` = Supabase pooled URL
- [ ] `DIRECT_URL` = Supabase direct URL
- [ ] `DEMO_MODE` = `0`  (login required; `assert-production-env` enforces this)
- [ ] `NEXT_PUBLIC_APP_URL` = `https://<your-domain>`
- [ ] `APP_URL` = `https://<your-domain>`
- [ ] `NODE_ENV` = `production` (Vercel sets this automatically)

**Optional integrations (set only what you use)**
- [ ] Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
      `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_BUSINESS`
- [ ] Bank feeds: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- [ ] Email: `RESEND_API_KEY` **or** `SMTP_URL`, plus `EMAIL_FROM`
- [ ] AI assistant: `XAI_API_KEY`, `XAI_MODEL`
- [ ] Tour narration (TTS): `TTS_API_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`
- [ ] ESD humidity ingest: `ESD_HUMIDITY_TOKEN` (bearer token for `POST /api/esd/humidity`)

- [ ] Add your custom domain in Vercel → DNS, wait for HTTPS to provision.
- [ ] Confirm `serverActions.allowedOrigins` in `next.config.ts` includes your
      real domain (add it if uploads/actions 403 — it currently lists dev/tunnel
      hosts only).

---

## Part 4 — Create schema, seed clean, claim admin

Run from your machine (env pointed at Supabase; uses `DIRECT_URL`):
- [ ] `npx prisma db push`  ← creates all tables in Supabase
- [ ] `npm run db:seed:prod`  ← production seed: **no demo data**, no users,
      starts a 30-day trial, permission/role scaffolding + default settings
- [ ] Deploy (git push → Vercel builds) or `vercel --prod`
- [ ] Open the site → **"First boot — claim this instance"** → create the first
      ADMIN (this is how the owner account is made; the prod seed creates no users)
- [ ] Sign in, go to Company Settings, set company name / fiscal year / basis

---

## Part 5 — Post-deploy verification

- [ ] Login works; the persona switcher is gone (DEMO_MODE=0)
- [ ] Create a PR → approve → confirm it persists (write path to Postgres)
- [ ] Quality Programs → add a calibration record + attach a cert (data-URL upload works)
- [ ] `/guides` opens and a tour runs (e.g. "Procure to receive")
- [ ] If Stripe: hit `/billing`, confirm plan tiers load; set the Stripe webhook
      endpoint to `https://<domain>/api/stripe/webhook` and paste its signing secret
- [ ] If Plaid: Accounting → Banking connects (sandbox first, then production)
- [ ] Check Vercel function logs for connection errors — if you see
      "too many connections", confirm you're on the **pooled** URL with
      `connection_limit=1`

---

## Part 6 — This IS the permanent ForgeRP-runs-on-ForgeRP instance

Parts 2–5 produce exactly that: one clean, login-required production instance on
its own Supabase project + Vercel project/domain (e.g. `erp.forgerp.com`), with
real data (no demo). Notes:

- [ ] Keep it separate from any public demo. The **test-drive / sandbox** demo is
      filesystem-based and does **not** run on Vercel — if you want a clickable
      public demo, host that separately via Docker/VPS (see `DEPLOY.md`) with
      `DEMO_MODE=1`, and keep this Vercel instance at `DEMO_MODE=0`.
- [ ] Invite the team from **Admin → Roles & Permissions → Invite teammates**
      (needs email env set) or have them self-claim then assign roles.
- [ ] Turn off the trial banner by moving onto a plan (Stripe) or leave it —
      trials are 30 days with unlimited users.

---

## Part 7 — Ongoing operations

- [ ] **Schema changes**: after editing `prisma/schema.prisma`, run
      `npx prisma db push` against Supabase (`DIRECT_URL`) **before** the code
      that needs the new columns deploys. Bump `PRISMA_CLIENT_EPOCH` in `db.ts`
      on schema changes (hygiene; sandbox logic is a no-op on Postgres).
      Consider adopting real migrations (`prisma migrate`) for a prod DB instead
      of `db push`.
- [ ] **Backups**: rely on Supabase automated backups + PITR (replaces the
      SQLite volume-snapshot approach in `DEPLOY.md`).
- [ ] **Connections**: Prisma on serverless can exhaust Postgres connections;
      the pooled URL + `connection_limit=1` handles it. Scale the pooler in
      Supabase if traffic grows.
- [ ] **Secrets**: rotate the DB password and any integration keys from the
      provider dashboards + Vercel env; redeploy to pick them up.

---

## Quick reference — env var summary

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase **pooled** connection (runtime) |
| `DIRECT_URL` | ✅ | Supabase **direct** connection (db push/migrate) |
| `DEMO_MODE=0` | ✅ | Require login in production |
| `NEXT_PUBLIC_APP_URL`, `APP_URL` | ✅ | Absolute URLs (checkout return, emails) |
| `STRIPE_*` (5) | ⬜ | Billing / subscriptions |
| `PLAID_*` (3) | ⬜ | Bank feeds |
| `RESEND_API_KEY` / `SMTP_URL`, `EMAIL_FROM` | ⬜ | Outbound email + invites |
| `XAI_API_KEY`, `XAI_MODEL` | ⬜ | AI assistant |
| `TTS_*` (4) | ⬜ | Guided-tour narration |
| `ESD_HUMIDITY_TOKEN` | ⬜ | Humidity device ingest |
