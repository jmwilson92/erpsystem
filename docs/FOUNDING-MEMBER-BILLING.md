# Founding-member lifetime billing

## Rule and implementation

A paid subscription or trial started through **March 9, 2027, 11:59 PM America/Los_Angeles** qualifies. The exclusive instant is `2027-03-10T08:00:00.000Z`: March 9 is PST; DST starts March 14. Every second of the final minute is included.

- `CompanySettings` (workspace subscription) and public `Tenant` (registry) gain only `foundingMember BOOLEAN NOT NULL DEFAULT false` and nullable `foundingQualifiedAt`. No existing column is dropped/retyped. A narrow database trigger blocks anon/authenticated API roles from forging or clearing the new entitlement fields; server-role writes and existing profile/read permissions are unchanged. The timestamp records verified eligibility, not an invented historical start for legacy accounts.
- Real no-card trials and in-app paid activations capture their eligibility when started. Free Shop alone and demo sandboxes do not buy/reserve a founding subscription. Blank default settings do not count as a trial.
- Public Stripe signups qualify using **Subscription.created**, not Checkout Session.created, webhook delivery time or an email address. A Checkout opened before midnight but creating its subscription afterwards is not automatically eligible.
- An already-qualified trial/workspace keeps its grant when converting after the cutoff. Server-authenticated Checkout carries the persisted grant into subscription metadata. The customer cannot supply membership or workspace ownership through FormData.
- Flags are sticky across renewals, edits, trial restarts and cancellation. A later event omitting/setting a false flag never revokes an existing entitlement. The same workspace can resume its grant; this does not transfer membership to a different workspace just because the email matches.
- Founders check out at the recurring first-year Price IDs and `ensureIntroRenewalSchedule` returns **before any schedule write**. The existing recurring Stripe Price keeps renewing: no expiring coupon and no annual reset. Non-founders retain the existing 12-paid-month introduction followed by standard-price schedule.
- In-app Checkout records a server-resolved workspace routing hint and binds the resulting subscription back to that workspace. Plan selection refuses to open a second Checkout for a still-live linked subscription; plan changes require managing the existing subscription, not double billing. Invoice IDs are never stored as subscription IDs. Unknown public Checkout events cannot overwrite the dogfood workspace. Signed webhook handlers preserve membership for both legacy/current invoice reference shapes; unpaid Checkout trials are not activated as paid.
- Billing and paid-signup confirmation display the lifetime entitlement without changing catalog amounts. The lock covers the recurring plan's price/rate, not changing seat quantities, applicable taxes, currency conversion, usage or separately purchased services.

## REQUIRED rollout order — no automatic live migration

**Apply the additive columns/data backfill before serving the new runtime.** Prisma may select all CompanySettings/Tenant fields; deploying without the new columns can break unrelated authenticated screens. Merging can automatically deploy on Vercel, so coordinate the approved schema step before merge/production activation. This PR itself has changed neither the production database nor Stripe.

Use the reviewed PR checkout before merge (or current main after an approved merge). Install its lockfile and regenerate from its schema:

```sh
npm ci
node scripts/gen-tenant-ddl.mjs
# On the PR branch, compare against the actual reviewed branch rather than old main:
STALE_CHECK_REF=origin/billing-founding-member-lifetime npx tsx scripts/backfill-tenant-schemas.ts --founding-only --include-public --include-demos
STALE_CHECK_REF=origin/billing-founding-member-lifetime npx tsx scripts/backfill-tenant-schemas.ts --founding-only --include-public --include-demos --apply
STALE_CHECK_REF=origin/billing-founding-member-lifetime npx tsx scripts/backfill-tenant-schemas.ts --founding-only --include-public --include-demos
```

After merge on current main, omit `STALE_CHECK_REF=...`; its default is origin/main. `DIRECT_URL` (preferred direct Postgres connection) or `DATABASE_URL` must already be securely configured; never paste a URL/key into a shell command. The report is read-only unless `--apply` is supplied. There is no reset or `prisma db push`.

The targeted mode updates public Tenant, public dogfood CompanySettings and existing tenant CompanySettings. `--include-demos` adds the columns to demo schemas too (needed for generated Prisma compatibility), but never awards demo membership. It does not patch unrelated schema drift. New tenant provisioning receives the generated CompanySettings columns automatically; Tenant remains public-only.

