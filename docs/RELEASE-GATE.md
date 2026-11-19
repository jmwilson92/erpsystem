# Required release gate after the production schema incidents

Before EVERY further PR merge:

1. Pin the exact tested head. Review the complete Prisma schema / tenant-template / migration diff against current main AND the last verified production schema baseline. Zero source diff alone does not prove production schema health.
2. Regenerate the tenant DDL and check it matches current Prisma schema.
3. Use the approved Vercel sandbox runner to report production drift across public + all tenant/demo schemas. For any additive drift, review → apply/backfill **before merge and before promotion** → report again. No destructive/retyping DDL or forced NOT NULL on populated tables. Stop on any failure/manual backfill requirement. Use the candidate's published branch as `STALE_CHECK_REF` for candidate schema changes; never bypass the freshness check.
4. Verify all expected model columns, not just marketing `/` or a logged-out page. Current reference after #174: 225 tenant-template models × 10 tenant/demo schemas + 230 public models = 2,480 zero-row all-column probes; real Prisma `Account.findFirst` passes all 11 serving schemas.
5. Exact-head CI and preview green, `mergeable` true, pinned squash merge only. Production READY must match the merge SHA **and** the `www.protessera.com` / apex aliases. A finished production build is not live until those aliases actually point at it.
6. After promotion, required HTTP gates: `GET /login` returns 200 and renders the sign-in page, and `GET /api/health` shows `db` up. Marketing `GET /` 200 is not enough. Scan error/fatal runtime logs for P2022, P1000, and 28P01. Roll back to the previous healthy deployment if these fail. Logged-out HTTP 200 is still not authenticated-dashboard coverage; report that limitation honestly.
7. After any production database password reset: update Vercel `DATABASE_URL`, `DIRECT_URL`, and any other DB URL vars (Production, plus Preview if it uses the same database), create a **new** deploy so the new env vars take effect, then re-point www and the apex at that new deploy. Confirm the aliased deploy's build time is after the env update.
8. Fresh-main synthetic retest and reread/merge every bug register, preserving parallel findings. No customer-data mutation tests; no secrets printed; never force-push.

## Postmortem — LOGIN-001 (2026-11-18)

Two failures in one production incident.

**1. Backfill must precede promotion.** At 1:44:53 PM PT, #174 (`c4fe072`, `dpl_AVfscNrQWyzzdMRNSXcPqRdCk9YW`) became production without applying `CompanySettings.carinaVoiceActions` (boolean default false) and table `CarinaVoiceActionReceipt` to public and every tenant/demo schema. `GET /login` returned HTTP 500 (Prisma P2022). Service was restored at 1:53:02 PM PT by rolling www back to #173 (`fd088bf`, `dpl_Bb92VvXHempiXpdQCPenuKNHmwUH`). The additive backfill was then applied and re-reported clean (11 schemas, 2,480 probes). Do not promote a deploy that adds Prisma or tenant-template columns/tables until that backfill is done.

**2. After a DB password reset, update env, redeploy, and re-point the alias.** The owner reset the Supabase password, which caused P1000/28P01 while www still ran deploys built with the old credentials. Vercel `DATABASE_URL` and `DIRECT_URL` were updated at 3:40:46 PM PT. The #174 redeploy `dpl_J7b4w39Xkvbw1pttVvydDowt16mu` was READY and already healthy (`/login` 200, `/api/health` db up) at 3:43:10 PM PT, but www stayed on #173 until 3:45:51 PM PT. A “deployment finished” event does not move a previously rolled-back custom-domain alias.

Current healthy production as of 3:45:51 PM PT, 18 November 2026: main `c4fe072c17e0da99217078eae4e7d0b33757c9b1`, `dpl_J7b4w39Xkvbw1pttVvydDowt16mu`.
