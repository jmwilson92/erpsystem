# ForgeRP Launch Runbook — Phases 2 & 3

This is the operator checklist for turning on the public marketing site, the
self-destructing demo, and self-serve Stripe signup on **www.forge-rp.live**
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

The new `Tenant` model is a brand-new table; `db push` only adds it and cannot
drop or alter existing `public` tables.

```bash
# with the live Supabase DATABASE_URL / DIRECT_URL in your env (.env.production)
npx prisma db push
```

Verify: `Tenant` exists in `public` and the dogfood tables are untouched.

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

Already set (confirmed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_BUSINESS`.

Add these:

| Var | Value | Purpose |
|-----|-------|---------|
| `APP_URL` | `https://www.forge-rp.live` | Absolute URLs for Stripe success/cancel + webhooks |
| `CRON_SECRET` | a long random string | Auth for the demo-sweep cron route |
| `DEMO_IDLE_MINUTES` | `60` (optional) | Idle minutes before a demo is reaped |
| `LAUNCH_DATE` | `YYYY-MM-DD` **launch day** | Opens the 50%-off promo window |
| `LAUNCH_PROMO_DAYS` | `60` (optional, default 60) | Length of the promo window |
| `STRIPE_COUPON_LAUNCH` | Stripe coupon id (see §4) | The 50%-off-first-year coupon |

Notes:
- **Until `LAUNCH_DATE` is set, the auto-coupon is OFF** and the signup page
  simply shows the manual promo-code box on Stripe. Set it to the real launch
  day when you're ready — the 50%-off applies automatically for
  `LAUNCH_PROMO_DAYS` days after it.
- Until `STRIPE_COUPON_LAUNCH` exists, no auto-discount is applied even inside
  the window (fails safe — full price, never a broken checkout).

## 4. Stripe dashboard — coupon + webhook

**Coupon (50% off first year):**
1. Products → Coupons → New.
2. Percentage discount **50%**, Duration **Once** (applies to the first annual
   invoice = first year).
3. Copy the coupon **ID** into `STRIPE_COUPON_LAUNCH`.

**Webhook endpoint:**
1. Developers → Webhooks → Add endpoint: `https://www.forge-rp.live/api/stripe/webhook`.
2. Send these events:
   - `checkout.session.completed`  (provisions the customer tenant)
   - `invoice.payment_succeeded`   (day-45 charge → tenant ACTIVE)
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

---

## 6. Deferred (not in this release) — customer self-serve login

Signup **provisions** the customer's tenant (schema + admin user + trialing
billing state) and records it in the `Tenant` registry, but the customer-facing
**login routing** (map a signed-in customer's session to their `tenant_*` schema)
is intentionally not wired yet, because it touches the live auth path and needs
its own testing. For the first launch customers, onboard them by:
1. Watching for new `Tenant` rows (status `ACTIVE`, `isDemo=false`).
2. Sending the customer their login + a password-set link.

The clean way to finish this: a `forge-tenant` cookie set at login (parallel to
`forge-demo`) that the `prisma` proxy honors **only** when a real session is also
present — the dogfood `public` admin never has that cookie, so `public` stays
isolated. Track as **Phase 3.5**.

Trial reminder / onboarding **emails** (Resend) are **Phase 4 — on hold**.

---

## Rollout order (safe sequence)

1. Merge the Phase 2 + Phase 3 branch → `main` (deploys; normal requests never
   touch the new `Tenant`/demo/checkout paths, so the live instance is unaffected
   even before the steps below).
2. §1 `db push` Tenant table.
3. §2 build `demo_template`.
4. §3 env vars, §4 Stripe coupon + webhook.
5. Smoke test: take the demo; run a Stripe **test-mode** checkout end-to-end and
   confirm a `tenant_*` schema appears and `public` is unchanged.
6. Set `LAUNCH_DATE` on launch day.
