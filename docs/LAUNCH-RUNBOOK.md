# Protessera Launch Runbook — Phases 2 & 3

This is the operator checklist for turning on the public marketing site, the
self-destructing demo, and self-serve Stripe signup on **www.protessera.com**
(Vercel + Supabase). Everything below is safe for the live dogfood instance,
which lives in the Postgres `public` schema and is never touched by demo or
customer provisioning.

The **code** for all of this is merged; these are the one-time **operational**
steps (live DB + env + Stripe dashboard) that can't be done from CI.

---

## 0. Architecture in one paragraph

One Supabase Postgres, schema-per-tenant. The dogfood instance is `public`.
Each **demo** clicks into a throwaway `demo_*` schema cloned from a pre-seeded
`demo_template`, and self-destructs when idle. Each **paying customer** gets a
`tenant_*` schema provisioned on Stripe checkout. A control-plane `Tenant` table
in `public` is the registry (routing key + billing pointers). Request routing:
the `prisma` client is a proxy — a real `forge-session` always resolves to
`public`; an anonymous visitor with a `forge-demo` cookie resolves to their demo
schema. Customer self-serve login routing (session → their `tenant_*` schema) is
the one remaining piece — see **§6 Deferred**.

---

## 1. Push the `Tenant` table to Supabase (additive, safe)

The `Tenant` and `TenantLogin` models are brand-new tables; `db push` only adds
them (plus the new `setupTokenHash`/`setupTokenExpiresAt` columns on `Tenant`)
and cannot drop or alter existing `public` tables.

```bash
# with the live Supabase DATABASE_URL / DIRECT_URL in your env (.env.production)
npx prisma db push
```

Verify: `Tenant` and `TenantLogin` exist in `public` and the dogfood tables are
untouched.

## 2. Build the demo template on Supabase (new schema, safe)

Creates the `demo_template` schema (full 186-table set) and seeds it with the
mock factory that every demo is cloned from. It only creates a new schema.

```bash
DIRECT_URL="<supabase session-pooler url>" npx tsx scripts/build-demo-template.ts
```

