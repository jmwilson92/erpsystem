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
