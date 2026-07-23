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
4. §3 env vars, §4 Stripe coupon + webhook.
5. Smoke test: take the demo; run a Stripe **test-mode** checkout end-to-end and
   confirm a `tenant_*` schema appears and `public` is unchanged.
6. Set `LAUNCH_DATE` on launch day.
