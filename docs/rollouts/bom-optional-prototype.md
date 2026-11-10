# Optional prototype BOM certification

Do not deploy this code until the additive backfill has succeeded in every app schema.
This branch does not run migrations during deploy. No production backfill has been run.

## Exact database delta

No new tables. In `public`, each `tenant_*` and each active `demo_*` schema:

```sql
ALTER TABLE "BomHeader" ADD COLUMN IF NOT EXISTS "prototypeRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "bomPrototypeRequired" BOOLEAN NOT NULL DEFAULT true;
```

Existing revisions retain the prototype gate. Existing certified revisions are not
uncertified, and no work orders, billing settings, roles or signatures are rewritten.

From a current checkout of this pushed branch, using the established secure DDL connection
(`STALE_CHECK_REF` validates against this branch before merge, not the older main schema):

```sh
node scripts/gen-tenant-ddl.mjs
STALE_CHECK_REF=origin/feat/bom-optional-prototype npx tsx scripts/backfill-tenant-schemas.ts --bom-only --include-public --include-demos
# Inspect the report. Then an authorized operator runs:
STALE_CHECK_REF=origin/feat/bom-optional-prototype npx tsx scripts/backfill-tenant-schemas.ts --bom-only --include-public --include-demos --apply
# Repeat the report; both columns should exist everywhere before merge/deploy.
```

`--bom-only` adds only these two columns, refuses schemas missing the source tables,
and never provisions tables into service/extension schemas. Do not use Prisma db push
as a substitute: it only updates one schema.

## Behavior

- Company Settings > BOM certification default selects the default for NEW revisions.
  The default remains prototype-required unless an admin changes it.
- BOM detail > Certification path overrides that default for the current revision,
  with BOM certification permission and an audit entry. Locked certified/obsolete
  revisions require a new revision. An in-progress prototype can explicitly switch
  to the direct route; the choice and final route are audited.
- Direct: DRAFT / IN_REVIEW (or an in-progress PROTOTYPE) -> PIN-sign -> CERTIFIED.
  Neither a completed prototype WO nor a prototype-derived released WI is required.
- Prototype-required: PIN-sign for prototype -> complete prototype WO -> release WI
  via CM -> PIN-sign production certification. The existing WI gate is preserved.
- Both sign-offs use the authenticated person's own PIN. Caller-supplied signer IDs
  are ignored. Certification and audit evidence commit together. PINs are not logged.
- Production WOs must select a CERTIFIED BOM at creation and are re-checked at
  release/start. Standalone and SO-driven WOs share the same service guard. SO
  planning without a certified BOM reports NO_BOM rather than creating a make WO.
- Prototype WOs retain their existing uncertified-BOM statuses. Task-only, rework and
  inspection orders retain their existing behavior.
- The old `asPrototype` creation flag now starts a DRAFT on the prototype-required
  path, rather than falsely treating the creation as a completed certification.

## Verification

`npm run test:bom` creates a local-only WASM Postgres fixture and uses the real Prisma
adapter/services. It tests both paths, PIN/permission/identity checks, certification
history, tenant defaults/isolation, additive DDL over existing data and idempotence,
standalone creation/release/start failures, and SO-driven work order selection.

No live checkout, Stripe call or production data write is part of these tests.
