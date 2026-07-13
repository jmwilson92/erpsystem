# ForgeRP security model

## Headers & transport

Every response carries hardened headers (see `next.config.ts`):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a locked-down
`Permissions-Policy`, and `Strict-Transport-Security` for HTTPS
deployments. `X-Powered-By` is disabled. Terminate TLS at your platform
or reverse proxy — the app assumes HTTPS in production.

## Authentication — read this before production

ForgeRP currently ships with **demo authentication**: identity comes
from an HttpOnly `forge-demo-user` cookie set by the in-app persona
switcher. This is deliberate — it makes evaluation plug-and-play — but
it is **not** production auth: anyone who can reach the app can switch
personas.

Before real use, put one of these in front of `getCurrentUser()`
(`src/lib/auth.ts`), which is the single identity chokepoint:

1. **NextAuth / Auth.js** with your IdP (Entra ID, Okta, Google) — map
   the session e-mail to the `User` row.
2. **A reverse-proxy SSO** (Cloudflare Access, oauth2-proxy) — trust the
   forwarded identity header, map to `User`.

Everything downstream (permissions, approvals, audit) already keys off
the resolved `User`, so swapping the identity source is contained.

## Authorization

- Central permission catalog (`src/lib/auth.ts` → `PERMISSIONS`) with
  per-role defaults, permission groups, per-user grants, and explicit
  denies (deny > grant > group > role).
- Every mutating server action re-checks permissions server-side; UI
  hiding is a convenience, never the control.
- Financial data is additionally gated (`userCanSeeFinancials`), and
  role-scoped views hide analytics/creation from operator roles.
- Rejections/voids require reasons and every sensitive mutation writes
  an `AuditLog` row (who, what, when, before/after).

## Data

- SQLite database file (or Postgres) — one file to encrypt at rest and
  back up. Demo "test drive" sandboxes are per-visitor throwaway
  databases isolated from the master file.
- CSV import/export endpoints are permission-gated per module.
- The custom report builder only exposes whitelisted entities and
  columns — user input never reaches query construction.

## Reporting a vulnerability

Open a private security advisory on the repository, or e-mail the
maintainer. Please do not open public issues for security reports.
