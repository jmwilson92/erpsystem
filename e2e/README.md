# ForgeRP browser E2E (Playwright)

## Honest scope

| Possible | Not realistic as “one green bar” |
|----------|----------------------------------|
| Auto-open **every module page** and assert it renders | Click **every** button / every branch of every form |
| Script **money-path** flows (SO→ship) with seed data | Full aerospace certification / exploratory QA |
| Permission / API regression checks | Replace human dogfood on the floor |

This ERP has **60+ routes** and **hundreds** of server actions. Playwright can cover **navigation + critical paths**. “Test every single thing” is a multi-week suite, not one command.

## Suites

| Suite | Purpose |
|-------|---------|
| `nav-smoke.spec.ts` | Hits major module URLs — no 500 / app crash |
| `core-flows.spec.ts` | Lists, APIs, forms reachable, PMO budgets tab |

## Run (recommended)

```bash
# Prefer production server for stability (dev/turbopack can OOM under rapid navigation)
npm run build
ALLOW_DEMO_IN_PRODUCTION=1 DEMO_MODE=1 NODE_ENV=production npm start &

npx playwright install chromium   # once
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

Or against `npm run dev` (flakier under load):

```bash
npm run dev   # terminal 1
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e   # terminal 2
```

HTML report: `npx playwright show-report`

## Observed in this environment

- Navigation smoke: **~24 consecutive module pages green** on turbopack before the **dev server died** (memory / empty response on heavy routes like `/products`).
- That is an **infra/stability** issue for E2E, not proof those modules are broken in normal interactive use.
- Use **production build** for CI E2E when possible.

## Expanded suites (added by the full E2E pass)

| Suite | Server mode | Covers |
|-------|-------------|--------|
| `full-crawl.spec.ts` | `DEMO_MODE=1` | **Every** route (static + dynamic detail pages w/ real ids): no 500, no error boundary, no console errors. 122 routes. |
| `marketing.spec.ts` | `DEMO_MODE=0` | Landing header/footer/CTAs, pricing plan pre-select + single "Most popular", signup validation, legal (entity/45-day/no-template), login, onboard invalid-token, demo splash. |
| `authed-app.spec.ts` | `DEMO_MODE=0` | Real login, header dropdowns **with occlusion check** (z-index), sidebar nav, logout. Needs `admin@forge.erp` / `Test1234!`. |
| `demo-flow.spec.ts` | `DEMO_MODE=0` | Start test drive → sandbox banner + convert CTA → persona switch → browse module → convert → end. Needs `demo_template` seeded. |
| `tenant-lifecycle.spec.ts` | `DEMO_MODE=0` | Claim workspace → setup wizard → trial banner shows plan → `/admin/tenants` refused for tenant admin → re-login routes to own tenant. |
| `write-actions.spec.ts` | `DEMO_MODE=0` | A real create action (customer) → server action → DB → list. |

### Two server modes
- **`DEMO_MODE=1`** (no login): `full-crawl`, `nav-smoke`, `core-flows`.
- **`DEMO_MODE=0`** (production auth) + a dummy `STRIPE_SECRET_KEY`: `marketing`, `authed-app`, `demo-flow`, `tenant-lifecycle`, `write-actions`.

### One-time fixtures / preconditions
```bash
# seed public, set the login password, build the demo template, provision a tenant
npm run db:seed
# set admin password to Test1234! (see harness) ; build demo template:
npx tsx scripts/build-demo-template.ts
# regenerate the crawl route list for your seeded DB:
npx tsx scripts/e2e-dump-ids.ts               # -> e2e/crawl-urls.json (gitignored)
npx tsx scripts/e2e-provision-fixture.ts      # -> e2e/tenant-fixture.json (gitignored)
```

### Local Chromium (version-pinned envs)
If the pinned `@playwright/test` fetches a browser build that isn't present, run with a
local config that points `launchOptions.executablePath` at the installed chromium
(e.g. `/opt/pw-browsers/chromium-<n>/chrome-linux/chrome`) via `--config=playwright.local.config.ts`.
