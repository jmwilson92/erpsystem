# ForgeRP full verification inventory

**Goal:** Prove every major surface works before public beta.  
**Method:** Chunked automation (service + HTTP + Playwright). Failures block the chunk.

| Chunk | ID | Coverage |
|-------|-----|----------|
| A | `db` | Schema connectivity, referential integrity, seed health |
| B | `auth` | Permissions matrix, login rate limit, PIN fail-closed, demo mode |
| C | `sales` | Quote/SO create, plan fulfillment, ship preflight, pack gate |
| D | `supply` | PR/PO, receive, inventory, ASL, kanban |
| E | `mfg` | WO, kit, start production, sign-off PIN, WI |
| F | `quality` | NCR/MRB disposition hooks, QA/test procedures present |
| G | `pmo` | Projects, WBS tree, charge codes, budgets enact |
| H | `hr` | Timesheet structure, PTO permissions |
| I | `accounting` | GL accounts, journal posts readable |
| J | `http` | All list routes return &lt;500 (prod server) |
| K | `ui` | Playwright nav + core flows |

Run:

```bash
npm run verify:svc              # A–I, no server
npm run verify:http             # J, needs server
npm run verify                  # all
npx tsx scripts/verify/run-all.ts --chunk=C,G
```

**Status:** Service chunks A–I are automated. HTTP (J) and Playwright (K) need a running app — prefer `npm start` after build for stability.
