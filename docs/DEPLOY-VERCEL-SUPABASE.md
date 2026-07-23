# Deploy ForgeRP on Vercel + Supabase (all-Postgres)

Goal: run ForgeRP on **Vercel** with **Supabase Postgres for everything**, as a
permanent instance ForgeRP uses as its own ERP (dogfooding). Login required, no
demo data.

> ℹ️ Part 1 is **already done in this repo** — ForgeRP now runs on PostgreSQL.
> It's kept here as a record of what changed and how to verify. If you're
> starting from a fresh checkout, skip to Part 2.

---

## Part 1 — Postgres conversion (DONE — here's what changed)

ForgeRP originally shipped on SQLite (`better-sqlite3` adapter + a filesystem
"test-drive" sandbox), which serverless can't do. The following are already in
place on this branch:

### 1.1 Prisma datasource → Postgres
`prisma/schema.prisma` datasource is now just:
```prisma
datasource db {
  provider = "postgresql"
}
```
> In **Prisma 7** the connection URL is **not** allowed in the schema. It lives
> in `prisma.config.ts` for the CLI/Migrate (using `DIRECT_URL`), and in the
> driver adapter for the app runtime (using `DATABASE_URL`).

`prisma.config.ts`:
```ts
datasource: { url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"] ?? "" }
```

### 1.2 `src/lib/db.ts` → single pooled Postgres client
Rewritten to use `@prisma/adapter-pg` with `DATABASE_URL`, cached on the global
(serverless-safe), with the test-drive sandbox exports kept as no-ops/guards
(no filesystem on serverless). Deps: `@prisma/adapter-pg` + `pg` are in
`dependencies`; `better-sqlite3` + `@prisma/adapter-better-sqlite3` moved to
`optionalDependencies` so a Vercel install never fails on the native build.

### 1.3 Seeds → Postgres
`prisma/seed.ts` and `prisma/seed-prod.ts` now use `@prisma/adapter-pg`, load
`.env` via `import "dotenv/config"` (a plain `tsx` script doesn't auto-load it),
and wipe with `TRUNCATE ... RESTART IDENTITY CASCADE` (was SQLite `PRAGMA` +
`DELETE`).

### 1.4 No runtime disk writes
File uploads are stored as **data URLs in the DB** (WI photos, certs, SDS,
policy files, inspection photos) — ✅ serverless-safe, no blob store needed.

### 1.5 How it was verified (repeat this against Supabase)
- [ ] `.env` → `DATABASE_URL` = pooled URL, `DIRECT_URL` = direct URL
- [ ] `npx prisma generate && npx prisma db push` — schema created, no type errors
- [ ] `npm run db:seed` (or `db:seed:prod`) — seeds cleanly against Postgres
- [ ] `npx tsc --noEmit && npm run build` — green (static pages query Postgres at build)
- [ ] `DEMO_MODE=0 npx next start` — `/` 307-redirects to `/login` (auth + DB live)

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
