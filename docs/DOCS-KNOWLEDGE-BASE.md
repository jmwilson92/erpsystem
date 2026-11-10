# Docs knowledge base

## Included

- `/docs`: tenant-local spaces, title/body search, recently updated pages and a page tree.
- Templates: blank, controlled SOP, engineering decision, meeting notes and runbook, plus any page marked as a reusable template.
- TipTap editor: headings, bold/italic/underline/strike, lists, quotes, code, links, undo/redo. JSON is validated server-side; read views use safe React rendering, not stored HTML.
- Every save creates a revision. Optimistic version checks prevent lost updates; page moves reject cycles and cross-space parents. Controlled pages cannot be downgraded to uncontrolled pages.
- History shows author, summary, time, hash, signatures and a bounded line diff (first 500 text lines). Restore copies old content into a **new draft**; no revision is overwritten.
- Comments carry the revision they refer to and can be resolved by their author or an editor.
- Explicit two-way record links and backlinks: active EngTask tickets, legacy EngineeringTicket records, work orders, items/parts, NCRs, PMO programs, and other Docs pages. Legacy ticket and NCR read-detail routes are included. Target existence and view permission are checked inside the request tenant schema.
- Controlled-doc release uses the same extracted PIN verifier as work-order travelers, test procedures and GFP approvals. The signer comes from the current session, not form data. A signature binds the actual person's ID/name, meaning, time, immutable revision and SHA-256 hash. Edits and restores require a fresh signature for the new version. The existing PIN storage format is unchanged.
- Database triggers reject UPDATE/DELETE/TRUNCATE of revisions and signatures. RLS denies client API roles; this app uses server-side Prisma/session authorization, not Supabase Auth policies. Table owners/DBAs can still alter triggers, so this is not a claim of tamper-proof storage or regulatory certification.

## Access

`docs.view` is available to existing app roles unless explicitly denied. `docs.comment` defaults to signed-in users. Engineering, CM, Quality and PM can edit by default; direct permission/group grants can override this. `docs.sign` has **no job-role default** and must be assigned to an actual individual using Admin → Roles & Permissions (ADMIN retains the app's existing administrative access). Switching role alone does not grant controlled-document sign-off rights. Turning off the Docs module blocks its services and hides it from navigation.

Spaces are organizational containers, not private ACL boundaries. All authorized Docs readers in a tenant can see all its spaces. Other tenants remain isolated by the existing schema/session routing. Restricted record names are not shown to users lacking the corresponding module's view permission.

## Production rollout — do not run from an old checkout

No existing business model gains columns. Six new tenant tables are additive: DocSpace, DocPage, DocRevision, DocSignature, DocComment, DocLink. Prisma, the DDL generator, generated tenant template, and existing-tenant backfill are updated together. Backlink widgets tolerate missing Doc tables during rollout so an unbackfilled tenant does not break its work-order/item/program/task screens.

After an approved merge, from a checkout of the new main (using the deployment's normal secure direct DB connection, never a URL pasted into a command):

```sh
git checkout main
git pull --ff-only origin main
npm ci
node scripts/gen-tenant-ddl.mjs
# Read-only report, including public dogfood and existing demo schemas:
npx tsx scripts/backfill-tenant-schemas.ts --docs-only --include-public --include-demos
# Approved additive application (tables, indexes, FKs, RLS, append-only evidence):
npx tsx scripts/backfill-tenant-schemas.ts --docs-only --include-public --include-demos --apply
# Repeat report: all six Doc tables should be present everywhere:
npx tsx scripts/backfill-tenant-schemas.ts --docs-only --include-public --include-demos
```

`DIRECT_URL` (preferred) or `DATABASE_URL` must already be securely configured. `--include-public` is explicit because the original backfill skipped the public dogfood schema. `--docs-only` limits this rollout to the six new tables and their hardening; it does not repair unrelated model drift. There is no `prisma db push`, reset, destructive migration, or automatic production backfill on deploy. Failed backfill operations now produce a nonzero exit status. New tenant provisioning receives the generated tables and hardening automatically.

On a server using a non-owner/non-BYPASSRLS database role, configure an appropriate **server-only** role policy before enabling Docs; do not grant access to client anon/authenticated roles.

## Verification

```sh
npm run lint
npm run typecheck
npm run smoke
npm run test:docs
NODE_OPTIONS=--max-old-space-size=6144 npm run build
```

`test:docs` boots an in-memory WASM PostgreSQL instance on loopback, using the production Prisma pg adapter. It never reads production credentials. It exercises content validation, templates/tree, revision conflicts, comments, PIN identity, release/restore, immutable evidence, record links/backlinks, permission denies, tenant-isolated reads, and the actual backfill twice against a pre-existing schema. The fixture sets `DATABASE_POOL_MAX=1` because PGlite has one backend session; the app supports optional `DATABASE_POOL_MAX` tuning (1–20, default 10, unchanged). It is not a substitute for a staging Supabase smoke test or a real concurrent multi-connection load test.

## Intentionally not included

No real-time collaborative editing, attachments/file upload, import/export, email notifications, public sharing, per-space ACLs, automatic backlink extraction from arbitrary pasted URLs, multi-approver review workflow, or full-text indexing. Search is bounded title/plain-text matching; large installations may want a GIN/tsvector index and pagination. History is capped to the latest 200 revisions; comments display the first 200. The explicit link picker and record-side widgets create two-way references. UI browser verification and production backfill must be completed before release.
