# ForgeRP security model

## Headers & transport

Every response carries hardened headers (see `next.config.ts`):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a locked-down
`Permissions-Policy`, and `Strict-Transport-Security` for HTTPS
deployments. `X-Powered-By` is disabled. Terminate TLS at your platform
or reverse proxy — the app assumes HTTPS in production.

## Authentication

ForgeRP supports two identity modes:

### Production (`DEMO_MODE=0`) — required for plant deploys

- Email + password (scrypt), HttpOnly `forge-session` cookie, 30-day sliding sessions.
- First-boot **claim instance** when no passwords exist yet (`bootstrapFirstAdmin`).
- Invites and password resets via token links (`/invite/[token]`).
- Login rate limit: 10 failures / 15 minutes per e-mail (in-process).
- Middleware redirects unauthenticated traffic to `/login`.
- Persona switcher is **hidden and blocked**.
- Server boot **exits** if `NODE_ENV=production` and `DEMO_MODE` is not `0`
  (unless `ALLOW_DEMO_IN_PRODUCTION=1` for intentional public demo hosts).

Identity chokepoint: `getCurrentUser()` in `src/lib/auth.ts` (session via
`getSessionUser()` in `src/lib/auth-core.ts`).

### Evaluation / test-drive (default when `DEMO_MODE` is unset)

- Open app + sidebar **Demo Mode** persona switcher (`forge-demo-user` cookie).
- Used for local demos and `/demo` sandboxes only.
- **Never** leave this on for a customer plant with real data.

### Optional future SSO

Swap at `getCurrentUser()`:

1. **NextAuth / Auth.js** with Entra ID, Okta, Google — map e-mail → `User`.
2. **Reverse-proxy SSO** (Cloudflare Access, oauth2-proxy) — trust forwarded identity header.

## Authorization

- Central permission catalog (`src/lib/auth.ts` → `PERMISSIONS`) with
  per-role defaults, permission groups, per-user grants, and explicit
  denies (deny > grant > group > role).
- Mutating server actions should call `requirePermission(code)` (hard gate).
  Critical paths already gated: BOM certify, CM vote, budgets, ship SO.
- UI hiding is a convenience, never the only control.
- Financial data is additionally gated (`userCanSeeFinancials`).
- Sensitive mutations write an `AuditLog` row (who, what, when, metadata).

## Modules as packaging

`CompanySettings.disabledModules` turns licensed modules off; routes redirect
to `/module-off`. This is the commercial SKU surface (“buy parts of the suite”),
not multi-tenant isolation.

## Data

- Default: SQLite database file (Docker volume `/data`). Optional Postgres
  path is documented for higher concurrency.
- Demo “test drive” sandboxes are per-visitor throwaway SQLite copies
  isolated from the master file (`forge-sandbox` cookie).
- CSV import/export endpoints are permission-gated per module.
- The custom report builder only exposes whitelisted entities and
  columns — user input never reaches query construction.

## Production checklist (short)

- [ ] `DEMO_MODE=0`
- [ ] `SEED_ON_FIRST_BOOT=0`
- [ ] HTTPS reverse proxy
- [ ] Database backups scheduled
- [ ] Admin claimed via first-boot or invite
- [ ] Role permissions reviewed under **Admin → Permissions**
- [ ] `/api/health` monitored

See `docs/DEPLOYMENT.md` and `.env.production.example`.

## Reporting a vulnerability

Open a private security advisory on the repository, or e-mail the
maintainer. Please do not open public issues for security reports.
