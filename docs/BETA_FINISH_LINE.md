# Beta finish line — ForgeRP productionization plan

**Date:** 2026-07-16  
**Goal:** Public beta-ready manufacturing ERP (SO → PR → PO → REC → WO → ship, plus CM/BOM/WI).

---

## Shipped in this batch

| Area | Change |
|------|--------|
| **Value stream** | High-capacity workcenters (NEAR/OVER) surface as stage watch/constraint + capacity issues list |
| **Timesheet** | Save path stays silent (no toast on grid save) |
| **Shipping** | Manual “Create shipping order” (SO optional, ship-to + lines) |
| **CM board** | Reject buttons fit the card; only **your** approver seat can Approve/Reject |
| **BOM** | Soft revalidate (no full-page redirect); UOM on lines; + quick-create part modal |
| **Prototype WO** | Build WI steps on the traveler; **Finish prototype** → ECR + WI in CM submissions; putaway path |
| **BOM cert production** | Requires completed prototype WO **and** RELEASED WI for the part |

---

## Remaining work to cross the finish line

### P0 — Must fix before inviting beta users

1. **E2E smoke scripts** (Playwright or manual checklist automation)  
   - SO plan → PR → PO issue → receive (dock + child RCV) → kit → start WO → sign steps → RCV putaway → ship  
   - Prototype: BOM prototype cert → prototype WO → add WI steps → finish → CM release WI → BOM production cert  
   - **Shipped:** unit smoke `npm run smoke` + GitHub Actions CI. Full browser E2E still open.

2. **Auth & demo mode**  
   - Document demo PINs / personas; ensure production `DEMO_MODE=0` path is tested  
   - Session timeout, password reset, invite user flow  
   - **Shipped:** boot guard, login rate limit, persona switcher off in prod, role-hint impersonation removed, PIN fail-closed (no default 1234)

3. **Data durability**  
   - Postgres path (docker-compose) verified for beta; SQLite only for local demo  
   - Backup / restore runbook  
   - **Shipped:** backup notes in `docs/DEPLOYMENT.md`; full Postgres dual-mode still open

4. **Permissions**  
   - Spot-check: buyer can’t approve CM seats, operators can’t certify BOM, etc.  
   - **Shipped:** hard `requirePermission` on core mutations (receive, BOM, kit, plan, MRS, ship, pack, CM, budgets, MRB, ASL, timesheet process, etc.); report/search APIs gated  

### P1 — Strongly recommended for beta quality

5. **Receiving / floor polish**  
   - Capacity alerts on floor board; RCV-01 always seeded  
   - Edge cases: partial kit, multi-child travelers  

6. **CM document ECR**  
   - Reject reason required on board (optional comment field)  
   - Two-approver assignment UX for non-doc ECRs  

7. **Shipping**  
   - Manual shipment inventory issue (deduct stock on ship)  
   - Carrier/tracking validation  

8. **BOM**  
   - Multi-level roll-up cost performance on large BOMs  
   - Line edit (qty/UOM) without remove/re-add  

9. **Observability**  
   - Error boundary pages (no raw stack for users)  
   - Basic health endpoint + logging for support  
   - **Shipped:** `/api/health`, `error.tsx`, `global-error.tsx`  

### P2 — After first beta cohort

10. **Mobile layout pass** (radiators, CM board, kitting)  
11. **Import/export** (parts, customers, opening balances)  
12. **Email notifications** (PR approvals, CM votes)  
13. **Advanced MRP / capacity planning UI**  

---

## Suggested beta phases

| Phase | Audience | Exit criteria |
|-------|----------|----------------|
| **Internal dogfood** | Your team + 1–2 friendly operators | Smoke checklist green 3 days in a row |
| **Closed beta** | 3–5 external plants | Critical bugs ≤ 48h SLA; no data loss |
| **Open beta** | Public waitlist | Docs + demo dataset + support channel |

---

## One-page smoke checklist (print this)

- [ ] Create/update customer & part  
- [ ] SO → plan fulfillment (WOs + PRs as needed)  
- [ ] Buyer package / PO issue  
- [ ] Receive mixed dock + QA/Test children  
- [ ] RCV-01 putaway after station work  
- [ ] Kit + start production  
- [ ] Sign steps; handoff Mfg → QA shows guide + scrolls top  
- [ ] Deliver finished WO to RCV putaway → stock  
- [ ] Ship SO packing list  
- [ ] Manual ad-hoc shipment  
- [ ] Prototype: WI steps on WO → finish → CM board shows ECR  
- [ ] Release WI → certify BOM for production  
- [ ] CM: cannot vote another approver’s seat  
- [ ] Timesheet save without noisy toast  
- [ ] Value stream shows capacity issues when OVER/NEAR  

---

## Repo / release hygiene

```bash
# Local
npx prisma db push
npx tsc --noEmit
# optional: npm run build

# Ship
git push origin main
```

Tag when dogfood is green: `v0.9.0-beta.1`.

---

## Ownership notes

- **Receiving workcenter** for inbound RCV-T *and* finished WO putaway is intentional.  
- **PRs** are planned from SO/MRS — not spam-created from the WO traveler.  
- **Production BOM cert** is gated by prototype complete + released WI (CM).  

This document is the working beta plan; update checkboxes as items clear.