**Existing paid/trial accounts:** while the offer is open, observing an existing paid subscription or real trial is valid eligibility evidence, so the backfill grants both workspace and registry flags. Free-only accounts and blank settings are excluded. It is idempotent and propagates an already-stored grant across both records. After the cutoff, unknown historical accounts require verified historical Subscription.created/trial evidence; the script reports `REVIEW` and exits 2 rather than guessing from a user/account creation date. Failures return nonzero. Run this rollout promptly, before the cutoff, to capture today's existing customers.

If another schema PR (including Docs) merges first, reconcile both schemas, retain both targeted backfill modes, and regenerate `src/lib/tenant-template.ts`. Do not replace the merged generated DDL with a stale branch snapshot.

## REQUIRED existing-Stripe reconciliation — separate approval

Skipping creation of a schedule does **not** remove a schedule already attached by the old code. Nor does setting metadata change a Stripe Price. Existing founders can therefore still face the old standard-price phase until this step is performed.

`npx tsx scripts/report-founding-stripe.ts` is an **explicitly invoked, read-only** DB/Stripe audit after the backfill. Use securely configured read permissions for subscriptions and schedules. It emits schema, subscription/schedule/price IDs and review actions, not customer emails or raw Stripe objects. It has no write/apply mode and rejects `--apply`. This tool was tested with synthetic objects; it was **not run against live Stripe**.

For each identified subscription, obtain separate approval for the exact Stripe changes:

1. Confirm the account's grant, current original introductory Price, quantity, trial/billing dates and all future schedule phases. Inspect any discounts, tax settings, add-ons or intentional plan/quantity changes before deciding.
2. If the schedule's only unwanted change is the first-year-to-standard increase, **release the subscription schedule**, rather than canceling it/the subscription. The documented release operation stops future phases while leaving the existing subscription in place. Preserve the current introductory Price, quantities, trial end and billing-cycle anchor. Do not blindly release a custom schedule.
3. If an existing founder is already on a standard/legacy Price, review moving its recurring item to the appropriate first-year Price. Use an explicitly approved, non-prorating change that preserves billing dates. Review past overcharges/refunds separately; this PR does not silently charge, credit, refund or alter an existing object.
4. Optionally write subscription metadata `foundingMember=1` and the verified ISO `foundingQualifiedAt`; the persisted DB grant is sufficient for this app. Metadata alone does not remove a future price switch.
5. Re-read the subscription/schedule and preview its next invoice to verify the intended recurring rate, quantity and taxes. Keep the review/audit evidence; repeat the read-only report until no unintended standard-price transitions remain.

New qualifying subscriptions after deployment do not receive the introductory renewal schedule. Old schedules are **not automatically released by a webhook or deploy**. Do not call this rollout complete until existing Stripe objects have been reconciled with approval.

Ensure the Stripe endpoint continues delivering checkout.session.completed, customer.subscription.updated/deleted and invoice.payment_succeeded. The handler also supports checkout.session.async_payment_succeeded, customer.subscription.created and invoice.paid; enable the applicable events and verify delivery in an isolated Stripe sandbox before release. Do not create duplicate subscriptions or a new price catalog as a migration shortcut. Tax configuration is unchanged; consider Stripe Tax/required registrations separately where applicable.

Official references, read through Stripe CLI 1.55.9:
- https://docs.stripe.com/api/subscription_schedules/release
- https://docs.stripe.com/api/metadata

## Verification

Story: signup/trial → server-owned Checkout → verified Stripe webhook → tenant/registry entitlement → no founder price-switch schedule → lifetime billing display.

```sh
npm run lint
npm run typecheck
npm run smoke
npm run test:founding
NODE_OPTIONS=--max-old-space-size=6144 npm run build
```

`test:founding` uses actual in-memory Postgres, the actual Prisma pg adapter, actual fresh-schema provisioning, the actual backfill CLI and globally intercepted synthetic Stripe HTTP responses. It checks the final PT minute, midnight exclusion, existing trial conversion, lifetime rendering, sticky cancellation, tenant isolation, fresh signup/replay, HMAC verification, unpaid Checkout facts, immutable Stripe price selection and unchanged non-founder schedules. It asserts founders produce no schedule writes; a pre-existing schedule is left for separate approved reconciliation. It also verifies report-only/idempotent data backfill and that demo/free-only accounts are not granted membership.

The full suite also passes with `TZ=America/Los_Angeles`, including UTC round-trips between raw backfill SQL and Prisma. Client-role insert/update/delete attempts cannot forge or clear founder entitlements.

No production credentials or real Stripe objects are used in these tests. Real Stripe sandbox checkout/renewal simulation and browser interaction verification remain release checks; do not claim live billing was exercised.
