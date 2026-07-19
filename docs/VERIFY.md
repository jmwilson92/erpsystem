# ForgeRP verification program (endgame)

This is how we **prove the ERP works** before putting it on the web.

## Inventory

| Layer | Count | How we test |
|-------|------:|-------------|
| App routes (`page.tsx`) | ~118 | Chunk **J** HTTP smoke + Playwright nav |
| Server actions | ~285 | Permission gates + service tests on critical path |
| Domain services | ~50 files | Chunks **A–I** service integration |

Full chunk list: `scripts/verify/INVENTORY.md`

## Commands

```bash
# Service layer only (no server) — fast, CI-safe
npm run verify:svc

# HTTP list routes (server must be up)
npm run dev   # terminal 1
npm run verify:http   # terminal 2

# Everything service + HTTP
npm run verify

# Browser E2E
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e

# Single chunk
npx tsx scripts/verify/run-all.ts --chunk=C,G
```

## Current green bar (service)

As of last run: **55/55 service checks pass** across:

- A Database integrity  
- B Auth & permissions  
- C Sales & ship pack gates  
- D Supply chain  
- E Manufacturing / kit gate  
- F Quality  
- G PMO / charge codes  
- H HR / timesheets  
- I Accounting / journal balance  

## HTTP / UI notes

Dev (`next dev --turbopack`) can **exhaust memory** after compiling many routes in a row. That shows up as `fetch failed` mid-suite, not necessarily a broken page.

Mitigations:

1. Prefer `npm run build && npm start` for HTTP/E2E  
2. Chunk J uses retries + 400ms spacing  
3. Re-run failed routes alone:  
   `VERIFY_BASE_URL=http://127.0.0.1:3000 npx tsx -e '...'`

## Definition of “ready for the web”

- [x] Service verification green (`npm run verify:svc`)  
- [ ] HTTP list routes green on **production** server  
- [ ] Playwright nav green on production server  
- [ ] Money-path scripted (SO→ship) green once  
- [ ] Plant deploy: `DEMO_MODE=0`, seed off, backups  
- [ ] Dogfood smoke checklist 3 days  

## Expanding coverage

Add a check in the right chunk file under `scripts/verify/`:

```ts
await check("C", "my new rule", async () => {
  // throw on failure
});
```

Wire new chunk IDs into `scripts/verify/run-all.ts`.
