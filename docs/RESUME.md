# Resume here when you're back

## Start clean (avoid SQLite lock hell)

```bash
# Nothing else should hit the DB
fuser -k 3000/tcp 2>/dev/null || true

# Production server is more stable for HTTP than turbopack
npm run build   # if not already built
ALLOW_DEMO_IN_PRODUCTION=1 DEMO_MODE=1 NODE_ENV=production npx next start -p 3000
```

## Run verification in order

```bash
# 1) Service suite (no server needed) — expect all green
npm run verify:svc

# 2) Money path alone
npm run verify:money

# 3) HTTP routes (server quiet, alone)
VERIFY_HTTP_GAP_MS=800 npm run verify:http

# 4) Browser (optional)
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e
```

## If HTTP flakes

- Run only a prefix: `VERIFY_HTTP_PREFIX=/pmo npm run verify:http`
- Don't run `verify:svc` and `verify:http` at the same time (same SQLite file)
- Timeouts / P1008 = DB lock, not necessarily a page bug

## Status board

| Area | Status |
|------|--------|
| Service A–I + C2 | **64/64 green** (`npm run verify:svc`) |
| Money path C2 | **9/9 green** (`npm run verify:money`) |
| HTTP J | **67/67 green** on prod (`npm run verify:http`) |
| Playwright | **73+ green** on prod; prefer prod server |
| Deploy | `DEMO_MODE=0`, seed off, HTTPS, backups |

## Next after green money + HTTP

1. Detail-route HTTP (`/sales/[id]` samples from DB)  
2. Kit/WO production leg of money path  
3. Tag `v0.9.0-beta.1` + plant Docker overlay  
