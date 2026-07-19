# Production & closed-beta rollout notes

Implementation status for the endgame plan (2026-07-17).

## Shipped in this hardening pass

| Workstream | Deliverable |
|------------|-------------|
| **WS0** | `.env.production.example`, `docker-compose.prod.yml`, `SECURITY.md` rewrite, `DEPLOYMENT.md` |
| **WS1** | Boot guard (`src/instrumentation.ts`), login rate limit, persona switcher hidden + blocked when `DEMO_MODE=0` |
| **WS2** | Hard `requirePermission` / `requireUser`; gates on BOM certify, CM vote, budgets, ship SO; `budgets.manage` permission |
| **WS3** | GitHub Actions CI, `npm run smoke`, `assert:prod-env` |
| **WS5** | `/api/health`, `error.tsx`, `global-error.tsx`, Docker healthcheck |

## How to run

```bash
# Local evaluation (demo data, switcher)
npm run setup && npm run dev

# Offline smoke
npm run smoke
npm run typecheck

# Plant / paid instance (Docker)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# Claim admin on first visit → /login bootstrap
```

## Still open (next sprints)

- Full browser E2E (Playwright) of SO→ship + prototype cert path  
- Systematic permission audit of remaining `actions.ts` mutations  
- First-class Postgres dual-mode (no manual provider edit)  
- Real SMTP verification for invites  
- Object storage for attachments  
- Offline price sheet + sales funnel CTA upgrade  

## SKU reminder (modules)

| SKU | Modules on |
|-----|------------|
| Floor | manufacturing, supplychain, quality, sales |
| Ops | Floor + accounting + hr |
| Enterprise | all (`pmo`, full suite) |

Configure via **Admin → Settings** / `disabledModules`.