Verify: schema `demo_template` exists and has seeded rows (e.g. `CompanySettings`,
`User`, work orders). Then click **Take the live demo** on the site — it should
spin up a `demo_*` schema and drop you into a seeded ERP with no login.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Already set (confirmed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the
**standard** prices `STRIPE_PRICE_SHOP` (per-seat monthly $30, qty 1–10),
`STRIPE_PRICE_STARTER` ($3,600/year), `STRIPE_PRICE_GROWTH` ($8,400/year),
`STRIPE_PRICE_BUSINESS` ($18,000/year). Leave those price IDs in place — existing
subscribers stay on them.

New checkouts also need the first-year prices (see §4). Until those env vars
exist, Plan & billing refuses to start a first-year checkout rather than
charging the standard price by mistake.

> **Test vs live mode:** every Stripe value above is mode-specific. Switching to
> live means recreating the **4 standard prices** and the **4 first-year prices**
> (Shop graduated + 3 annual intro prices), and the webhook endpoint in live
> mode, then updating `STRIPE_SECRET_KEY` (`sk_live_…`), the 8 `STRIPE_PRICE_*`
> vars, and `STRIPE_WEBHOOK_SECRET` to the live values. A leftover test webhook
> secret makes live events fail signature verification (400s in Stripe → Webhooks).
> Do **not** set `STRIPE_COUPON_LAUNCH`. The 50%-off coupon is retired and the
> app does not read it.

Add these:

| Var | Value | Purpose |
|-----|-------|---------|
| `APP_URL` | `https://www.protessera.com` | Absolute URLs for Stripe success/cancel + webhooks |
| `CRON_SECRET` | a long random string | Auth for the demo-sweep cron route |
| `DEMO_IDLE_MINUTES` | `10` (optional, default 10) | Idle minutes before a claimed sandbox is reaped and its ~23 MB returned to the pool budget. Measures a heartbeat, not clicks: the demo pings every 60s while its tab is open, so this only reaps sandboxes whose tab is gone. |
| `DEMO_POOL_SIZE` | `5` (optional, default 5, max 20) | Pre-warmed demo sandboxes kept ready. Cloning takes seconds against a remote DB, so the pool is what makes "Take the live demo" feel instant. `0` disables pre-warming (every visitor waits for a clone). A demo schema measures ~23 MB, and a spare costs that whether or not anyone claims it: 5 is ~115 MB, 15 is ~345 MB. Supabase free is 500 MB total, shared with demo_template, the dogfood schema, real tenants, and claimed demos -- so raise this only on a paid database. |
| `STRIPE_PRICE_SHOP_FIRST_YEAR` | Stripe price id (see §4) | Graduated Shop price for the first 12 paid months |
| `STRIPE_PRICE_STARTER_FIRST_YEAR` | Stripe price id | $250 for the first year |
| `STRIPE_PRICE_GROWTH_FIRST_YEAR` | Stripe price id | $500 for the first year |
| `STRIPE_PRICE_BUSINESS_FIRST_YEAR` | Stripe price id | $1,000 for the first year |

Notes:
- `LAUNCH_DATE`, `LAUNCH_PROMO_DAYS`, and `STRIPE_COUPON_LAUNCH` are **ignored**.
  Checkout does not offer a promotion-code box, so a leftover 50% coupon cannot
  be entered. Deactivate that coupon in the Stripe dashboard anyway.
- The hosted trial is 60 days and does not collect a card. The first-year price
  is charged when the customer subscribes from Plan & billing (there is no card
  on file to charge automatically on day 60). A subscription schedule then
  switches that subscription to the standard price after 12 paid months.
- An instance whose `billingProvider` is already `stripe` checks out at the
  standard price. The webhook does not rewrite that subscriber's current
  subscription. Trials and instances that have never been billed by Stripe
  check out at the first-year price.

### 3a. Carina (AI voice assistant + agent)

| Var | Value | Purpose |
|-----|-------|---------|
| `XAI_API_KEY` | xAI API key | **Required for Carina.** Powers chat, the agent, and (by default) her voice. Unset → Carina is off; the rest of the app is unaffected. |
| `XAI_MODEL` | e.g. `grok-4.5` (optional) | Pins the model. Unset → tries `grok-4.5` → `grok-4` → `grok-3` → `grok-2` in order. |
| `CARINA_AGENT_ACTIONS` | `1` / unset = on, `0` = off, `business` = Business+ only | Gates whether Carina may **create records** (work orders, PRs, customers, parts, PTO). Set `0` to leave her read-only/advisory. |
| `TTS_API_KEY` | (optional) | Separate key for speech. Falls back to `XAI_API_KEY`. |
| `TTS_VOICE_ID` | (optional, default `carina`) | Voice for xAI TTS. |
| `TTS_API_URL` / `TTS_MODEL` / `TTS_VOICE` | (optional) | Only for pointing speech at an OpenAI-compatible TTS endpoint instead of xAI. |

### 3b. Email + support desk

| Var | Value | Purpose |
|-----|-------|---------|
| `RESEND_API_KEY` | Resend API key | Turns on **real** email delivery (invites, password resets, support notifications). Unset → messages are logged in the app's email center but never sent. |
| `EMAIL_FROM` | e.g. `erp@protessera.com` | From address. The sending domain must be verified in Resend. |
| `SUPPORT_EMAIL_FROM` | (optional) | Overrides `EMAIL_FROM` for support-desk mail only. |
| `SUPPORT_NOTIFY_EMAILS` | comma-separated addresses (optional) | Who gets notified on a new support ticket. Unset → all active ADMINs on the public/platform instance. |

Note: `SMTP_URL` is an alternate transport for self-hosted deployments; the
hosted app uses Resend.

## 4. Stripe dashboard — first-year prices + webhook

Create the four first-year prices in the **same Stripe mode** as
`STRIPE_SECRET_KEY` (test or live). `npm run stripe:setup-plans` does this from
the plan catalog and prints the env vars. If you create them by hand:

**Shop first year** (`STRIPE_PRICE_SHOP_FIRST_YEAR`) — recurring, monthly, USD,
billing scheme **Tiered**, tiers mode **Graduated**:
1. First unit: up to 1, **$10.00** per unit.
2. Remaining units: up to infinity, **$2.00** per unit.
3. A quantity of 10 must invoice at **$28.00**. Do not use a flat per-seat price
   or a percent-off coupon; seat quantity is adjustable on Checkout.

**Starter first year** (`STRIPE_PRICE_STARTER_FIRST_YEAR`) — **$250.00** / year.
**Growth first year** (`STRIPE_PRICE_GROWTH_FIRST_YEAR`) — **$500.00** / year.
**Business first year** (`STRIPE_PRICE_BUSINESS_FIRST_YEAR`) — **$1,000.00** / year.

Leave the existing standard prices unchanged:
Shop $30/seat/month, Starter $3,600/year, Growth $8,400/year, Business $18,000/year.

Deactivate the old **50% off first year** coupon if it still exists. The app
does not apply it.

On `checkout.session.completed` for a new first-year checkout, the app attaches
a subscription schedule: 12 monthly cycles (Shop) or 1 annual cycle
(Starter / Growth / Business) on the first-year price, then the standard price
with the same quantity. `end_behavior` is `release`. Proration on the transition
is `none`.

**Webhook endpoint:**
1. Developers → Webhooks → Add endpoint: `https://www.protessera.com/api/stripe/webhook`.
2. Send these events:
   - `checkout.session.completed`  (provisions the customer tenant)
   - `invoice.payment_succeeded`   (first paid invoice → tenant ACTIVE)
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` (already set — re-check it
   matches this endpoint).

Signature verification, replay protection (5-min tolerance), and idempotency
(by Stripe subscription id) are handled in code.

## 5. Demo idle-sweep cron

`vercel.json` already declares an hourly cron hitting `/api/cron/sweep-demos`.
- Vercel **Pro** runs it hourly as configured. **Hobby** only allows daily —
  that's fine: each new demo also opportunistically sweeps idle ones, so demos
  still get reaped from organic traffic. The 4-hour cookie cap bounds the worst
  case regardless.
- The route is guarded by `CRON_SECRET` (Vercel Cron sends it as a Bearer token).
- The same run also **tops up the pre-warmed demo pool** and recycles spares idle
  longer than 24h, so the pool refills itself and never serves stale seed data
  after a template rebuild.

---

## 6. Customer login & onboarding (Phase 3.5 — now built)

Customers can log into their own instance. How it works:

- **Routing:** a `forge-tenant` cookie (set at login/onboarding) routes a
  signed-in customer to their `tenant_*` schema. It's only a hint — sessions
  live *inside* each schema's `AuthSession` table, so a forged cookie pointing
  at another tenant just fails to find the session (→ logged out). The dogfood
  `public` admin never has this cookie, so `public` stays isolated.
- **Login:** a customer types email + password at `/login`. A control-plane
  `TenantLogin` directory (email → schema) resolves their workspace; the
  password is verified against that schema's own user. An email not in the
  directory is a public/dogfood account (unchanged path).
- **Onboarding:** each completed signup provisions the tenant, registers the
  admin's login, and mints a one-time claim link `…/onboard/<token>` (valid 14
  days). The customer sets their first password there and lands straight in
  their instance.

**Handing out the claim link (while trial emails are off):** the link is logged
to the server console at provision time, and — better — the owner can mint a
fresh one anytime from **`/admin/tenants`** (dogfood ADMIN only; a customer's
own admin can't reach it). Send it to the customer to get them in.

Still deferred: inviting *additional* users inside a tenant (the single admin
works today; multi-user invites within a tenant register to the directory in a
follow-up). Trial reminder **emails** (Resend) remain **Phase 4 — on hold**.

---

## Rollout order (safe sequence)

1. Merge the Phase 2 + Phase 3 branch → `main` (deploys; normal requests never
   touch the new `Tenant`/demo/checkout paths, so the live instance is unaffected
   even before the steps below).
2. §1 `db push` Tenant table.
3. §2 build `demo_template`.
4. §3 env vars, §4 Stripe first-year prices + webhook. Deactivate the 50% coupon.
5. Smoke test: take the demo; run a Stripe **test-mode** checkout end-to-end and
   confirm a `tenant_*` schema appears and `public` is unchanged.
6. Confirm a test checkout uses the first-year price, and that the subscription
   schedule's second phase is the standard price. Do not set `LAUNCH_DATE`.
