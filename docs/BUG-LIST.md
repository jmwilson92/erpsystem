# Protessera Bug List (live)

Updated: **2026-11-09 10:28 PM PST**. Owner: Jeramey Wilson.
Live Google Doc: https://docs.google.com/document/d/1DfNkpBAHioliXV4_RVWPRfjkF5XkfyoCuf3LS7xZHJI/edit
GitHub copy: https://github.com/jmwilson92/erpsystem/blob/bugs/live-list/docs/BUG-LIST.md

## Honest coverage and safety

This is a persistent, incomplete QA register—not a claim that every function works. Baseline: fetched main **18a6b87e3f62e6f16f75f2b6163ba0131cfcba12** (#142). Separate local worktree `/workspace/erpsystem-bugs`, branch `bugs/live-list`. BOM certification code and the separate #143 development branch are untouched. No product bugs were fixed here. Retest this register after #143 lands.

All mutation tests use the same disposable, loopback-only WASM PostgreSQL fixture containing synthetic data. Environment cleared before launch; no production credentials loaded, no real email sent, no Stripe calls/charges, no real customer data changed. No production writes. Rejected operations intentionally leave some corrupted synthetic records for evidence.

Authorization follow-up now includes **genuine password login and server-issued sessions for six roles** on a strict-auth local server with DEMO_MODE=0. OPERATOR customer/item/forecast/GL writes, unauthorized QA acceptance, ACCOUNTING immediate-post and concurrent approval defects were reproduced via actual HTTP requests. Native emitted forms were used where available; client-wrapped actions used canonical React encodeReply/Next-Action RPC metadata from this local build. No session tokens were forged, extracted from another account, or published. Anonymous page/customer-write denial and logout revocation passed. **This proves local authenticated HTTP defects, not production exploitation.**

**Callable functions (actions + API handlers + exported library/service functions): 278 tested — 251 pass / 27 fail; 1,252 untested of 1,530.**
**Full source inventory including pages/models: 444 tested — 417 pass / 27 fail; 1,505 untested of 1,949.**

A pass means only the named scenario, not every branch/argument/state or the whole module. A function with any reproduced failure stays FAIL even when other scenarios pass. Models remain untested CRUD acceptance; page passes are server render only.

| Inventory kind | Pass | Fail | Untested | Scope |
|---|---:|---:|---:|---|
| page | 166 | 0 | 24 | Server render only; UI actions still need acceptance |
| action | 52 | 17 | 499 | Named native-HTTP/direct-handler scenarios; see evidence |
| api | 11 | 0 | 14 | Specific request/response only |
| service | 188 | 10 | 739 | Named direct calls/guards, not exhaustive branches |
| model | 0 | 0 | 229 | Schema loads; per-model CRUD/permissions not accepted |

## Test evidence

- Current-main full production build and typecheck: PASS after generating a private current-schema Prisma client. Preliminary stale-client failures were QA tooling artifacts, not product bugs.
- Existing service verification: **71 passed / 0 failed**. DB integrity, permissions, SO fulfillment, stock → pack → ship, duplicate-shipping gate, PMO charge codes, kit gate, serial/RMA repair/warranty. Several checks only prove records exist/query successfully.
- Added workflow checks: **83 passed / 5 failed**. CRM, field-service dispatch through completion, BOM validation, cycle counts, planning, GL journals, capacity, maintenance, accounting/GovCon summaries and **all 28 report catalog keys + CSV serialization**.
- Production-build HTTP sweep: **173 passed / 0 failed; 24 pages need fixtures/UI**. This is **166 page renders + 7 API/export/negative-webhook checks**. Initial errors were corrected test URLs or missing local control-plane tables; retest green, not product bugs.
- Offline smoke: 12 grouped checks passed. Docs integration passed: tree, stale-save conflict, restore, own-PIN signature, record links, individual permissions, tenant isolation, client-role denial, backfill idempotence. Founding integration passed: Pacific deadline, sticky grants, intercepted Checkout/webhooks, fresh tenant provisioning, schedule exclusion.
- Box evidence: `/workspace/protessera-dryrun/results/` — service-results.json, extra-results.json, http-results.json, inventory.json, summary.json, build.log, typecheck-current-client.log, docs.log, founding-current-client.log. Local connection settings/secrets are NOT included in this document or Git.


### Priority continuation

**47 added targeted scenarios: 36 pass / 11 fail. Nine new bug entries; PUR-001 re-confirmed, not counted as new.** These scenario counts are separate from deduplicated function counts.

| Suite | Pass | Fail | Coverage |
|---|---:|---:|---|
| Server actions / permissions / chain | 22 | 6 | Six real HTTP creates; customer PO→SO→existing certified-BOM WO→materials→kit→issue→production→own-PIN traveler→Receiving→stock; standalone task create; PR and JE approval/rollback |
| Purchasing / finance | 6 | 4 | Standalone PR→buyer→approval→PO/traveler→dock receiving; repeat conversion and overreceive guard; AR/AP rollback, journal SoD and reversal classification |
| Demo lifecycle | 6 | 0 | Local template clone, provision, schema isolation, heartbeat/destroy, stale expiry sweep; actual native start→cookie→render→ping204→end303 |
| Standalone manufacturing / retry | 2 | 1 | Standalone certified-BOM production action with no SO; OPERATOR SO-planning denial; multi-line short-kit retry inventory |

Passing highlights: complete synthetic quote/customer PO/SO production chain reaches COMPLETED with stock; standalone production and task-only creation both work (task-only completion remains WORK-002); wrong-person PR approval and unauthorized PR/SO planning are rejected without writes; invalid SO FKs roll back header/lines; ordinary JE approval requires a different accountant and repeat approval is idempotent; closed-period direct journal writes are rejected without a new JE. PR/PO/receiving functional success does NOT clear the existing same-admin segregation bug.

Evidence on box: `results/priority-results.json`, `demo-results.json`, `demo-http-flow.json`, `finance-supply-results.json`, `finance-failure-evidence.json`, `manufacturing-edge-results.json`, `kit-resume-evidence.json`; final logs `priority-current.log`, `demo.log`, `finance-supply-current.log`, `manufacturing-edge-current.log`. Repro scripts preserved under `/workspace/protessera-dryrun/repro/`. Preliminary harness field/redirect mistakes were corrected and are NOT product bugs. Local connection settings and PINs are not in this document or Git.

### Second continuation: quality, reconciliation, concurrency and real sessions

**78 targeted scenarios: 51 pass / 27 fail. 16 new findings (15 confirmed defects + 1 overpayment policy gap); 51 total tracked.** Existing permission issues and task-only completion were re-confirmed, not counted as new. Two overpayment assertions are policy/workflow checks pending confirmation, not evidence of lost funds.

| Suite | Pass | Fail | Scope |
|---|---:|---:|---|
| auth | 10 | 8 | Six real-role password/session logins; native/canonical HTTP actions, anonymous denial/logout, wrong privilege and journal race |
| quality | 9 | 8 | QA→functional→stock, evidence/repeat gates, NCR/MRB, partial scrap and serial validation/identity |
| finance | 11 | 6 | Isolated JE/account reconciliation, concurrent approval, AR/AP overpayment/dates, WIP/variance/GFP/adjustments and task completion |
| demo | 5 | 1 | Native reset/leave; pool claim isolation/exhaustion/refill race/stale recycling |
| modules | 16 | 4 | All exported CRM and field-service action handlers exercised on valid or invalid paths; not full permission/branch acceptance |

Passing highlights: QA requires documents; VISUAL/GDT pass opens functional test, functional pass returns material to dock, putaway releases stock. Failed inspection quarantines stock and creates NCR/MRB; valid use-as-is and formal closure work. Ordinary AR/AP partial/full payment totals reconcile. Isolated pending→approve→reversal nets account balances; manufacturing material/labor/fringe/OH (not G&A), WIP relief/variance, GFP scrap exclusion, adjustment and OSP postings balance. Concurrent demo claims remain distinct, exhausted pool cold-starts, reset/leave and stale READY recycling preserve public/active fixtures. CRM and service valid create/update/convert/activity/dispatch/labor/parts/complete/removal flows pass.

Evidence: `results/round2-{auth,quality,finance,demo,modules}-results.json`; final logs `round2-auth-final.log`, `round2-quality.log`, `round2-finance-current.log`, `round2-demo-current.log`, `round2-modules.log`; `demo-pool-race-evidence.json`. QA-only harness mistakes were corrected and are not bugs. Repro scripts copied to `/workspace/protessera-dryrun/repro/qa-round2-*.ts`. Synthetic test credentials/session tokens are not logged in these reports.

## Highest priority

1. **ACCT-006:** Two authenticated approvals of one 10-unit journal leave account balance 20 while posted lines remain 10.
2. **AUTH-002–005 / ACCT-001 / ACCT-003:** Real logged-in operator can mutate customer/item/forecast/GL and accept QA without required privileges; immediate posting bypasses SoD. Anonymous write denial does work.
3. **MRB-001 / SERIAL-001–002 / KIT-001:** Partial scrap removes all held units, serialized receipts accept invalid/no identities, and short-kit retries duplicate WIP stock.
4. **ACCT-002 / ACCT-004–005 / ACCT-007:** Failed posting still commits subledger, historical payment JE dates are wrong, and dedicated approvers are denied by the wrong permission gate.
5. **DEMO-001:** Three concurrent refills create six spares despite target two, risking uncontrolled database storage/load.
6. **PUR-001 / GOVCON-001 / SALES-003 / WORK-002 / BOM-001:** Existing same-person PR approval, reversal allowability, quote retry corruption, task completion dead end and no-BOM production gap remain. BOM certification code is untouched (#143 separate).

## Bug register

**51 tracked entries:** 22 historical observations/UX gaps + 4 first-pass defects + 9 first-continuation defects + 16 second-continuation findings (15 defects + 1 policy gap). Historical/UI-only reports remain explicitly labeled. No product fixes or merges.

### ACCT-006 — Concurrent approval double-applies one journal to account balances
- Module: Accounting / concurrent approval | Severity: **high** | Status: FIXED (atomic updateMany claim in approveJournal; balances applied only on successful claim) via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Create pending balanced JE of 10 against isolated fresh accounts; invoke approveJournal concurrently twice. Also repeat via two genuine ACCOUNTING-session HTTP actionApproveJournal requests.
- Expected: One posted entry and one balance application: debit account=10.
- Actual: One journal and its lines total 10, but the debit account balance becomes 20. Reproduced in both service calls and authenticated HTTP requests, so cached account balances no longer reconcile to posted lines.
- Suspect: `src/lib/services/gaap.ts:763-803; src/app/actions.ts:8641-8655`

### AUTH-005 — Operator without qa.inspect can accept a receiving inspection over HTTP
- Module: Accounts / QA acceptance | Severity: **high** | Status: FIXED (actionCompleteReceivingInspection now requires qa.inspect) via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Password-login as synthetic OPERATOR; verify qa.inspect=false; submit actual actionCompleteReceivingInspection RPC with a pending fixture inspection, PASS and a local evidence URL.
- Expected: Reject before inspection/results/status mutation.
- Actual: Inspection changes PENDING→PASSED under the unauthorized real session. Anonymous customer writes are blocked; logged-in privilege checks are the defect.
- Suspect: `src/app/actions.ts:4205-4264`

### MRB-001 — Partial scrap disposition removes all quarantined stock
- Module: MRB / inventory reconciliation | Severity: **high** | Status: FIXED (disposition quantity decremented instead of zeroing the lot) on baseline #142 in isolated synthetic local fixture
- Steps: Receive and fail five units at unit cost 10; dispositionMrb SCRAP quantity 2; sum remaining on-hand for that new part.
- Expected: Remove two and retain three units with an appropriate remaining hold/disposition state.
- Actual: All five units are removed: on-hand=0 rather than 3. Code zeros the entire held item while the disposition/material transaction quantity is only 2.
- Suspect: `src/lib/services/supply-chain.ts:1479-1515`

### SERIAL-001 — Serialized receiving accepts missing, mismatched and duplicate serial lists
- Module: Receiving / serialized material | Severity: **high** | Status: FIXED (receivePurchaseOrder rejects non-matching or non-unique serial lists for isSerialized parts) on baseline #142 in isolated synthetic local fixture
- Steps: Create separate serialized parts and two-unit POs. Receive with no serial list, a one-serial list, or the same serial repeated twice; count receipts and PO quantities.
- Expected: Require one unique valid serial per unit before receipt/inventory/PO writes.
- Actual: All three invalid cases create receipts and accept quantity 2. isSerialized/serial-count/uniqueness are not validated in this service path.
- Suspect: `src/lib/services/supply-chain.ts:79-92,171-201`

### SERIAL-002 — Valid received serials never become selectable stock serial identities
- Module: Receiving / serial trace and kitting | Severity: **high** | Status: FIXED (receivePurchaseOrder now calls mintSerial for each serial on isSerialized parts) on baseline #142 in isolated synthetic local fixture
- Steps: Receive a new serialized two-unit part with two distinct serial strings; query listStockSerialsForParts for that part.
- Expected: Create/associate two IN_STOCK serial identities usable by serial trace, kit allocation and installation.
- Actual: Stock quantity is received but selectable serial identities=0 instead of 2. Strings are stored only in receipt-line JSON; no SerialNumber records are created.
- Suspect: `src/lib/services/supply-chain.ts:193,250-292; src/lib/services/stock-serials.ts:4-17`

### ACCT-004 — Overpayment has no explicit applied/unapplied breakdown (policy review)
- Module: Accounting / AR/AP reconciliation | Severity: **med** | Status: OBSERVED reconciliation/policy gap in synthetic AR/AP; unapplied-credit workflow and intended policy need verification, not a confirmed loss of funds
- Steps: For separate unpaid AR/AP invoices totaling 100, record a payment of 120 and compare payment, posted journal and invoice amountPaid.
- Expected: If excess is allowed, clearly expose and reconcile 100 applied plus 20 unapplied credit; otherwise reject it.
- Actual: Payment and GL record 120 while invoice.amountPaid is capped at 100. Payment records preserve the 120, so this is NOT proven money loss. No explicit unapplied-credit workflow was found/tested; requires product/UI confirmation before a fix.
- Suspect: `src/lib/services/gaap.ts:880-899,937-957`

### ACCT-005 — AR/AP journal date ignores the supplied historical payment date
- Module: Accounting / payment periods | Severity: **high** | Status: FIXED (postJournal receives the paymentDate) on baseline #142 in isolated synthetic local fixture
- Steps: Record an AR/AP payment with an explicit historical paymentDate in an open period; compare its payment row date with linked JE.date.
- Expected: Payment and settlement journal use the supplied payment date consistently and honor that period lock.
- Actual: Payment row keeps requested date but GL journal uses current date. The known paymentDate is not passed to postJournal, so historical-period reconciliation is wrong.
- Suspect: `src/lib/services/gaap.ts:894,906-916,962-972`

### ACCT-007 — Journal approval checks posting permission instead of approval permission
- Module: Accounting / individual approval permissions | Severity: **high** | Status: FIXED (actionApproveJournal now checks accounting.journal.approve) via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Password-login as synthetic EXECUTIVE; assert accounting.journal.approve=true and accounting.journal.post=false; submit actionApproveJournal for another person’s pending JE.
- Expected: Dedicated journal approval grant authorizes approval, without needing posting permission.
- Actual: Request is denied and JE stays PENDING_APPROVAL because the action checks accounting.journal.post. The distinct approval grant/default is ignored.
- Suspect: `src/app/actions.ts:8644-8648; src/lib/auth.ts:245-246,447-451`

### DEMO-001 — Concurrent demo pool refills exceed configured spare target
- Module: Demo / pool concurrency | Severity: **high** | Status: FIXED (ensureDemoPool re-checks READY + in-flight before every warm) on baseline #142 in isolated synthetic local fixture
- Steps: With no READY spares and DEMO_POOL_SIZE=2, run three ensureDemoPool calls concurrently against the disposable fixture; count READY rows after all settle.
- Expected: Refill coordination respects configured total spare target and in-flight limit.
- Actual: Each call returns 2; six READY schemas remain while target=2. Sequential refill is idempotent, concurrent refill is not. Reproduced twice.
- Suspect: `src/lib/services/tenancy.ts:490-514`

### QA-002 — Failed-inspection NCR loses the known purchase-order supplier
- Module: Receiving / NCR supplier trace | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Receive PO material requiring QA; complete receiving inspection FAIL with evidence; read new NCR and original PO supplier.
- Expected: Carry source supplier ID into NCR so source attribution and supplier quality metrics remain linked.
- Actual: NCR.supplierId is null even though the PO supplier is known. Quarantine and NCR/MRB creation otherwise succeed.
- Suspect: `src/lib/services/receiving-inspection.ts:568-577; src/lib/services/supply-chain.ts:1145-1175`

### MRB-002 — Negative MRB disposition quantity persists
- Module: MRB / input validation | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Create synthetic open MRB holding material; call dispositionMrb USE_AS_IS quantity -1; compare disposition rows.
- Expected: Reject nonpositive quantity before any disposition, stock release or case-state change.
- Actual: A disposition row with negative quantity is created; the operation also follows its normal release path.
- Suspect: `src/lib/services/supply-chain.ts:1277-1296,1439-1459`

### MRB-003 — Already-dispositioned MRB accepts a second decision
- Module: MRB / repeat mutations | Severity: **high** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Create MRB; complete USE_AS_IS for its held quantity; repeat dispositionMrb on the same case; count decisions.
- Expected: Reject or return existing disposition without another decision or downstream mutation.
- Actual: A second disposition record is created on the already DISPOSITIONED case. No case-status/idempotency guard runs.
- Suspect: `src/lib/services/supply-chain.ts:1277-1296,1439-1459`

### CRM-002 — Lead status mutation accepts arbitrary unknown state
- Module: CRM / lead state validation | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Create lead; invoke actionUpdateLeadStatus with QA_UNKNOWN_STATE.
- Expected: Reject state outside LEAD_STATUSES without changing the record.
- Actual: Unknown state string persists; lead disappears from normal state-driven workflows/filters.
- Suspect: `src/app/crm/actions.ts:55-60; src/lib/services/crm.ts:100-109`

### CRM-003 — Opportunity update accepts a 250 percent win probability
- Module: CRM / pipeline validation | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Create valid opportunity; invoke actionUpdateOpportunity with probability=250.
- Expected: Reject or constrain probability to 0–100.
- Actual: 250 persists and can inflate weighted pipeline values.
- Suspect: `src/app/crm/actions.ts:116-133; src/lib/services/crm.ts:220-227`

### SVC-001 — Service status mutation accepts arbitrary unknown state
- Module: Field service / state validation | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Create service ticket; invoke actionUpdateTicketStatus with QA_UNKNOWN_STATE.
- Expected: Reject state outside TICKET_STATUSES.
- Actual: Unknown state persists; status-based queues and lifecycle queries no longer recognize the ticket.
- Suspect: `src/app/service/actions.ts:55-60; src/lib/services/field-service.ts:156-168`

### SVC-002 — Reopened service ticket retains its closed timestamp
- Module: Field service / reopen lifecycle | Severity: **med** | Status: REPRODUCED on baseline #142 in isolated synthetic local fixture
- Steps: Complete the last service visit so ticket is COMPLETED; actionUpdateTicketStatus to IN_PROGRESS; read closedAt.
- Expected: Reopening clears closedAt while moving the ticket back into open work.
- Actual: Ticket is IN_PROGRESS but closedAt still has its previous completion timestamp.
- Suspect: `src/lib/services/field-service.ts:156-168`

### WORK-001 — WO list and detail disagree on due date
- Module: Work orders | Severity: **high** | Status: historical observation; current-main retest pending
- Steps: Save WO-00008 due Nov 15; open detail and filtered IN_PROGRESS list.
- Expected: Both show Nov 15.
- Actual: Detail Nov 15; list Due Nov 10.
- Suspect: `src/app/work-orders/page.tsx; src/app/work-orders/[id]/page.tsx:738`

### HOME-001 — Greeting and day use wrong timezone
- Module: Dashboard | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open dashboard Nov 9 at 6:56 PM PST.
- Expected: Monday Nov 9, evening greeting.
- Actual: Tuesday Nov 10, Good morning.
- Suspect: `src/app/page.tsx:217-219,267`

### ITEM-001 — Cookie-banner overlay blocks Create item
- Module: Inventory | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Open /items/new with cookie banner visible; click Create item.
- Expected: Button is clickable outside visible banner.
- Actual: Invisible full-width overlay intercepts click until banner dismissed.
- Suspect: `src/components/marketing/cookie-banner.tsx`

### TRACE-001 — Unexpanded need placeholder
- Module: Serial trace | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open /trace/serials stock options.
- Expected: Show numeric quantity needed.
- Actual: Shows literal need {p.gap}.
- Suspect: `Needs current UI reproduction`

### TEST-001 — First test-result submit intermittently crashes
- Module: Test procedures | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Submit TP-00003 PASS for QA-TEST-SN-001 with PIN.
- Expected: Persist result and render confirmation on first attempt.
- Actual: First attempt server-render error and no record; retry persisted.
- Suspect: `src/app/test-procedures/[id]/page.tsx; src/components/test-procedures/test-step-record.tsx`

### TEST-002 — Browser autofill inserts email in serial and measured-value inputs
- Module: Test / QA | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open TP-00003 Unit S/N or QA measured-value with browser autofill.
- Expected: No email autofill.
- Actual: Email inserted into serial / measured-value field.
- Suspect: `src/components/test-procedures/test-step-record.tsx`

### AUTH-001 — Missing-PIN instructions misleading
- Module: Accounts | Severity: **low** | Status: TEXT IMPROVED in current main; self-service PIN worked previously; link needs UI pass
- Steps: Sign WO with account having no PIN.
- Expected: Link to My Account > Sign-off PIN.
- Actual: Original message asked HR/admin, despite self-service /account. Current code text now points to My Account; link still needs UI check.
- Suspect: `src/lib/services/signature-pin.ts:11`

### PUR-001 — One person can complete demand and buyer approvals
- Module: Purchasing / permissions | Severity: **high** | Status: REPRODUCED on current main in isolated local DB; same actual admin identity, no role switch
- Steps: Create and submit synthetic standalone PR; decidePrApproval demand as admin; set valid buyer package fields; confirmBuyerPackageStep as the SAME admin user ID.
- Expected: Distinct actual people per approval step; explicit audited reason for any permitted admin override.
- Actual: Demand and buyer stages both become APPROVED with the same approverId. No separate signer or override reason was required.
- Suspect: `src/lib/services/pr-approval.ts:647-648,701-707; src/lib/services/pr-buyer.ts:488-497,572-580`

### WORK-002 — Task-only work order cannot complete putaway
- Module: Work orders / receiving | Severity: **high** | Status: FIXED (task-only / non-inventory WOs now complete without requiring part or storage) again through full task-only create/sign/handoff/complete action chain; remains READY_FOR_PUTAWAY with no part
- Steps: Create synthetic TASK_ONLY via actionCreateTaskWo; sign every attached traveler step with the synthetic admin own PIN; actionSendWoToReceivingPutaway then actionCompleteWoToStock; read final WO status.
- Expected: Non-inventory WO has a completion path without stocking.
- Actual: READY FOR PUTAWAY 0/1; Cannot complete — missing storage or part.
- Suspect: `src/lib/services/order-fulfillment.ts:1799`

### WORK-003 — Successful delivery flashes NEXT_REDIRECT error
- Module: Work orders | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Use Deliver to RCV-01.
- Expected: Redirect without error.
- Actual: NEXT_REDIRECT toast although delivery succeeds.
- Suspect: `src/app/actions.ts redirect catch boundary`

### SALES-001 — Quote acceptance auto-submits purchase request for make part without BOM
- Module: Sales / planning | Severity: **high** | Status: historical observation; current-main retest pending
- Steps: Accept QT-00003 for make part with no certified BOM.
- Expected: Prompt make vs buy, or retain blocked WO planning until certified BOM.
- Actual: Auto-SUBMITTED PR-00005 to FastenRight; no WO.
- Suspect: `src/lib/services/order-fulfillment.ts:462-527`

### ITEM-002 — Item detail and new item previously crashed after deploy
- Module: Inventory | Severity: **high** | Status: NOT REPRODUCED locally: /items/new and item detail both render; production incident still needs verification
- Steps: Open /items/new and prior QA item after PR #139 deployment.
- Expected: Render item forms/detail.
- Actual: Unexpected error refs 177542674,4051158709. Current-main retest pending.
- Suspect: `src/app/items/new/page.tsx; src/app/items/[id]/page.tsx`

### SHIP-001 — Manual shipment selection does not populate SO lines/address
- Module: Shipping | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Select SO-00005 on manual shipping form.
- Expected: Populate address and order lines.
- Actual: Address/lines remain unpopulated; pull queue empty because no allocated stock.
- Suspect: `src/app/shipping/page.tsx; src/components/shipping/pack-ship-panel.tsx`

### WORK-004 — Task-only WO automatically attaches unrelated 5S traveler
- Module: Work orders | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Create task-only WO without choosing WI.
- Expected: Explicit, relevant traveler selection.
- Actual: Unrelated four-step 5S WI attached; PIN sign-offs required.
- Suspect: `src/lib/services/work-orders.ts`

### WORK-005 — Conflicting status labels
- Module: Work orders | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open task WO detail.
- Expected: Explain order lifecycle and execution statuses separately.
- Actual: IN PROGRESS and NOT STARTED appear together unexplained.
- Suspect: `src/app/work-orders/[id]/page.tsx`

### WORK-006 — Production floor cards omit description
- Module: Floor | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open /floor.
- Expected: Show WO number and human-readable work description.
- Actual: Only WO number.
- Suspect: `src/components/floor/floor-flow.tsx`

### WORK-007 — BOM production order form lacks description/name
- Module: Work orders | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open BOM production WO creation.
- Expected: Provide name/description field.
- Actual: No description/name field.
- Suspect: `src/app/work-orders/page.tsx`

### NAV-001 — Government Property missing from sidebar
- Module: Government property | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Follow dashboard link /government-property and compare sidebar.
- Expected: Accessible consistent navigation.
- Actual: Dashboard links it; sidebar omits it.
- Suspect: `src/lib/navigation.ts`

### PUR-002 — Draft PR has no obvious submit/convert control
- Module: Purchasing | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Open PR-00004 DRAFT.
- Expected: Visible next-step action.
- Actual: No visible submit/convert-to-PO action.
- Suspect: `src/app/purchasing/pr/[id]/page.tsx`

### QA-001 — NCR list has no obvious creation control
- Module: Quality / NCR | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open NCR list.
- Expected: Visible Create NCR or explanation of source workflow.
- Actual: No create control.
- Suspect: `src/app/quality/page.tsx`

### WORK-008 — Completion handoff to Receiving undiscoverable
- Module: Work orders | Severity: **med** | Status: historical observation; current-main retest pending
- Steps: Sign every traveler step on WO-00008.
- Expected: Clear next-step delivery action or completion hint.
- Actual: WO remains IN_PROGRESS with no obvious Complete action; requires Receiving handoff.
- Suspect: `src/app/work-orders/[id]/page.tsx`

### SALES-002 — Customer PO is text only
- Module: Sales / customer PO | Severity: **low** | Status: historical observation; current-main retest pending
- Steps: Open SO-00005 with customer PO QA-TEST-CPO-001.
- Expected: Consider linked PO document/lines for PO-vs-SO validation.
- Actual: Only a reference field, no linked record/attachment. Product improvement, not confirmed defect.
- Suspect: `src/app/sales/[id]/page.tsx`

### BOM-001 — Production WO can be created with no BOM at all
- Module: Manufacturing / BOM | Severity: **high** | Status: REPRODUCED on current main in isolated local DB
- Steps: Call createWorkOrder with type PRODUCTION, a valid partId and quantity 1, but no bomHeaderId.
- Expected: Reject unless a certified BOM exists and is explicitly linked.
- Actual: Order is created; the certified-BOM check only executes when bomHeaderId is supplied. Draft-BOM rejection does work.
- Suspect: `src/lib/services/work-orders.ts:122-148`

### BOM-002 — BOM line update accepts negative component quantity
- Module: PLM / BOM | Severity: **med** | Status: REPRODUCED on current main in isolated local DB
- Steps: Create draft BOM and a line quantity 1; call updateBomLine with quantity -5.
- Expected: Reject nonpositive quantity, consistent with addBomLine.
- Actual: Negative quantity persists. Current add-line gate correctly rejects zero.
- Suspect: `src/lib/services/bom.ts:344-367`

### CRM-001 — Converting the same lead twice creates duplicate deals
- Module: CRM | Severity: **med** | Status: REPRODUCED on current main in isolated local DB
- Steps: Create lead, convertLead once, then repeat convertLead using the same leadId.
- Expected: Return existing opportunity or reject already-converted lead.
- Actual: Two distinct opportunity IDs created; lead points to the newer one.
- Suspect: `src/lib/services/crm.ts:117-141; src/app/crm/actions.ts:64-75`

### PLAN-001 — Forecast service accepts negative demand
- Module: Planning | Severity: **med** | Status: REPRODUCED on current main in isolated local DB
- Steps: Call createForecast with valid name, partId and quantity -5.
- Expected: Reject nonpositive demand at the service boundary.
- Actual: Forecast line -5 persists. The current actionCreateForecast UI wrapper filters nonpositive lines, so this is a service-validation gap, not a confirmed UI exploit.
- Suspect: `src/lib/services/planning.ts:43-74; src/app/actions.ts:1107-1127`

### AUTH-002 — Customer creation handler does not enforce customers.manage
- Module: Accounts / customer permissions | Severity: **high** | Status: REPRODUCED via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Use legitimate synthetic OPERATOR demo identity; verify userHasPermission(operatorId, customers.manage) is false; directly invoke actionCreateCustomer with valid form data; read customer table. Follow-up: password-login as the synthetic role on strict-auth server; use the actual issued session cookie and ordinary native action form (or canonical React RPC for client-wrapped forecast); assert the persisted mutation.
- Expected: Reject before any customer write when permission is absent.
- Actual: New customer persists despite missing permission. The same handler passes the admin native HTTP form test. Reconfirmed over authenticated local HTTP, not just a direct handler call.
- Suspect: `src/app/actions.ts:3802-3868`

### AUTH-003 — Catalog creation handler does not enforce items.manage
- Module: Accounts / catalog permissions | Severity: **high** | Status: REPRODUCED via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: As synthetic OPERATOR with userHasPermission(items.manage)=false, directly call actionCreateItem with a unique valid catalog item; read part table. Follow-up: password-login as the synthetic role on strict-auth server; use the actual issued session cookie and ordinary native action form (or canonical React RPC for client-wrapped forecast); assert the persisted mutation.
- Expected: Deny without creating a part.
- Actual: Part is created without the required permission. Reconfirmed over authenticated local HTTP, not just a direct handler call.
- Suspect: `src/app/actions.ts:3934-3979`

### AUTH-004 — Forecast creation handler does not enforce planning.forecast.create
- Module: Accounts / planning permissions | Severity: **high** | Status: REPRODUCED via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: As synthetic OPERATOR with planning.forecast.create denied, directly invoke actionCreateForecast with a valid name and part/quantity line. Follow-up: password-login as the synthetic role on strict-auth server; use the actual issued session cookie and ordinary native action form (or canonical React RPC for client-wrapped forecast); assert the persisted mutation.
- Expected: Deny before forecast/header/line creation.
- Actual: A forecast is created despite the denied permission. Reconfirmed over authenticated local HTTP, not just a direct handler call.
- Suspect: `src/app/actions.ts:1094-1135`

### ACCT-001 — Operator can invoke handler to post a general-ledger journal
- Module: Accounting / authorization | Severity: **high** | Status: REPRODUCED via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Select two active accounts in safe fixture; set legitimate synthetic OPERATOR context; directly invoke actionPostJournal with valid debit, credit, amount and postNow=true; query journal. Follow-up: password-login as the synthetic role on strict-auth server; use the actual issued session cookie and ordinary native action form (or canonical React RPC for client-wrapped forecast); assert the persisted mutation.
- Expected: Require appropriate accounting permission before creating or posting any journal.
- Actual: A POSTED journal is created by OPERATOR. No accounting permission gate executes in the handler. Reconfirmed over authenticated local HTTP, not just a direct handler call.
- Suspect: `src/app/actions.ts:6478-6542`

### ACCT-002 — Failed AR/AP GL posting leaves payment and invoice balance committed
- Module: Accounting / rollback | Severity: **high** | Status: REPRODUCED on baseline current main in isolated local DB
- Steps: Create synthetic unpaid AR or AP invoice total 100; close the posting period in the disposable fixture; call recordArPayment or recordApPayment for 40; catch the expected period-closed error; query payment and invoice.
- Expected: Entire operation rolls back: zero payment rows, amountPaid=0 and original invoice status if GL posting fails.
- Actual: Both AR and AP throw the period-closed error BUT retain one payment row, amountPaid=40, status PARTIAL. Subledger is changed without the corresponding successful GL posting.
- Suspect: `src/lib/services/gaap.ts:865-918,922-974`

### ACCT-003 — postNow bypasses required journal approval for ordinary accountant
- Module: Accounting / separation of duties | Severity: **high** | Status: REPRODUCED via genuine password-issued sessions and HTTP action requests on strict-auth local fixture (DEMO_MODE=0); production NOT tested
- Steps: Enable requireJournalSoD; select legitimate synthetic ACCOUNTING user (not admin/controller); directly call actionPostJournal with postNow=true; inspect journal status. Follow-up: password-login as the synthetic role on strict-auth server; use the actual issued session cookie and ordinary native action form (or canonical React RPC for client-wrapped forecast); assert the persisted mutation.
- Expected: Create pending journal requiring a separate authorized approver, or reject the immediate-post request.
- Actual: The self-created entry is immediately POSTED by ACCOUNTING while separation-of-duties is enabled. The separate approveJournal self-approval gate works, but this path bypasses it. Reconfirmed over authenticated local HTTP, not just a direct handler call.
- Suspect: `src/app/actions.ts:6508-6519; src/lib/services/gaap.ts:postJournal/approveJournal`

### GOVCON-001 — Journal reversal loses line-level unallowable classification
- Module: Accounting / GovCon allowability | Severity: **high** | Status: REPRODUCED on baseline current main in isolated local DB
- Steps: Post balanced journal with an explicitly unallowable debit line and FAR citation on an otherwise allowable account; reverseJournalEntry; compare original/reversal lines.
- Expected: Reversal swaps debit/credit while retaining unallowable/FAR and cost attribution fields so allowability reporting nets correctly.
- Actual: Reversal line unallowable=false versus original true. The reversal mapping omits line classification fields; balanced amounts and duplicate-reversal guard do pass.
- Suspect: `src/lib/services/gaap.ts:1028-1064 (mapping 1057-1063)`

### SALES-003 — Repeated customer PO conversion regresses converted quote to ACCEPTED
- Module: Sales / quote rollback | Severity: **med** | Status: REPRODUCED on baseline current main in isolated local DB
- Steps: Create valid quote; actionRecordCustomerPo successfully converts to one SO; repeat actionRecordCustomerPo on the same quote; read SO count and quote status.
- Expected: Return/reject safely without changing the CONVERTED quote or creating another SO.
- Actual: No duplicate SO is created, but quote status regresses to ACCEPTED before conversion rejects. The failed repeated mutation is not atomic.
- Suspect: `src/app/actions.ts:3619-3651`

### KIT-001 — Resuming a short kit duplicates already staged component inventory
- Module: Inventory / manufacturing kitting | Severity: **high** | Status: FIXED (kit retry stages only the newly picked delta; existing WIP is incremented instead of duplicated)
- Steps: Create standalone production WO against existing certified multi-line BOM and its kit; simulate last component becoming unavailable; completeKitOrder picks/stages first line then returns short; restore missing stock; retry completeKitOrder; sum first-line WIP inventory.
- Expected: Retry only picks/stages outstanding quantity; already PICKED lines retain exactly the required WIP quantity.
- Actual: First component required 1 and had WIP=1 after first attempt; retry completes kit but WIP becomes 2. Already picked line is staged again despite remaining=0, creating phantom inventory.
- Suspect: `src/lib/services/order-fulfillment.ts:1400-1402,1619-1647`

## Remaining work / next pass

- **499 server actions remain untested.** Continue module-by-module mutations plus malformed inputs, real-session individual grants/denies/expiry, rollback, repeat and concurrent operations. CRM and field-service action handlers now have at least one scenario each; permissions and all variants are not accepted.
- Receiving/QC: mixed-line split travelers, serial uniqueness across receipts, lot/shelf-life, partial failures/reinspection, CAR/rework/repair/RTV approvals, multiple holds and supplier scorecard attribution.
- Financial: fix/retest concurrency separately, reconcile complete SO→shipping→invoice→cash and PO→receipt→AP chains numerically, discounts/taxes/credits, GovCon allocation and timesheet controls, closed-period rollback across every business event.
- Task-only official completion remains broken after every traveler step is signed and receiving handoff succeeds. No workaround/fix was introduced.
- Demo: broader multi-process races, in-flight cap/abort/failure recovery and stale session UI. Native reset/leave, schema-unique claims/exhaustion and recycling pass; refill target concurrency fails.
- Next modules: PMO/program/project/WBS/budget/risk/issue/requirements; HR/time; PLM/ECO/ECR/CM after #143; inventory/GFP/MRP; purchasing policy thresholds; admin/settings/import/accounts/MFA; billing offline mocks only.
- Needs UI pass: cookie overlay/autofill, visual buttons/selects, docs editor, layout, toasts, cameras/microphone, printing/downloads and production-only/intermittent historical incidents. No destructive production verification.

## Original dry-run log (preserved verbatim)

# Protessera dry run — bug & UX log (started 2026-11-09)

Test records are prefixed "QA-TEST 2026-11-09".

## Intended flow (founder, 2026-11-09)
Quote -> customer PO -> Sales Order -> Work Order. Standalone WOs (built without a sales order) must still be allowed.

## Bugs
1. MAJOR — Work Orders: WO-00008 due date saved as Nov 15; detail shows Nov 15 but list (/work-orders?status=IN_PROGRESS) shows "Due Nov 10".
2. MINOR — Dashboard: at Mon Nov 9 6:56 PM PT the greeting shows "Tuesday Nov 10" and "Good morning" (timezone/UTC bug likely).

3. MINOR — Items /items/new: cookie banner's invisible full-width overlay blocks the Create item button until the banner is dismissed.
4. MINOR — Serial trace /trace/serials: stock options show literal "need {p.gap}" text instead of a number (template bug).
5. MINOR — Test procedure run (TP-00003): Unit S/N field autofills with an email address.

## UX notes
- Task-only WO auto-attached an unrelated 4-step 5S work instruction with no visible selection; completion then requires PIN sign-offs.
- WO detail shows "IN PROGRESS" and "NOT STARTED" at once without explanation.
- Production Floor board shows WO number but not description.
- BOM production WO create form has no description/name field.
- Government Property (/government-property) linked from dashboard but missing from sidebar.

## Test records
- WO-00008 "QA-TEST 2026-11-09 Work order lifecycle" (in progress; sign-offs need owner PIN)
- Item (QA-TEST) https://www.protessera.com/items/cmwa3ooqt000008jky0i4b00j
- PR-00004 draft https://www.protessera.com/purchasing/pr/cmwa3pm2d000i07lagj23hha9 (not sent)
- TP-00003 released, 1 step https://www.protessera.com/test-procedures/cmwa3qtri000l07la95r8rqpp

## PIN sign-offs required
- WO traveler steps (WO-00008), QA traveler pass/fail (/qa), test result recording (TP-00003)

## Feature requests (founder, 2026-11-09)
- Multi-step sign-offs by different people: e.g. PO needs demand/requester sign-off, buyer sign-off, then final approval by budget owner. Configurable approval chains per document type.
- Test-environment role switcher: let an admin switch between roles/users ("act as") to perform each sign-off during testing.

## Reported by user 2026-11-09 7:04 PM PT
- MAJOR (separation of duties): On PR-00003 the user signed the Demand/requester step, then was also able to sign the Buyer step and approve, though he is not a buyer (he is an admin). Same person must not sign multiple approval steps on one PR/PO; buyer step should require buyer role. Admin override, if allowed, should require a reason and be audit-logged.
- Clarification (user, 7:06 PM PT): Role switching is a test-account-only feature (our account only). Switching roles makes the system treat signatures as a different person. In real tenants, sign-off permissions stay tied to the actual person, not the role; role only drives default views (buyer, tech, PM, etc.) unless a person is individually granted permissions/views. So PR-00003 bug = without actively switching roles, one user could sign demand AND buyer steps.

## Dry run part 2b (2026-11-09 ~7:07 PM PT)
- HIGH: TP-00003 submit Pass (serial QA-TEST-SN-001 + PIN) -> server-render error; save unconfirmed.
- BLOCKER for testing: WO-00008 PIN sign-off -> "Your account has no PIN configured — ask HR/admin to set one before signing." Owner account has no PIN; no obvious self-service PIN setup. All 4 traveler steps still open.
- MEDIUM: Browser autofill puts email into Unit S/N and QA measured-value fields (inputs need autocomplete="off"/proper names).
- MINOR/UX: PR-00004 draft has no visible submit/convert-to-PO action.
- MINOR/UX: NCR list has no create control.
- NOTE: Purchasing describes charge-owner -> buyer -> purchase approval -> escalation -> finance routing; traveler step 4 asks for supervisor sign-off; no role switch control in account menu (needed for test account).
- Created test record: RMA-00002 https://www.protessera.com/rma/cmwa3whpq000308jki00bu5xh (evaluating). Test item edit verified. PR search + DRAFT filter OK.
- UX: "No PIN configured — ask HR/admin" message is misleading; PIN is self-service at /account (My Account > Sign-off PIN). Message should link there.
- NOTE: WO-00008 all 4 traveler steps signed OK with PIN (7:17 PM PT). WO stays IN PROGRESS; no Complete button: completion requires delivery to Receiving. Not obvious from WO page; add a "Deliver to stock/Receiving" action or hint on the WO.
- MAJOR: Task-only WO (no part/BOM) can be delivered to RCV-01 but putaway then fails "Cannot complete — missing storage or part." WO-00008 stuck READY FOR PUTAWAY 0/1. Task-only/non-inventory WOs need a completion path that skips stocking (or require a part at WO creation).
- MINOR: "Deliver to RCV-01" shows transient "NEXT_REDIRECT" error toast though the action succeeds (redirect() caught inside try/catch).
- RESOLVED/NOTE: TP-00003 retry PASS for QA-TEST-SN-001 persisted (7:21 PM PT). Earlier attempt's server error left no record — first-submit failure is still a HIGH bug (intermittent server render error on test result submit).

## Quote->SO chain (7:24 PM PT)
Records: customer https://www.protessera.com/customers/cmwa4j3fq000108l0g7br5g7r ; QT-00003 https://www.protessera.com/sales/quotes/cmwa4k5k3000007i9wk02utjc ; SO-00005 https://www.protessera.com/sales/cmwa4kcto000307i9mp8snury ; auto PR-00005 https://www.protessera.com/purchasing/pr/cmwa4kdr6000807i9elx0i263
- WORKS: quote accept -> CONVERTED -> SO links back to quote; SO shows customer PO QA-TEST-CPO-001.
- UX: customer PO is only a reference text field on SO, not a linked record/attachment (consider storing PO doc + PO lines for PO-vs-SO compare).
- MAJOR: Accepting quote auto-planned and auto-SUBMITTED PR-00005 to FastenRight ($2) because no certified BOM existed; no WO created. Auto-buying a make part without asking is surprising; should prompt "make vs buy" or create WO + flag missing BOM.
- HIGH (possible regression after PR #139 deploy ~7:13 PM): Item detail and /items/new crash "This page hit an unexpected error" refs 177542674, 4051158709. Item edit worked ~6:5x PM.
- MAJOR: Shipping — SO not in pull queue (no allocated stock), ship hold until Dec 1, and manual shipping form doesn't populate address/lines when SO selected.
- Could not test WO lifecycle/putaway from SO (no WO).

## Full source-derived checklist

PASS = named scenario only; FAIL = at least one reproduced failure; UNTESTED = not accepted. Models remain untested per-model CRUD/authorization; page passes are render-only. Source lines refer to baseline #142. HTTP permission evidence uses actual password-issued local sessions, never production.

### PAGE checklist

| ID | Module | Function / route / model | Source | Status | Evidence / next step |
|---|---|---|---|---|---|
| PAGE-0001 | Accounts / Roles | /account | `src/app/account/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0002 | Accounting / GovCon | /accounting/account/[id] | `src/app/accounting/account/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0003 | Accounting / GovCon | /accounting/banking | `src/app/accounting/banking/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0004 | Accounting / GovCon | /accounting/govcon | `src/app/accounting/govcon/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0005 | Accounting / GovCon | /accounting | `src/app/accounting/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0006 | Accounting / GovCon | /accounting/payroll | `src/app/accounting/payroll/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0007 | Accounting / GovCon | /accounting/paystub/[id] | `src/app/accounting/paystub/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0008 | Accounting / GovCon | /accounting/reports/print | `src/app/accounting/reports/print/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0009 | Admin / Settings | /admin/import | `src/app/admin/import/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0010 | Admin / Settings | /admin/insights | `src/app/admin/insights/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0011 | Accounts / Roles | /admin/permissions | `src/app/admin/permissions/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0012 | Admin / Settings | /admin/settings | `src/app/admin/settings/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0013 | Admin / Settings | /admin/support/[id] | `src/app/admin/support/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0014 | Admin / Settings | /admin/support | `src/app/admin/support/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0015 | Admin / Settings | /admin/tenants/[tenantId] | `src/app/admin/tenants/[tenantId]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0016 | Admin / Settings | /admin/tenants | `src/app/admin/tenants/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0017 | Platform / Other | /ai | `src/app/ai/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0018 | Platform / Other | /approvals | `src/app/approvals/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0019 | Service / Assets | /assets/[id] | `src/app/assets/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0020 | Service / Assets | /assets | `src/app/assets/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0021 | Billing / Founding | /billing | `src/app/billing/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0022 | PLM / BOM / ECO | /bom/[id] | `src/app/bom/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0023 | PLM / BOM / ECO | /bom | `src/app/bom/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0024 | PMO / Budgets | /budgets/[id] | `src/app/budgets/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0025 | PMO / Budgets | /budgets | `src/app/budgets/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0026 | PLM / BOM / ECO | /cm/ecr/[id] | `src/app/cm/ecr/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0027 | PLM / BOM / ECO | /cm/ecr | `src/app/cm/ecr/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0028 | PLM / BOM / ECO | /cm | `src/app/cm/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0029 | Platform / Other | /compare/protessera-vs-jobboss | `src/app/compare/protessera-vs-jobboss/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0030 | Platform / Other | /compare/protessera-vs-proshop | `src/app/compare/protessera-vs-proshop/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0031 | CRM / Sales | /crm/[id] | `src/app/crm/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0032 | CRM / Sales | /crm/contacts | `src/app/crm/contacts/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0033 | CRM / Sales | /crm/leads | `src/app/crm/leads/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0034 | CRM / Sales | /crm | `src/app/crm/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0035 | CRM / Sales | /customers/[id] | `src/app/customers/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0036 | CRM / Sales | /customers/new | `src/app/customers/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0037 | CRM / Sales | /customers | `src/app/customers/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0038 | Demo / Tenancy | /demo | `src/app/demo/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0039 | Docs | /docs/new | `src/app/docs/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0040 | Docs | /docs | `src/app/docs/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0041 | Docs | /docs/pages/[id]/edit | `src/app/docs/pages/[id]/edit/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0042 | Docs | /docs/pages/[id]/history | `src/app/docs/pages/[id]/history/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0043 | Docs | /docs/pages/[id] | `src/app/docs/pages/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0044 | Platform / Other | /email | `src/app/email/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0045 | PLM / BOM / ECO | /engineering/[discipline] | `src/app/engineering/[discipline]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0046 | PLM / BOM / ECO | /engineering | `src/app/engineering/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0047 | PLM / BOM / ECO | /engineering/tasks/[id] | `src/app/engineering/tasks/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0048 | PLM / BOM / ECO | /engineering/tasks | `src/app/engineering/tasks/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0049 | PLM / BOM / ECO | /engineering/tickets/[id] | `src/app/engineering/tickets/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0050 | Service / Assets | /fleet/[id] | `src/app/fleet/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0051 | Service / Assets | /fleet | `src/app/fleet/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0052 | Platform / Other | /floor | `src/app/floor/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0053 | Platform / Other | /government-property/[id] | `src/app/government-property/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0054 | Platform / Other | /government-property | `src/app/government-property/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0055 | Platform / Other | /guides | `src/app/guides/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0056 | Accounts / Roles | /hr/onboarding/[id] | `src/app/hr/onboarding/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0057 | Accounts / Roles | /hr/onboarding | `src/app/hr/onboarding/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0058 | HR / Time | /hr | `src/app/hr/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0059 | HR / Time | /hr/person/[id] | `src/app/hr/person/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0060 | HR / Time | /hr/timesheet/[id] | `src/app/hr/timesheet/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0061 | HR / Time | /hr/timesheet | `src/app/hr/timesheet/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0062 | Inventory / Kitting | /inventory/committed/[partId] | `src/app/inventory/committed/[partId]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0063 | Inventory / Kitting | /inventory/cycle-counts/[id] | `src/app/inventory/cycle-counts/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0064 | Inventory / Kitting | /inventory/cycle-counts | `src/app/inventory/cycle-counts/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0065 | Inventory / Kitting | /inventory/expiring | `src/app/inventory/expiring/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0066 | Inventory / Kitting | /inventory | `src/app/inventory/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0067 | Accounts / Roles | /invite/[token] | `src/app/invite/[token]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0068 | Inventory / Kitting | /items/[id] | `src/app/items/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0069 | Inventory / Kitting | /items/new | `src/app/items/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0070 | Inventory / Kitting | /items | `src/app/items/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0071 | Inventory / Kitting | /kitting | `src/app/kitting/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0072 | Platform / Other | /leadership | `src/app/leadership/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0073 | Platform / Other | /legal/[slug] | `src/app/legal/[slug]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0074 | Platform / Other | /legal | `src/app/legal/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0075 | Accounts / Roles | /login | `src/app/login/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0076 | Accounts / Roles | /login/verify | `src/app/login/verify/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0077 | Shipping / Logistics | /logistics/landed/[receiptId] | `src/app/logistics/landed/[receiptId]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0078 | Shipping / Logistics | /logistics | `src/app/logistics/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0079 | Service / Assets | /maintenance/[id] | `src/app/maintenance/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0080 | Service / Assets | /maintenance | `src/app/maintenance/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0081 | Platform / Other | /module-off | `src/app/module-off/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0082 | Quality / NCR | /mrb/cars/[id] | `src/app/mrb/cars/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0083 | Quality / NCR | /mrb/cars | `src/app/mrb/cars/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0084 | Quality / NCR | /mrb | `src/app/mrb/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0085 | Platform / Other | /no-access | `src/app/no-access/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0086 | Accounts / Roles | /onboard/[token] | `src/app/onboard/[token]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0087 | Platform / Other | / | `src/app/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0088 | Inventory / Kitting | /parts/[id] | `src/app/parts/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0089 | Planning / Scheduling | /planning/forecasts/[id] | `src/app/planning/forecasts/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0090 | Planning / Scheduling | /planning/forecasts/new | `src/app/planning/forecasts/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0091 | Planning / Scheduling | /planning/forecasts | `src/app/planning/forecasts/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0092 | Planning / Scheduling | /planning/mrs/[id] | `src/app/planning/mrs/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0093 | Planning / Scheduling | /planning/mrs | `src/app/planning/mrs/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0094 | Planning / Scheduling | /planning | `src/app/planning/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0095 | PMO / Budgets | /pmo/alerts | `src/app/pmo/alerts/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0096 | PMO / Budgets | /pmo | `src/app/pmo/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0097 | PMO / Budgets | /pmo/pi | `src/app/pmo/pi/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0098 | PMO / Budgets | /pmo/programs/[id] | `src/app/pmo/programs/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0099 | PMO / Budgets | /pmo/programs/new | `src/app/pmo/programs/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0100 | PMO / Budgets | /pmo/programs | `src/app/pmo/programs/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0101 | PMO / Budgets | /pmo/projects/[id] | `src/app/pmo/projects/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0102 | PMO / Budgets | /pmo/projects/[id]/reports | `src/app/pmo/projects/[id]/reports/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0103 | PMO / Budgets | /pmo/projects/new | `src/app/pmo/projects/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0104 | PMO / Budgets | /pmo/projects | `src/app/pmo/projects/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0105 | PMO / Budgets | /pmo/wbs/[id] | `src/app/pmo/wbs/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0106 | PMO / Budgets | /pmo/wbs | `src/app/pmo/wbs/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0107 | HR / Time | /preview/demo-hub | `src/app/preview/demo-hub/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0108 | HR / Time | /preview | `src/app/preview/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0109 | HR / Time | /preview/splash | `src/app/preview/splash/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0110 | Accounts / Roles | /preview/tenant-login | `src/app/preview/tenant-login/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0111 | HR / Time | /preview/url-map | `src/app/preview/url-map/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0112 | Billing / Founding | /pricing | `src/app/pricing/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0113 | Platform / Other | /print/labels | `src/app/print/labels/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0114 | Platform / Other | /print/material-shortage/[workOrderId] | `src/app/print/material-shortage/[workOrderId]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0115 | Platform / Other | /print/packing-list/[id] | `src/app/print/packing-list/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0116 | Platform / Other | /print/po/[id] | `src/app/print/po/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0117 | Reports | /print/report | `src/app/print/report/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0118 | Service / Assets | /print/rma-packing-list/[id] | `src/app/print/rma-packing-list/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0119 | Platform / Other | /print/statement/[id] | `src/app/print/statement/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0120 | HR / Time | /print/timesheet/[id] | `src/app/print/timesheet/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0121 | PLM / BOM / ECO | /products/[id] | `src/app/products/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0122 | PLM / BOM / ECO | /products/new | `src/app/products/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0123 | PLM / BOM / ECO | /products | `src/app/products/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0124 | Platform / Other | /projects/[id] | `src/app/projects/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0125 | Platform / Other | /projects | `src/app/projects/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0126 | Purchasing / Receiving | /purchasing/approvals | `src/app/purchasing/approvals/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0127 | Purchasing / Receiving | /purchasing | `src/app/purchasing/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0128 | Purchasing / Receiving | /purchasing/po/[id] | `src/app/purchasing/po/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0129 | Purchasing / Receiving | /purchasing/po | `src/app/purchasing/po/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0130 | Purchasing / Receiving | /purchasing/pr/[id] | `src/app/purchasing/pr/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0131 | Purchasing / Receiving | /purchasing/pr/new | `src/app/purchasing/pr/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0132 | Platform / Other | /qa | `src/app/qa/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0133 | Quality / NCR | /quality/ncr/[id] | `src/app/quality/ncr/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0134 | Quality / NCR | /quality | `src/app/quality/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0135 | PMO / Budgets | /quality/programs/[key]/inspect/[itemId] | `src/app/quality/programs/[key]/inspect/[itemId]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0136 | PMO / Budgets | /quality/programs/[key] | `src/app/quality/programs/[key]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0137 | PMO / Budgets | /quality/programs/incident/[id] | `src/app/quality/programs/incident/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0138 | PMO / Budgets | /quality/programs | `src/app/quality/programs/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0139 | PMO / Budgets | /quality/programs/tools/[id]/label | `src/app/quality/programs/tools/[id]/label/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0140 | PMO / Budgets | /quality/programs/tools | `src/app/quality/programs/tools/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0141 | PMO / Budgets | /quality/programs/tools/report/[id] | `src/app/quality/programs/tools/report/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0142 | Platform / Other | /radiators | `src/app/radiators/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0143 | Purchasing / Receiving | /receiving/[id] | `src/app/receiving/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0144 | Purchasing / Receiving | /receiving/new-gfp | `src/app/receiving/new-gfp/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0145 | Purchasing / Receiving | /receiving | `src/app/receiving/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0146 | HR / Time | /recruiting/[id] | `src/app/recruiting/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0147 | HR / Time | /recruiting/candidates/[id] | `src/app/recruiting/candidates/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0148 | HR / Time | /recruiting | `src/app/recruiting/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0149 | Reports | /reports/builder | `src/app/reports/builder/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0150 | Reports | /reports | `src/app/reports/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0151 | PLM / BOM / ECO | /requirements | `src/app/requirements/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0152 | Service / Assets | /rma/[id] | `src/app/rma/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0153 | Service / Assets | /rma/new | `src/app/rma/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0154 | Service / Assets | /rma | `src/app/rma/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0155 | CRM / Sales | /sales/[id] | `src/app/sales/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0156 | CRM / Sales | /sales/new | `src/app/sales/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0157 | CRM / Sales | /sales | `src/app/sales/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0158 | CRM / Sales | /sales/quotes/[id] | `src/app/sales/quotes/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0159 | CRM / Sales | /sales/quotes/new | `src/app/sales/quotes/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0160 | CRM / Sales | /sales/quotes | `src/app/sales/quotes/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0161 | Service / Assets | /service/[id] | `src/app/service/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0162 | Service / Assets | /service/assets | `src/app/service/assets/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0163 | Service / Assets | /service | `src/app/service/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0164 | Admin / Settings | /setup | `src/app/setup/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0165 | Shipping / Logistics | /shipping/[id] | `src/app/shipping/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0166 | Shipping / Logistics | /shipping | `src/app/shipping/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0167 | Accounts / Roles | /signup/complete | `src/app/signup/complete/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0168 | Accounts / Roles | /signup | `src/app/signup/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0169 | Purchasing / Receiving | /suppliers/[id] | `src/app/suppliers/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0170 | Purchasing / Receiving | /suppliers | `src/app/suppliers/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0171 | Platform / Other | /support/[id] | `src/app/support/[id]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0172 | Platform / Other | /support | `src/app/support/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0173 | Platform / Other | /support/t/[token] | `src/app/support/t/[token]/page.tsx:1` | UNTESTED | Not yet exercised |
| PAGE-0174 | Manufacturing / Test | /test-center | `src/app/test-center/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0175 | Manufacturing / Test | /test-procedures/[id] | `src/app/test-procedures/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0176 | Manufacturing / Test | /test-procedures | `src/app/test-procedures/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0177 | Manufacturing / Test | /trace/serials/[serial] | `src/app/trace/serials/[serial]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0178 | Manufacturing / Test | /trace/serials | `src/app/trace/serials/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0179 | Inventory / Kitting | /uom | `src/app/uom/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0180 | Platform / Other | /value-stream | `src/app/value-stream/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0181 | Service / Assets | /virtual-assets/[id] | `src/app/virtual-assets/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0182 | Service / Assets | /virtual-assets | `src/app/virtual-assets/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0183 | Platform / Other | /welcome | `src/app/welcome/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0184 | Manufacturing / Test | /work-instructions/[id] | `src/app/work-instructions/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0185 | Manufacturing / Test | /work-instructions/new | `src/app/work-instructions/new/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0186 | Manufacturing / Test | /work-instructions | `src/app/work-instructions/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0187 | Manufacturing / Test | /work-orders/[id] | `src/app/work-orders/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0188 | Manufacturing / Test | /work-orders | `src/app/work-orders/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0189 | Manufacturing / Test | /workcenters/[id] | `src/app/workcenters/[id]/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |
| PAGE-0190 | Manufacturing / Test | /workcenters | `src/app/workcenters/page.tsx:1` | PASS | HTTP render only; buttons/visuals need UI pass |

### ACTION checklist

| ID | Module | Function / route / model | Source | Status | Evidence / next step |
|---|---|---|---|---|---|
| ACTION-0001 | Accounts / Roles | actionStartMfa | `src/app/account/mfa-actions.ts:25` | UNTESTED | Not yet exercised |
| ACTION-0002 | Accounts / Roles | actionConfirmMfa | `src/app/account/mfa-actions.ts:56` | UNTESTED | Not yet exercised |
| ACTION-0003 | Accounts / Roles | actionDisableMfa | `src/app/account/mfa-actions.ts:74` | UNTESTED | Not yet exercised |
| ACTION-0004 | Platform / Other | actionReceivePo | `src/app/actions.ts:133` | PASS | finance-supply-results.json: PASS PO receiving action persists dock receipt and material trace |
| ACTION-0005 | Platform / Other | actionCompleteReceivingPutaway | `src/app/actions.ts:439` | UNTESTED | Not yet exercised |
| ACTION-0006 | Platform / Other | actionCreateGfpTraveler | `src/app/actions.ts:471` | UNTESTED | Not yet exercised |
| ACTION-0007 | Platform / Other | actionCloseGfpTraveler | `src/app/actions.ts:529` | UNTESTED | Not yet exercised |
| ACTION-0008 | Platform / Other | actionClosePurchaseOrder | `src/app/actions.ts:539` | UNTESTED | Not yet exercised |
| ACTION-0009 | Platform / Other | actionClosePoFromReceiving | `src/app/actions.ts:566` | UNTESTED | Not yet exercised |
| ACTION-0010 | Platform / Other | actionCreateItemBom | `src/app/actions.ts:570` | UNTESTED | Not yet exercised |
| ACTION-0011 | Platform / Other | actionAddBomLine | `src/app/actions.ts:578` | UNTESTED | Not yet exercised |
| ACTION-0012 | Platform / Other | actionQuickCreatePart | `src/app/actions.ts:600` | UNTESTED | Not yet exercised |
| ACTION-0013 | Platform / Other | actionRemoveBomLine | `src/app/actions.ts:628` | UNTESTED | Not yet exercised |
| ACTION-0014 | Platform / Other | actionCloseMrbCase | `src/app/actions.ts:641` | PASS | round2-quality-results.json: PASS MRB USE_AS_IS action releases quarantine and close action finalizes |
| ACTION-0015 | Platform / Other | actionDispositionMrb | `src/app/actions.ts:650` | PASS | round2-quality-results.json: PASS MRB USE_AS_IS action releases quarantine and close action finalizes |
| ACTION-0016 | Platform / Other | actionUpdateCar | `src/app/actions.ts:685` | UNTESTED | Not yet exercised |
| ACTION-0017 | Platform / Other | actionSignOffStep | `src/app/actions.ts:718` | PASS | priority-results.json: PASS Start kitted production and sign traveler via own PIN actions |
| ACTION-0018 | Platform / Other | actionSendWoToReceivingPutaway | `src/app/actions.ts:773` | PASS | priority-results.json: PASS Completed production handoff then stock action closes WO |
| ACTION-0019 | Platform / Other | actionUpdateWoStatus | `src/app/actions.ts:812` | UNTESTED | Not yet exercised |
| ACTION-0020 | Platform / Other | actionSaveWorkCenter | `src/app/actions.ts:831` | UNTESTED | Not yet exercised |
| ACTION-0021 | Platform / Other | actionReorderWorkCenters | `src/app/actions.ts:869` | UNTESTED | Not yet exercised |
| ACTION-0022 | Platform / Other | actionScanWorkOrderToStation | `src/app/actions.ts:896` | UNTESTED | Not yet exercised |
| ACTION-0023 | Platform / Other | actionReassignWoStation | `src/app/actions.ts:960` | UNTESTED | Not yet exercised |
| ACTION-0024 | Platform / Other | actionReassignStepStation | `src/app/actions.ts:981` | UNTESTED | Not yet exercised |
| ACTION-0025 | Platform / Other | actionUpdateWiStepRouting | `src/app/actions.ts:1005` | UNTESTED | Not yet exercised |
| ACTION-0026 | Platform / Other | actionCertifyBomForPrototype | `src/app/actions.ts:1041` | UNTESTED | Not yet exercised |
| ACTION-0027 | Platform / Other | actionCertifyBom | `src/app/actions.ts:1053` | UNTESTED | Not yet exercised |
| ACTION-0028 | Platform / Other | actionCreateWoFromBom | `src/app/actions.ts:1065` | PASS | manufacturing-edge-results.json: PASS Standalone production action uses existing certified BOM without SO |
| ACTION-0029 | Platform / Other | actionCreateForecast | `src/app/actions.ts:1094` | FAIL | priority-results.json: FAIL Permission OPERATOR denied actionCreateForecast; round2-auth-results.json: FAIL Real OPERATOR session denied forecast creation |
| ACTION-0030 | Platform / Other | actionGenerateMrsFromForecast | `src/app/actions.ts:1180` | UNTESTED | Not yet exercised |
| ACTION-0031 | Platform / Other | actionUpdateForecast | `src/app/actions.ts:1208` | UNTESTED | Not yet exercised |
| ACTION-0032 | Platform / Other | actionUpsertForecastLine | `src/app/actions.ts:1237` | UNTESTED | Not yet exercised |
| ACTION-0033 | Platform / Other | actionRemoveForecastLine | `src/app/actions.ts:1265` | UNTESTED | Not yet exercised |
| ACTION-0034 | Platform / Other | actionBulkRescheduleUnscheduled | `src/app/actions.ts:1287` | UNTESTED | Not yet exercised |
| ACTION-0035 | Platform / Other | actionReleaseMaterialRequisition | `src/app/actions.ts:1316` | UNTESTED | Not yet exercised |
| ACTION-0036 | Platform / Other | actionUpdateMrsLine | `src/app/actions.ts:1357` | UNTESTED | Not yet exercised |
| ACTION-0037 | Platform / Other | actionAddMrsLine | `src/app/actions.ts:1385` | UNTESTED | Not yet exercised |
| ACTION-0038 | Platform / Other | actionRemoveMrsLine | `src/app/actions.ts:1402` | UNTESTED | Not yet exercised |
| ACTION-0039 | Platform / Other | actionCreateRequirement | `src/app/actions.ts:1428` | UNTESTED | Not yet exercised |
| ACTION-0040 | Platform / Other | actionUpdateRequirementStatus | `src/app/actions.ts:1453` | UNTESTED | Not yet exercised |
| ACTION-0041 | Platform / Other | actionLinkRequirementWork | `src/app/actions.ts:1476` | UNTESTED | Not yet exercised |
| ACTION-0042 | Platform / Other | actionRemoveRequirementTrace | `src/app/actions.ts:1496` | UNTESTED | Not yet exercised |
| ACTION-0043 | Platform / Other | actionLogin | `src/app/actions.ts:1516` | PASS | round2-auth-results.json: PASS Real password login/session identifies ADMIN; round2-auth-results.json: PASS Real password login/session identifies OPERATOR; round2-auth-results.json: PASS Real password login/session identifies QUALITY; round2-auth-results.json: PASS Real password login/session identifies ACCOUNTING; round2-auth-results.json: PASS Real password login/session identifies PURCHASING; round2-auth-results.json: PASS Real password login/session identifies EXECUTIVE |
| ACTION-0044 | Platform / Other | actionVerifyMfa | `src/app/actions.ts:1541` | UNTESTED | Not yet exercised |
| ACTION-0045 | Platform / Other | actionCancelMfaLogin | `src/app/actions.ts:1555` | UNTESTED | Not yet exercised |
| ACTION-0046 | Platform / Other | actionBootstrapInstance | `src/app/actions.ts:1561` | UNTESTED | Not yet exercised |
| ACTION-0047 | Platform / Other | actionLogout | `src/app/actions.ts:1581` | PASS | round2-auth-results.json: PASS Logout revokes actual session and strict page denies |
| ACTION-0048 | Platform / Other | actionAcceptInvite | `src/app/actions.ts:1590` | UNTESTED | Not yet exercised |
| ACTION-0049 | Platform / Other | actionClaimTenant | `src/app/actions.ts:1610` | UNTESTED | Not yet exercised |
| ACTION-0050 | Platform / Other | actionReissueOnboarding | `src/app/actions.ts:1638` | UNTESTED | Not yet exercised |
| ACTION-0051 | Platform / Other | actionInviteUser | `src/app/actions.ts:1670` | UNTESTED | Not yet exercised |
| ACTION-0052 | Platform / Other | actionRequestPasswordReset | `src/app/actions.ts:1700` | UNTESTED | Not yet exercised |
| ACTION-0053 | Platform / Other | actionChangePassword | `src/app/actions.ts:1774` | UNTESTED | Not yet exercised |
| ACTION-0054 | Platform / Other | actionAttestDockAcceptance | `src/app/actions.ts:1796` | UNTESTED | Not yet exercised |
| ACTION-0055 | Platform / Other | actionSendEmail | `src/app/actions.ts:1817` | UNTESTED | Not yet exercised |
| ACTION-0056 | Platform / Other | actionParseInboundEmail | `src/app/actions.ts:1842` | UNTESTED | Not yet exercised |
| ACTION-0057 | Platform / Other | actionCreateTaskWo | `src/app/actions.ts:1870` | PASS | priority-results.json: PASS Standalone task WO action creates without sales order |
| ACTION-0058 | Platform / Other | actionCreateProductionWo | `src/app/actions.ts:1895` | PASS | manufacturing-edge-results.json: PASS Standalone production action uses existing certified BOM without SO |
| ACTION-0059 | Platform / Other | actionApprovePr | `src/app/actions.ts:1899` | UNTESTED | Not yet exercised |
| ACTION-0060 | Platform / Other | actionCreateStandalonePr | `src/app/actions.ts:1930` | PASS | priority-results.json: PASS Permission OPERATOR denied purchasing PR action without writes; priority-results.json: PASS Standalone PR draft action + submission routes approvals; round2-auth-results.json: PASS Real OPERATOR cannot create standalone PR |
| ACTION-0061 | Platform / Other | actionSaveApprovalPolicy | `src/app/actions.ts:2032` | UNTESTED | Not yet exercised |
| ACTION-0062 | Platform / Other | actionAttachPrQuote | `src/app/actions.ts:2093` | UNTESTED | Not yet exercised |
| ACTION-0063 | Platform / Other | actionSaveBuyerPackage | `src/app/actions.ts:2125` | PASS | finance-supply-results.json: PASS PR routing, buyer action, final approval and PO conversion actions |
| ACTION-0064 | Platform / Other | actionConfirmBuyerPackage | `src/app/actions.ts:2259` | UNTESTED | Not yet exercised |
| ACTION-0065 | Platform / Other | actionAssignPrBuyer | `src/app/actions.ts:2289` | UNTESTED | Not yet exercised |
| ACTION-0066 | Platform / Other | actionConvertPrToPo | `src/app/actions.ts:2312` | PASS | finance-supply-results.json: PASS PR routing, buyer action, final approval and PO conversion actions; finance-supply-results.json: PASS Repeated PR-to-PO conversion does not create duplicate |
| ACTION-0067 | Platform / Other | actionRefreshScorecard | `src/app/actions.ts:2472` | UNTESTED | Not yet exercised |
| ACTION-0068 | Platform / Other | actionAiChat | `src/app/actions.ts:2479` | UNTESTED | Not yet exercised |
| ACTION-0069 | Platform / Other | actionAdvanceWiStatus | `src/app/actions.ts:2483` | UNTESTED | Not yet exercised |
| ACTION-0070 | Platform / Other | actionSubmitWiToCm | `src/app/actions.ts:2522` | UNTESTED | Not yet exercised |
| ACTION-0071 | Platform / Other | actionCreateWiRevision | `src/app/actions.ts:2539` | UNTESTED | Not yet exercised |
| ACTION-0072 | Platform / Other | actionCreateWorkInstruction | `src/app/actions.ts:2554` | UNTESTED | Not yet exercised |
| ACTION-0073 | Platform / Other | actionAddWiStep | `src/app/actions.ts:2665` | UNTESTED | Not yet exercised |
| ACTION-0074 | Platform / Other | actionLinkWiToBom | `src/app/actions.ts:2726` | UNTESTED | Not yet exercised |
| ACTION-0075 | Platform / Other | actionVoteCm | `src/app/actions.ts:2749` | UNTESTED | Not yet exercised |
| ACTION-0076 | Platform / Other | actionCreateDocumentEcr | `src/app/actions.ts:2853` | UNTESTED | Not yet exercised |
| ACTION-0077 | Platform / Other | actionAddEcrAttachments | `src/app/actions.ts:2928` | UNTESTED | Not yet exercised |
| ACTION-0078 | Platform / Other | actionSetEcrPrimaryAttachment | `src/app/actions.ts:2962` | UNTESTED | Not yet exercised |
| ACTION-0079 | Platform / Other | actionAddEcrComment | `src/app/actions.ts:2978` | UNTESTED | Not yet exercised |
| ACTION-0080 | Platform / Other | actionAssignEcrApprovers | `src/app/actions.ts:2993` | UNTESTED | Not yet exercised |
| ACTION-0081 | Platform / Other | actionReleaseDocumentEcr | `src/app/actions.ts:3011` | UNTESTED | Not yet exercised |
| ACTION-0082 | Platform / Other | actionMoveCmSubmission | `src/app/actions.ts:3031` | UNTESTED | Not yet exercised |
| ACTION-0083 | Platform / Other | actionMoveCmBoardCard | `src/app/actions.ts:3061` | UNTESTED | Not yet exercised |
| ACTION-0084 | Platform / Other | actionCreateCmFolder | `src/app/actions.ts:3116` | UNTESTED | Not yet exercised |
| ACTION-0085 | Platform / Other | actionDeleteCmFolder | `src/app/actions.ts:3135` | UNTESTED | Not yet exercised |
| ACTION-0086 | Platform / Other | actionMoveCmDocument | `src/app/actions.ts:3154` | UNTESTED | Not yet exercised |
| ACTION-0087 | Platform / Other | actionDeleteCmDocument | `src/app/actions.ts:3168` | UNTESTED | Not yet exercised |
| ACTION-0088 | Platform / Other | actionCreateSalesOrder | `src/app/actions.ts:3251` | UNTESTED | Not yet exercised |
| ACTION-0089 | Platform / Other | actionCreateQuote | `src/app/actions.ts:3311` | PASS | priority-results.json: PASS HTTP action create quote preserves line and PO reference |
| ACTION-0090 | Platform / Other | actionUpdatePoDeliveryDates | `src/app/actions.ts:3348` | UNTESTED | Not yet exercised |
| ACTION-0091 | Platform / Other | actionSetWorkOrderDueDate | `src/app/actions.ts:3392` | UNTESTED | Not yet exercised |
| ACTION-0092 | Platform / Other | actionRequestPermission | `src/app/actions.ts:3420` | UNTESTED | Not yet exercised |
| ACTION-0093 | Platform / Other | actionDecidePermissionRequest | `src/app/actions.ts:3464` | UNTESTED | Not yet exercised |
| ACTION-0094 | Platform / Other | actionSetMyPin | `src/app/actions.ts:3540` | UNTESTED | Not yet exercised |
| ACTION-0095 | Platform / Other | actionAdminResetPin | `src/app/actions.ts:3564` | UNTESTED | Not yet exercised |
| ACTION-0096 | Platform / Other | actionMarkQuoteSent | `src/app/actions.ts:3593` | UNTESTED | Not yet exercised |
| ACTION-0097 | Platform / Other | actionRecordCustomerPo | `src/app/actions.ts:3619` | FAIL | priority-results.json: PASS Customer PO action converts quote to linked SO; priority-results.json: FAIL Repeat customer PO conversion does not regress converted quote |
| ACTION-0098 | Platform / Other | actionAcceptQuote | `src/app/actions.ts:3655` | UNTESTED | Not yet exercised |
| ACTION-0099 | Platform / Other | actionSendQuote | `src/app/actions.ts:3694` | UNTESTED | Not yet exercised |
| ACTION-0100 | Platform / Other | actionPlanSalesOrder | `src/app/actions.ts:3704` | PASS | manufacturing-edge-results.json: PASS OPERATOR cannot invoke SO planning action |
| ACTION-0101 | Platform / Other | actionAssessCtp | `src/app/actions.ts:3740` | UNTESTED | Not yet exercised |
| ACTION-0102 | Platform / Other | actionCreateCustomer | `src/app/actions.ts:3802` | FAIL | priority-results.json: PASS HTTP action create customer persists; priority-results.json: PASS HTTP action duplicate preferred customer code safely deconflicts; priority-results.json: FAIL Permission OPERATOR denied actionCreateCustomer; round2-auth-results.json: FAIL Real OPERATOR session denied customer creation; round2-auth-results.json: PASS Anonymous native POST cannot create customer |
| ACTION-0103 | Platform / Other | actionUpdateCustomer | `src/app/actions.ts:3825` | UNTESTED | Not yet exercised |
| ACTION-0104 | Platform / Other | actionCheckWoMaterials | `src/app/actions.ts:3847` | UNTESTED | Not yet exercised |
| ACTION-0105 | Platform / Other | actionPlanWoMaterials | `src/app/actions.ts:3873` | UNTESTED | Not yet exercised |
| ACTION-0106 | Platform / Other | actionPutAwayItemWithLocation | `src/app/actions.ts:3877` | UNTESTED | Not yet exercised |
| ACTION-0107 | Platform / Other | actionUpdatePartInspectionFlags | `src/app/actions.ts:3892` | UNTESTED | Not yet exercised |
| ACTION-0108 | Platform / Other | actionCreateItem | `src/app/actions.ts:3934` | FAIL | priority-results.json: PASS HTTP action create catalog item persists; priority-results.json: FAIL Permission OPERATOR denied actionCreateItem; round2-auth-results.json: FAIL Real OPERATOR session denied catalog creation |
| ACTION-0109 | Platform / Other | actionUpdateItem | `src/app/actions.ts:3966` | UNTESTED | Not yet exercised |
| ACTION-0110 | Platform / Other | actionUpsertPartVendor | `src/app/actions.ts:4034` | UNTESTED | Not yet exercised |
| ACTION-0111 | Platform / Other | actionSaveUomUnit | `src/app/actions.ts:4069` | UNTESTED | Not yet exercised |
| ACTION-0112 | Platform / Other | actionSaveUomConversion | `src/app/actions.ts:4089` | UNTESTED | Not yet exercised |
| ACTION-0113 | Platform / Other | actionToggleSupplierAsl | `src/app/actions.ts:4102` | UNTESTED | Not yet exercised |
| ACTION-0114 | Platform / Other | actionUpdateAslPolicy | `src/app/actions.ts:4123` | UNTESTED | Not yet exercised |
| ACTION-0115 | Platform / Other | actionUpsertSupplierCert | `src/app/actions.ts:4139` | UNTESTED | Not yet exercised |
| ACTION-0116 | Platform / Other | actionDeleteSupplierCert | `src/app/actions.ts:4167` | UNTESTED | Not yet exercised |
| ACTION-0117 | Platform / Other | actionUpdateDepositStatus | `src/app/actions.ts:4178` | UNTESTED | Not yet exercised |
| ACTION-0118 | Platform / Other | actionCompleteReceivingInspection | `src/app/actions.ts:4205` | FAIL | round2-auth-results.json: FAIL Real OPERATOR denied receiving inspection acceptance; round2-quality-results.json: PASS QC PASS actions create functional test only after both QA gates |
| ACTION-0119 | Platform / Other | actionScanIntoReceivingTraveler | `src/app/actions.ts:4266` | UNTESTED | Not yet exercised |
| ACTION-0120 | Platform / Other | actionScanOutReceivingTraveler | `src/app/actions.ts:4284` | UNTESTED | Not yet exercised |
| ACTION-0121 | Platform / Other | actionDeliverTravelerToStation | `src/app/actions.ts:4310` | UNTESTED | Not yet exercised |
| ACTION-0122 | Platform / Other | actionCreateKit | `src/app/actions.ts:4348` | PASS | priority-results.json: PASS WO materials readiness and kit action create |
| ACTION-0123 | Platform / Other | actionCompleteKit | `src/app/actions.ts:4381` | PASS | priority-results.json: PASS Complete kit action issues materials without negative stock |
| ACTION-0124 | Platform / Other | actionAddPrototypeWiStep | `src/app/actions.ts:4415` | UNTESTED | Not yet exercised |
| ACTION-0125 | Platform / Other | actionRefreshWoEstimate | `src/app/actions.ts:4505` | UNTESTED | Not yet exercised |
| ACTION-0126 | Platform / Other | actionRescheduleWorkOrder | `src/app/actions.ts:4527` | UNTESTED | Not yet exercised |
| ACTION-0127 | Platform / Other | actionSavePlanningSettings | `src/app/actions.ts:4566` | UNTESTED | Not yet exercised |
| ACTION-0128 | Platform / Other | actionCreateBudget | `src/app/actions.ts:4597` | UNTESTED | Not yet exercised |
| ACTION-0129 | Platform / Other | actionEnsureProjectWbsChargeCodes | `src/app/actions.ts:4652` | UNTESTED | Not yet exercised |
| ACTION-0130 | Platform / Other | actionUpdateBudget | `src/app/actions.ts:4683` | UNTESTED | Not yet exercised |
| ACTION-0131 | Platform / Other | actionEnactBudget | `src/app/actions.ts:4734` | UNTESTED | Not yet exercised |
| ACTION-0132 | Platform / Other | actionCloseBudget | `src/app/actions.ts:4759` | UNTESTED | Not yet exercised |
| ACTION-0133 | Platform / Other | actionPostBudgetCharge | `src/app/actions.ts:4777` | UNTESTED | Not yet exercised |
| ACTION-0134 | Platform / Other | actionSetUserCompensation | `src/app/actions.ts:4808` | UNTESTED | Not yet exercised |
| ACTION-0135 | Platform / Other | actionFinishPrototypeWo | `src/app/actions.ts:4834` | UNTESTED | Not yet exercised |
| ACTION-0136 | Platform / Other | actionStartProduction | `src/app/actions.ts:4868` | UNTESTED | Not yet exercised |
| ACTION-0137 | Platform / Other | actionCompleteWoToStock | `src/app/actions.ts:4886` | FAIL | priority-results.json: PASS Completed production handoff then stock action closes WO; round2-finance-results.json: FAIL Task-only WO completes traveler then official completion without inventory |
| ACTION-0138 | Platform / Other | actionPutAwayItem | `src/app/actions.ts:4933` | UNTESTED | Not yet exercised |
| ACTION-0139 | Platform / Other | actionPutAwayAllReceiving | `src/app/actions.ts:4940` | UNTESTED | Not yet exercised |
| ACTION-0140 | Platform / Other | actionShipSalesOrder | `src/app/actions.ts:4946` | UNTESTED | Not yet exercised |
| ACTION-0141 | Platform / Other | actionRunKanbanReplenishment | `src/app/actions.ts:4971` | UNTESTED | Not yet exercised |
| ACTION-0142 | Platform / Other | actionQueueShipment | `src/app/actions.ts:4983` | UNTESTED | Not yet exercised |
| ACTION-0143 | Platform / Other | actionCreateManualShipment | `src/app/actions.ts:4999` | UNTESTED | Not yet exercised |
| ACTION-0144 | Platform / Other | actionVerifyPackingList | `src/app/actions.ts:5053` | UNTESTED | Not yet exercised |
| ACTION-0145 | Platform / Other | actionPackShipment | `src/app/actions.ts:5065` | UNTESTED | Not yet exercised |
| ACTION-0146 | Platform / Other | actionRequestCmNumber | `src/app/actions.ts:5096` | UNTESTED | Not yet exercised |
| ACTION-0147 | Platform / Other | actionAssignCmNumber | `src/app/actions.ts:5116` | UNTESTED | Not yet exercised |
| ACTION-0148 | Platform / Other | actionRejectCmNumberRequest | `src/app/actions.ts:5130` | UNTESTED | Not yet exercised |
| ACTION-0149 | Platform / Other | actionCancelCmNumberRequest | `src/app/actions.ts:5144` | UNTESTED | Not yet exercised |
| ACTION-0150 | Platform / Other | actionRegisterCmNumber | `src/app/actions.ts:5157` | UNTESTED | Not yet exercised |
| ACTION-0151 | Platform / Other | actionUpdateCmNumberScheme | `src/app/actions.ts:5175` | UNTESTED | Not yet exercised |
| ACTION-0152 | Platform / Other | actionUpdateRegistryStatus | `src/app/actions.ts:5205` | UNTESTED | Not yet exercised |
| ACTION-0153 | Platform / Other | actionCreateProduct | `src/app/actions.ts:5222` | UNTESTED | Not yet exercised |
| ACTION-0154 | Platform / Other | actionUpdateProduct | `src/app/actions.ts:5241` | UNTESTED | Not yet exercised |
| ACTION-0155 | Platform / Other | actionAdvanceProductLifecycle | `src/app/actions.ts:5259` | UNTESTED | Not yet exercised |
| ACTION-0156 | Platform / Other | actionAddProductPart | `src/app/actions.ts:5276` | UNTESTED | Not yet exercised |
| ACTION-0157 | Platform / Other | actionRemoveProductPart | `src/app/actions.ts:5291` | UNTESTED | Not yet exercised |
| ACTION-0158 | Platform / Other | actionAddProductDocument | `src/app/actions.ts:5301` | UNTESTED | Not yet exercised |
| ACTION-0159 | Platform / Other | actionRemoveProductDocument | `src/app/actions.ts:5322` | UNTESTED | Not yet exercised |
| ACTION-0160 | Platform / Other | actionAddProductRequirement | `src/app/actions.ts:5332` | UNTESTED | Not yet exercised |
| ACTION-0161 | Platform / Other | actionUpdateProductRequirement | `src/app/actions.ts:5354` | UNTESTED | Not yet exercised |
| ACTION-0162 | Platform / Other | actionRemoveProductRequirement | `src/app/actions.ts:5370` | UNTESTED | Not yet exercised |
| ACTION-0163 | Platform / Other | actionAddProductVariant | `src/app/actions.ts:5380` | UNTESTED | Not yet exercised |
| ACTION-0164 | Platform / Other | actionRemoveProductVariant | `src/app/actions.ts:5401` | UNTESTED | Not yet exercised |
| ACTION-0165 | Platform / Other | actionAddProductMilestone | `src/app/actions.ts:5411` | UNTESTED | Not yet exercised |
| ACTION-0166 | Platform / Other | actionUpdateProductMilestone | `src/app/actions.ts:5429` | UNTESTED | Not yet exercised |
| ACTION-0167 | Platform / Other | actionRemoveProductMilestone | `src/app/actions.ts:5447` | UNTESTED | Not yet exercised |
| ACTION-0168 | Platform / Other | actionAddProductMember | `src/app/actions.ts:5457` | UNTESTED | Not yet exercised |
| ACTION-0169 | Platform / Other | actionRemoveProductMember | `src/app/actions.ts:5470` | UNTESTED | Not yet exercised |
| ACTION-0170 | Platform / Other | actionCreateProgram | `src/app/actions.ts:5495` | UNTESTED | Not yet exercised |
| ACTION-0171 | Platform / Other | actionUpdateProgramContract | `src/app/actions.ts:5523` | UNTESTED | Not yet exercised |
| ACTION-0172 | Platform / Other | actionAddProgramClin | `src/app/actions.ts:5544` | UNTESTED | Not yet exercised |
| ACTION-0173 | Platform / Other | actionSaveIndirectRate | `src/app/actions.ts:5562` | UNTESTED | Not yet exercised |
| ACTION-0174 | Platform / Other | actionSetAccountAllowability | `src/app/actions.ts:5581` | UNTESTED | Not yet exercised |
| ACTION-0175 | Platform / Other | actionSetGovconControls | `src/app/actions.ts:5603` | UNTESTED | Not yet exercised |
| ACTION-0176 | Platform / Other | actionCreatePmoProject | `src/app/actions.ts:5628` | UNTESTED | Not yet exercised |
| ACTION-0177 | Platform / Other | actionUpdateProjectCharter | `src/app/actions.ts:5660` | UNTESTED | Not yet exercised |
| ACTION-0178 | Platform / Other | actionAddProjectRisk | `src/app/actions.ts:5705` | UNTESTED | Not yet exercised |
| ACTION-0179 | Platform / Other | actionUpdateProjectRisk | `src/app/actions.ts:5725` | UNTESTED | Not yet exercised |
| ACTION-0180 | Platform / Other | actionAddProjectIssue | `src/app/actions.ts:5739` | UNTESTED | Not yet exercised |
| ACTION-0181 | Platform / Other | actionUpdateProjectIssue | `src/app/actions.ts:5753` | UNTESTED | Not yet exercised |
| ACTION-0182 | Platform / Other | actionUpsertRaci | `src/app/actions.ts:5767` | UNTESTED | Not yet exercised |
| ACTION-0183 | Platform / Other | actionDeleteRaci | `src/app/actions.ts:5784` | UNTESTED | Not yet exercised |
| ACTION-0184 | Platform / Other | actionAddCommunication | `src/app/actions.ts:5792` | UNTESTED | Not yet exercised |
| ACTION-0185 | Platform / Other | actionDeleteCommunication | `src/app/actions.ts:5810` | UNTESTED | Not yet exercised |
| ACTION-0186 | Platform / Other | actionAddPmoTask | `src/app/actions.ts:5820` | UNTESTED | Not yet exercised |
| ACTION-0187 | Platform / Other | actionUpdatePmoTask | `src/app/actions.ts:5842` | UNTESTED | Not yet exercised |
| ACTION-0188 | Platform / Other | actionAddPmoMilestone | `src/app/actions.ts:5854` | UNTESTED | Not yet exercised |
| ACTION-0189 | Platform / Other | actionUpdatePmoMilestone | `src/app/actions.ts:5868` | UNTESTED | Not yet exercised |
| ACTION-0190 | Platform / Other | actionSaveWikiPage | `src/app/actions.ts:5881` | UNTESTED | Not yet exercised |
| ACTION-0191 | Platform / Other | actionCreatePi | `src/app/actions.ts:5897` | UNTESTED | Not yet exercised |
| ACTION-0192 | Platform / Other | actionAddPiFeature | `src/app/actions.ts:5912` | UNTESTED | Not yet exercised |
| ACTION-0193 | Platform / Other | actionAddCostEntry | `src/app/actions.ts:5926` | UNTESTED | Not yet exercised |
| ACTION-0194 | Platform / Other | actionAddProjectRequirement | `src/app/actions.ts:5944` | UNTESTED | Not yet exercised |
| ACTION-0195 | Platform / Other | actionSyncReqsToProduct | `src/app/actions.ts:5962` | UNTESTED | Not yet exercised |
| ACTION-0196 | Platform / Other | actionSyncMilestonesToProduct | `src/app/actions.ts:5974` | UNTESTED | Not yet exercised |
| ACTION-0197 | Platform / Other | actionLinkProductToProject | `src/app/actions.ts:5986` | UNTESTED | Not yet exercised |
| ACTION-0198 | Platform / Other | actionCreateWbs | `src/app/actions.ts:6003` | UNTESTED | Not yet exercised |
| ACTION-0199 | Platform / Other | actionUpdateWbs | `src/app/actions.ts:6028` | UNTESTED | Not yet exercised |
| ACTION-0200 | Platform / Other | actionCreateCampaign | `src/app/actions.ts:6057` | UNTESTED | Not yet exercised |
| ACTION-0201 | Platform / Other | actionUpdateCampaign | `src/app/actions.ts:6082` | UNTESTED | Not yet exercised |
| ACTION-0202 | Platform / Other | actionCreateSaga | `src/app/actions.ts:6098` | UNTESTED | Not yet exercised |
| ACTION-0203 | Platform / Other | actionUpdateSaga | `src/app/actions.ts:6135` | UNTESTED | Not yet exercised |
| ACTION-0204 | Platform / Other | actionCreateEngTask | `src/app/actions.ts:6151` | UNTESTED | Not yet exercised |
| ACTION-0205 | Platform / Other | actionUpdateEngTask | `src/app/actions.ts:6194` | UNTESTED | Not yet exercised |
| ACTION-0206 | Platform / Other | actionScanIn | `src/app/actions.ts:6215` | UNTESTED | Not yet exercised |
| ACTION-0207 | Platform / Other | actionScanOut | `src/app/actions.ts:6232` | UNTESTED | Not yet exercised |
| ACTION-0208 | Platform / Other | actionBreakDownTask | `src/app/actions.ts:6249` | UNTESTED | Not yet exercised |
| ACTION-0209 | Platform / Other | actionAddEngDependency | `src/app/actions.ts:6267` | UNTESTED | Not yet exercised |
| ACTION-0210 | Platform / Other | actionRemoveEngDependency | `src/app/actions.ts:6317` | UNTESTED | Not yet exercised |
| ACTION-0211 | Platform / Other | actionCreateEngSprint | `src/app/actions.ts:6329` | UNTESTED | Not yet exercised |
| ACTION-0212 | Platform / Other | actionCreatePlanningQuarter | `src/app/actions.ts:6350` | UNTESTED | Not yet exercised |
| ACTION-0213 | Platform / Other | actionUpdatePlanningQuarter | `src/app/actions.ts:6370` | UNTESTED | Not yet exercised |
| ACTION-0214 | Platform / Other | actionCreatePmoSprint | `src/app/actions.ts:6384` | UNTESTED | Not yet exercised |
| ACTION-0215 | Platform / Other | actionUpsertBusinessPriority | `src/app/actions.ts:6402` | UNTESTED | Not yet exercised |
| ACTION-0216 | Platform / Other | actionSetPriorityStatus | `src/app/actions.ts:6426` | UNTESTED | Not yet exercised |
| ACTION-0217 | Platform / Other | actionAssignUserGroup | `src/app/actions.ts:6440` | UNTESTED | Not yet exercised |
| ACTION-0218 | Platform / Other | actionRemoveUserGroup | `src/app/actions.ts:6452` | UNTESTED | Not yet exercised |
| ACTION-0219 | Platform / Other | actionGrantUserPermission | `src/app/actions.ts:6464` | UNTESTED | Not yet exercised |
| ACTION-0220 | Platform / Other | actionPostJournal | `src/app/actions.ts:6478` | FAIL | priority-results.json: FAIL Permission OPERATOR denied posting journal action; priority-results.json: PASS Journal action creates balanced pending entry; finance-supply-results.json: FAIL Non-controller accountant cannot postNow around required approval; round2-auth-results.json: FAIL Real OPERATOR session denied GL posting; round2-auth-results.json: FAIL Real ACCOUNTING cannot immediately post around required approval |
| ACTION-0221 | Platform / Other | actionUpdateEngSprint | `src/app/actions.ts:6545` | UNTESTED | Not yet exercised |
| ACTION-0222 | Platform / Other | actionAssignTaskSprint | `src/app/actions.ts:6561` | UNTESTED | Not yet exercised |
| ACTION-0223 | Platform / Other | actionAssignSagaSprint | `src/app/actions.ts:6577` | UNTESTED | Not yet exercised |
| ACTION-0224 | Platform / Other | actionCreateProductionEngIssue | `src/app/actions.ts:6593` | UNTESTED | Not yet exercised |
| ACTION-0225 | Platform / Other | actionAcceptProductionIssue | `src/app/actions.ts:6623` | UNTESTED | Not yet exercised |
| ACTION-0226 | Platform / Other | actionUpdateProductionEngIssue | `src/app/actions.ts:6642` | UNTESTED | Not yet exercised |
| ACTION-0227 | Platform / Other | actionMoveEngWork | `src/app/actions.ts:6667` | UNTESTED | Not yet exercised |
| ACTION-0228 | Platform / Other | actionCreateSwimLane | `src/app/actions.ts:6690` | UNTESTED | Not yet exercised |
| ACTION-0229 | Platform / Other | actionRemoveSwimLane | `src/app/actions.ts:6701` | UNTESTED | Not yet exercised |
| ACTION-0230 | Platform / Other | actionMarkEngAlertRead | `src/app/actions.ts:6711` | UNTESTED | Not yet exercised |
| ACTION-0231 | Platform / Other | actionAttachGfpDocument | `src/app/actions.ts:6723` | UNTESTED | Not yet exercised |
| ACTION-0232 | Platform / Other | actionSetGfpAuditInterval | `src/app/actions.ts:6746` | UNTESTED | Not yet exercised |
| ACTION-0233 | Platform / Other | actionCompleteGfpAudit | `src/app/actions.ts:6757` | UNTESTED | Not yet exercised |
| ACTION-0234 | Platform / Other | actionCheckoutGfp | `src/app/actions.ts:6771` | UNTESTED | Not yet exercised |
| ACTION-0235 | Platform / Other | actionCheckinGfp | `src/app/actions.ts:6786` | UNTESTED | Not yet exercised |
| ACTION-0236 | Platform / Other | actionRequestGfpConsumption | `src/app/actions.ts:6805` | UNTESTED | Not yet exercised |
| ACTION-0237 | Platform / Other | actionDecideGfpConsumption | `src/app/actions.ts:6822` | UNTESTED | Not yet exercised |
| ACTION-0238 | Platform / Other | actionCreateVirtualAsset | `src/app/actions.ts:6846` | UNTESTED | Not yet exercised |
| ACTION-0239 | Platform / Other | actionAssignVirtualAsset | `src/app/actions.ts:6881` | UNTESTED | Not yet exercised |
| ACTION-0240 | Platform / Other | actionCheckoutVirtualAsset | `src/app/actions.ts:6897` | UNTESTED | Not yet exercised |
| ACTION-0241 | Platform / Other | actionReturnVirtualAsset | `src/app/actions.ts:6913` | UNTESTED | Not yet exercised |
| ACTION-0242 | Platform / Other | actionUnassignVirtualAsset | `src/app/actions.ts:6928` | UNTESTED | Not yet exercised |
| ACTION-0243 | Platform / Other | actionAlignBusinessPriority | `src/app/actions.ts:6944` | UNTESTED | Not yet exercised |
| ACTION-0244 | Platform / Other | actionAssignWorkCenterStaff | `src/app/actions.ts:6996` | UNTESTED | Not yet exercised |
| ACTION-0245 | Platform / Other | actionRemoveWorkCenterStaff | `src/app/actions.ts:7011` | UNTESTED | Not yet exercised |
| ACTION-0246 | Platform / Other | actionCreateAccount | `src/app/actions.ts:7024` | UNTESTED | Not yet exercised |
| ACTION-0247 | Platform / Other | actionUpdateAccount | `src/app/actions.ts:7054` | UNTESTED | Not yet exercised |
| ACTION-0248 | Platform / Other | actionQueueShipmentAndOpen | `src/app/actions.ts:7073` | UNTESTED | Not yet exercised |
| ACTION-0249 | Platform / Other | actionDecidePto | `src/app/actions.ts:7093` | UNTESTED | Not yet exercised |
| ACTION-0250 | Platform / Other | actionRequestPto | `src/app/actions.ts:7115` | UNTESTED | Not yet exercised |
| ACTION-0251 | Platform / Other | actionDecideTimeEntry | `src/app/actions.ts:7136` | UNTESTED | Not yet exercised |
| ACTION-0252 | Platform / Other | actionAdvanceExpense | `src/app/actions.ts:7158` | UNTESTED | Not yet exercised |
| ACTION-0253 | Platform / Other | actionReimburseExpense | `src/app/actions.ts:7176` | UNTESTED | Not yet exercised |
| ACTION-0254 | Platform / Other | actionUpdateGoalProgress | `src/app/actions.ts:7190` | UNTESTED | Not yet exercised |
| ACTION-0255 | Platform / Other | actionSwitchDemoUser | `src/app/actions.ts:7203` | UNTESTED | Not yet exercised |
| ACTION-0256 | Platform / Other | actionSavePerformanceReview | `src/app/actions.ts:7229` | UNTESTED | Not yet exercised |
| ACTION-0257 | Platform / Other | actionCreateEmployeeGoal | `src/app/actions.ts:7285` | UNTESTED | Not yet exercised |
| ACTION-0258 | Platform / Other | actionAddEmployeeDocument | `src/app/actions.ts:7319` | UNTESTED | Not yet exercised |
| ACTION-0259 | Platform / Other | actionAddTrainingRecord | `src/app/actions.ts:7359` | UNTESTED | Not yet exercised |
| ACTION-0260 | Platform / Other | actionCreateTrainingRequirement | `src/app/actions.ts:7429` | UNTESTED | Not yet exercised |
| ACTION-0261 | Platform / Other | actionToggleTrainingRequirement | `src/app/actions.ts:7468` | UNTESTED | Not yet exercised |
| ACTION-0262 | Platform / Other | actionAttachTrainingEvidence | `src/app/actions.ts:7489` | UNTESTED | Not yet exercised |
| ACTION-0263 | Platform / Other | actionGoalCheckIn | `src/app/actions.ts:7530` | UNTESTED | Not yet exercised |
| ACTION-0264 | Platform / Other | actionImportData | `src/app/actions.ts:7563` | UNTESTED | Not yet exercised |
| ACTION-0265 | Platform / Other | actionAddFeedbackNote | `src/app/actions.ts:7608` | UNTESTED | Not yet exercised |
| ACTION-0266 | Platform / Other | actionCreatePermissionGroup | `src/app/actions.ts:7644` | UNTESTED | Not yet exercised |
| ACTION-0267 | Platform / Other | actionToggleGroupPermission | `src/app/actions.ts:7664` | UNTESTED | Not yet exercised |
| ACTION-0268 | Platform / Other | actionShipReturnShipment | `src/app/actions.ts:7682` | UNTESTED | Not yet exercised |
| ACTION-0269 | Platform / Other | actionAddTimesheetEntry | `src/app/actions.ts:7730` | UNTESTED | Not yet exercised |
| ACTION-0270 | Platform / Other | actionRemoveTimesheetEntry | `src/app/actions.ts:7750` | UNTESTED | Not yet exercised |
| ACTION-0271 | Platform / Other | actionSubmitTimesheet | `src/app/actions.ts:7763` | UNTESTED | Not yet exercised |
| ACTION-0272 | Platform / Other | actionDecideTimesheetApproval | `src/app/actions.ts:7774` | UNTESTED | Not yet exercised |
| ACTION-0273 | Platform / Other | actionReviewTimecard | `src/app/actions.ts:7801` | UNTESTED | Not yet exercised |
| ACTION-0274 | Platform / Other | actionSaveTimecardGrid | `src/app/actions.ts:7831` | UNTESTED | Not yet exercised |
| ACTION-0275 | Platform / Other | actionProcessTimesheet | `src/app/actions.ts:7854` | UNTESTED | Not yet exercised |
| ACTION-0276 | Platform / Other | actionCreateTestProcedure | `src/app/actions.ts:7870` | UNTESTED | Not yet exercised |
| ACTION-0277 | Platform / Other | actionAddTestProcedureStep | `src/app/actions.ts:7892` | UNTESTED | Not yet exercised |
| ACTION-0278 | Platform / Other | actionReleaseTestProcedure | `src/app/actions.ts:7916` | UNTESTED | Not yet exercised |
| ACTION-0279 | Platform / Other | actionSubmitTestProcedureToCm | `src/app/actions.ts:7941` | UNTESTED | Not yet exercised |
| ACTION-0280 | Platform / Other | actionRecordTestSignOff | `src/app/actions.ts:7956` | UNTESTED | Not yet exercised |
| ACTION-0281 | Platform / Other | actionCreateAsset | `src/app/actions.ts:7981` | UNTESTED | Not yet exercised |
| ACTION-0282 | Platform / Other | actionCheckoutAsset | `src/app/actions.ts:8002` | UNTESTED | Not yet exercised |
| ACTION-0283 | Platform / Other | actionCheckinAsset | `src/app/actions.ts:8023` | UNTESTED | Not yet exercised |
| ACTION-0284 | Platform / Other | actionConnectBank | `src/app/actions.ts:8036` | UNTESTED | Not yet exercised |
| ACTION-0285 | Platform / Other | actionImportBankTransactions | `src/app/actions.ts:8057` | UNTESTED | Not yet exercised |
| ACTION-0286 | Platform / Other | actionCategorizeBankTxn | `src/app/actions.ts:8083` | UNTESTED | Not yet exercised |
| ACTION-0287 | Platform / Other | actionReconcileBankTxn | `src/app/actions.ts:8096` | UNTESTED | Not yet exercised |
| ACTION-0288 | Platform / Other | actionReverseJournal | `src/app/actions.ts:8102` | UNTESTED | Not yet exercised |
| ACTION-0289 | Platform / Other | actionSetSupplier1099 | `src/app/actions.ts:8122` | UNTESTED | Not yet exercised |
| ACTION-0290 | Platform / Other | actionCreateScheduledReport | `src/app/actions.ts:8142` | UNTESTED | Not yet exercised |
| ACTION-0291 | Platform / Other | actionToggleScheduledReport | `src/app/actions.ts:8166` | UNTESTED | Not yet exercised |
| ACTION-0292 | Platform / Other | actionDeleteScheduledReport | `src/app/actions.ts:8181` | UNTESTED | Not yet exercised |
| ACTION-0293 | Platform / Other | actionRunScheduledReports | `src/app/actions.ts:8194` | UNTESTED | Not yet exercised |
| ACTION-0294 | Platform / Other | actionReclassifyLines | `src/app/actions.ts:8211` | UNTESTED | Not yet exercised |
| ACTION-0295 | Platform / Other | actionCreateRecurringJournal | `src/app/actions.ts:8244` | UNTESTED | Not yet exercised |
| ACTION-0296 | Platform / Other | actionToggleRecurringJournal | `src/app/actions.ts:8285` | UNTESTED | Not yet exercised |
| ACTION-0297 | Platform / Other | actionDeleteRecurringJournal | `src/app/actions.ts:8304` | UNTESTED | Not yet exercised |
| ACTION-0298 | Platform / Other | actionRunRecurringJournals | `src/app/actions.ts:8321` | UNTESTED | Not yet exercised |
| ACTION-0299 | Platform / Other | actionSaveWithholding | `src/app/actions.ts:8340` | UNTESTED | Not yet exercised |
| ACTION-0300 | Platform / Other | actionCreatePlaidLinkToken | `src/app/actions.ts:8378` | UNTESTED | Not yet exercised |
| ACTION-0301 | Platform / Other | actionExchangePlaidToken | `src/app/actions.ts:8399` | UNTESTED | Not yet exercised |
| ACTION-0302 | Platform / Other | actionSyncPlaid | `src/app/actions.ts:8428` | UNTESTED | Not yet exercised |
| ACTION-0303 | Platform / Other | actionRunPayroll | `src/app/actions.ts:8455` | UNTESTED | Not yet exercised |
| ACTION-0304 | Platform / Other | actionSavePayrollPolicy | `src/app/actions.ts:8466` | UNTESTED | Not yet exercised |
| ACTION-0305 | Platform / Other | actionSaveAccountingSettings | `src/app/actions.ts:8520` | UNTESTED | Not yet exercised |
| ACTION-0306 | Platform / Other | actionSaveReviewPolicy | `src/app/actions.ts:8559` | UNTESTED | Not yet exercised |
| ACTION-0307 | Platform / Other | actionOpenDueReviewCycles | `src/app/actions.ts:8582` | UNTESTED | Not yet exercised |
| ACTION-0308 | Platform / Other | actionSubmitSelfReview | `src/app/actions.ts:8593` | UNTESTED | Not yet exercised |
| ACTION-0309 | Platform / Other | actionSignOffReview | `src/app/actions.ts:8621` | UNTESTED | Not yet exercised |
| ACTION-0310 | Platform / Other | actionApproveJournal | `src/app/actions.ts:8641` | FAIL | round2-auth-results.json: FAIL Real ACCOUNTING concurrent approvals apply balances only once; round2-auth-results.json: FAIL Real EXECUTIVE with journal.approve can approve without journal.post |
| ACTION-0311 | Platform / Other | actionVoidJournal | `src/app/actions.ts:8658` | UNTESTED | Not yet exercised |
| ACTION-0312 | Platform / Other | actionSetAccountingCloseDate | `src/app/actions.ts:8674` | UNTESTED | Not yet exercised |
| ACTION-0313 | Platform / Other | actionRecordArPayment | `src/app/actions.ts:8695` | UNTESTED | Not yet exercised |
| ACTION-0314 | Platform / Other | actionRecordApPayment | `src/app/actions.ts:8715` | UNTESTED | Not yet exercised |
| ACTION-0315 | Platform / Other | actionCreateVendorApInvoice | `src/app/actions.ts:8743` | UNTESTED | Not yet exercised |
| ACTION-0316 | Platform / Other | actionCreateExpenseEntry | `src/app/actions.ts:8783` | UNTESTED | Not yet exercised |
| ACTION-0317 | Platform / Other | actionSaveCompanyProfile | `src/app/actions.ts:8814` | UNTESTED | Not yet exercised |
| ACTION-0318 | Platform / Other | actionSaveCompanyOps | `src/app/actions.ts:8845` | UNTESTED | Not yet exercised |
| ACTION-0319 | Platform / Other | actionActivatePlan | `src/app/actions.ts:8878` | UNTESTED | Not yet exercised |
| ACTION-0320 | Platform / Other | actionStartCheckout | `src/app/actions.ts:8907` | UNTESTED | Not yet exercised |
| ACTION-0321 | Platform / Other | actionStartTrial | `src/app/actions.ts:8975` | UNTESTED | Not yet exercised |
| ACTION-0322 | Platform / Other | actionCancelSubscription | `src/app/actions.ts:8985` | UNTESTED | Not yet exercised |
| ACTION-0323 | Platform / Other | actionCreateQualityItem | `src/app/actions.ts:8997` | UNTESTED | Not yet exercised |
| ACTION-0324 | Platform / Other | actionRecordQualityEvent | `src/app/actions.ts:9030` | UNTESTED | Not yet exercised |
| ACTION-0325 | Platform / Other | actionSetQualityItemStatus | `src/app/actions.ts:9056` | UNTESTED | Not yet exercised |
| ACTION-0326 | Platform / Other | actionCreateToolbox | `src/app/actions.ts:9077` | UNTESTED | Not yet exercised |
| ACTION-0327 | Platform / Other | actionCreateTool | `src/app/actions.ts:9101` | UNTESTED | Not yet exercised |
| ACTION-0328 | Platform / Other | actionAssignToolToToolbox | `src/app/actions.ts:9132` | UNTESTED | Not yet exercised |
| ACTION-0329 | Platform / Other | actionSaveToolboxInspection | `src/app/actions.ts:9150` | UNTESTED | Not yet exercised |
| ACTION-0330 | Platform / Other | actionCreateToolReport | `src/app/actions.ts:9171` | UNTESTED | Not yet exercised |
| ACTION-0331 | Platform / Other | actionUpdateToolReportPieces | `src/app/actions.ts:9194` | UNTESTED | Not yet exercised |
| ACTION-0332 | Platform / Other | actionDeclarePieceUnrecoverable | `src/app/actions.ts:9210` | UNTESTED | Not yet exercised |
| ACTION-0333 | Platform / Other | actionPlaceReplacementPr | `src/app/actions.ts:9225` | UNTESTED | Not yet exercised |
| ACTION-0334 | Platform / Other | actionUpdateToolReportSteps | `src/app/actions.ts:9245` | UNTESTED | Not yet exercised |
| ACTION-0335 | Platform / Other | actionSetToolReportStatus | `src/app/actions.ts:9261` | UNTESTED | Not yet exercised |
| ACTION-0336 | Platform / Other | actionSaveInspectionTemplate | `src/app/actions.ts:9282` | UNTESTED | Not yet exercised |
| ACTION-0337 | Platform / Other | actionPerformInspection | `src/app/actions.ts:9303` | UNTESTED | Not yet exercised |
| ACTION-0338 | Platform / Other | actionRecordHumidity | `src/app/actions.ts:9325` | UNTESTED | Not yet exercised |
| ACTION-0339 | Platform / Other | actionSubmitProgramPolicy | `src/app/actions.ts:9349` | UNTESTED | Not yet exercised |
| ACTION-0340 | Platform / Other | actionLinkProgramPolicy | `src/app/actions.ts:9369` | UNTESTED | Not yet exercised |
| ACTION-0341 | Platform / Other | actionLogCounterfeitIncident | `src/app/actions.ts:9388` | UNTESTED | Not yet exercised |
| ACTION-0342 | Platform / Other | actionSaveAudit | `src/app/actions.ts:9410` | UNTESTED | Not yet exercised |
| ACTION-0343 | Platform / Other | actionUpdateAuditFinding | `src/app/actions.ts:9432` | UNTESTED | Not yet exercised |
| ACTION-0344 | Platform / Other | actionLinkCalToolToMrb | `src/app/actions.ts:9454` | UNTESTED | Not yet exercised |
| ACTION-0345 | Platform / Other | actionSetCalToolDisposition | `src/app/actions.ts:9472` | UNTESTED | Not yet exercised |
| ACTION-0346 | Platform / Other | actionTriggerIncidentFromMrb | `src/app/actions.ts:9491` | UNTESTED | Not yet exercised |
| ACTION-0347 | Platform / Other | actionUpdateIncidentSteps | `src/app/actions.ts:9511` | UNTESTED | Not yet exercised |
| ACTION-0348 | Platform / Other | actionSetIncidentResult | `src/app/actions.ts:9527` | UNTESTED | Not yet exercised |
| ACTION-0349 | Platform / Other | actionCreateRequisition | `src/app/actions.ts:9548` | UNTESTED | Not yet exercised |
| ACTION-0350 | Platform / Other | actionUpdateRequisitionStatus | `src/app/actions.ts:9575` | UNTESTED | Not yet exercised |
| ACTION-0351 | Platform / Other | actionAddCandidate | `src/app/actions.ts:9594` | UNTESTED | Not yet exercised |
| ACTION-0352 | Platform / Other | actionMoveCandidateStage | `src/app/actions.ts:9620` | UNTESTED | Not yet exercised |
| ACTION-0353 | Platform / Other | actionRecordBackgroundCheck | `src/app/actions.ts:9647` | UNTESTED | Not yet exercised |
| ACTION-0354 | Platform / Other | actionUpdateBackgroundCheck | `src/app/actions.ts:9675` | UNTESTED | Not yet exercised |
| ACTION-0355 | Platform / Other | actionCreateOnboarding | `src/app/actions.ts:9698` | UNTESTED | Not yet exercised |
| ACTION-0356 | Platform / Other | actionUpdateOnboarding | `src/app/actions.ts:9725` | UNTESTED | Not yet exercised |
| ACTION-0357 | Platform / Other | actionSetOnboardingChecklistItem | `src/app/actions.ts:9758` | UNTESTED | Not yet exercised |
| ACTION-0358 | Platform / Other | actionCompleteOnboarding | `src/app/actions.ts:9779` | UNTESTED | Not yet exercised |
| ACTION-0359 | Platform / Other | actionClockOutForBreak | `src/app/actions.ts:9794` | UNTESTED | Not yet exercised |
| ACTION-0360 | Platform / Other | actionReleaseCommitment | `src/app/actions.ts:9805` | UNTESTED | Not yet exercised |
| ACTION-0361 | Platform / Other | actionCreateLocation | `src/app/actions.ts:9842` | UNTESTED | Not yet exercised |
| ACTION-0362 | Platform / Other | actionConsumeVirtualAsset | `src/app/actions.ts:9891` | UNTESTED | Not yet exercised |
| ACTION-0363 | Platform / Other | actionCreateSupplier | `src/app/actions.ts:9951` | UNTESTED | Not yet exercised |
| ACTION-0364 | Platform / Other | actionMoveWorkOrder | `src/app/actions.ts:10004` | UNTESTED | Not yet exercised |
| ACTION-0365 | Platform / Other | actionCreateCycleCount | `src/app/actions.ts:10035` | UNTESTED | Not yet exercised |
| ACTION-0366 | Platform / Other | actionRecordCycleCountLine | `src/app/actions.ts:10057` | UNTESTED | Not yet exercised |
| ACTION-0367 | Platform / Other | actionCompleteCycleCount | `src/app/actions.ts:10080` | UNTESTED | Not yet exercised |
| ACTION-0368 | Platform / Other | actionCancelCycleCount | `src/app/actions.ts:10101` | UNTESTED | Not yet exercised |
| ACTION-0369 | Platform / Other | actionSetModuleEnabled | `src/app/actions.ts:10121` | UNTESTED | Not yet exercised |
| ACTION-0370 | Platform / Other | actionWizardAddPerson | `src/app/actions.ts:10170` | UNTESTED | Not yet exercised |
| ACTION-0371 | Platform / Other | actionCompleteSetup | `src/app/actions.ts:10208` | UNTESTED | Not yet exercised |
| ACTION-0372 | Platform / Other | actionCreateRmaRequest | `src/app/actions.ts:10242` | UNTESTED | Not yet exercised |
| ACTION-0373 | Platform / Other | actionIssueRma | `src/app/actions.ts:10278` | UNTESTED | Not yet exercised |
| ACTION-0374 | Platform / Other | actionCreateRepairQuoteForRma | `src/app/actions.ts:10318` | UNTESTED | Not yet exercised |
| ACTION-0375 | Platform / Other | actionAcceptRepairQuote | `src/app/actions.ts:10338` | UNTESTED | Not yet exercised |
| ACTION-0376 | Platform / Other | actionUpdateRepairQuote | `src/app/actions.ts:10370` | UNTESTED | Not yet exercised |
| ACTION-0377 | Platform / Other | actionAdjustRmaQuotePrice | `src/app/actions.ts:10417` | UNTESTED | Not yet exercised |
| ACTION-0378 | Platform / Other | actionAssignKitSerialToUnit | `src/app/actions.ts:10442` | UNTESTED | Not yet exercised |
| ACTION-0379 | Platform / Other | actionInstallSerialOnWo | `src/app/actions.ts:10468` | UNTESTED | Not yet exercised |
| ACTION-0380 | Platform / Other | actionRemoveSerialInstall | `src/app/actions.ts:10524` | UNTESTED | Not yet exercised |
| ACTION-0381 | Platform / Other | actionAmendPo | `src/app/actions.ts:10558` | UNTESTED | Not yet exercised |
| ACTION-0382 | Platform / Other | actionDecidePoAmendment | `src/app/actions.ts:10600` | UNTESTED | Not yet exercised |
| ACTION-0383 | Admin / Settings | actionSetIssueStatus | `src/app/admin/insights/actions.ts:21` | UNTESTED | Not yet exercised |
| ACTION-0384 | Platform / Other | actionAiChat | `src/app/ai/actions.ts:32` | UNTESTED | Not yet exercised |
| ACTION-0385 | Platform / Other | actionAiConversation | `src/app/ai/actions.ts:36` | UNTESTED | Not yet exercised |
| ACTION-0386 | Platform / Other | actionCarinaFeatures | `src/app/ai/actions.ts:96` | UNTESTED | Not yet exercised |
| ACTION-0387 | Platform / Other | actionCarinaCostReport | `src/app/ai/actions.ts:101` | UNTESTED | Not yet exercised |
| ACTION-0388 | Platform / Other | actionGetAssistantName | `src/app/ai/actions.ts:105` | UNTESTED | Not yet exercised |
| ACTION-0389 | Platform / Other | actionSetAssistantName | `src/app/ai/actions.ts:119` | UNTESTED | Not yet exercised |
| ACTION-0390 | Platform / Other | actionGrokStatus | `src/app/ai/actions.ts:141` | UNTESTED | Not yet exercised |
| ACTION-0391 | Platform / Other | actionProbeGrok | `src/app/ai/actions.ts:149` | UNTESTED | Not yet exercised |
| ACTION-0392 | Platform / Other | actionVoiceSmokeTest | `src/app/ai/actions.ts:154` | UNTESTED | Not yet exercised |
| ACTION-0393 | PLM / BOM / ECO | actionVoteCmFriendly | `src/app/cm/vote-actions.ts:15` | UNTESTED | Not yet exercised |
| ACTION-0394 | CRM / Sales | actionCreateLead | `src/app/crm/actions.ts:39` | PASS | priority-results.json: PASS HTTP action create CRM lead persists; round2-modules-results.json: PASS CRM lead action creates then valid status update persists; round2-modules-results.json: PASS CRM blank lead company is rejected without writes |
| ACTION-0395 | CRM / Sales | actionUpdateLeadStatus | `src/app/crm/actions.ts:55` | FAIL | round2-modules-results.json: PASS CRM lead action creates then valid status update persists; round2-modules-results.json: FAIL CRM lead status action rejects unknown state |
| ACTION-0396 | CRM / Sales | actionConvertLead | `src/app/crm/actions.ts:64` | PASS | round2-modules-results.json: PASS CRM lead conversion action links opportunity |
| ACTION-0397 | CRM / Sales | actionCreateOpportunity | `src/app/crm/actions.ts:82` | PASS | round2-modules-results.json: PASS CRM opportunity create and update actions persist fields |
| ACTION-0398 | CRM / Sales | actionSetStage | `src/app/crm/actions.ts:99` | PASS | round2-modules-results.json: PASS CRM stage action ignores unknown stage and requires LOST reason; round2-modules-results.json: PASS CRM WON then reopened opportunity clears close timestamp |
| ACTION-0399 | CRM / Sales | actionUpdateOpportunity | `src/app/crm/actions.ts:116` | FAIL | round2-modules-results.json: PASS CRM opportunity create and update actions persist fields; round2-modules-results.json: FAIL CRM probability update rejects values above 100 percent |
| ACTION-0400 | CRM / Sales | actionConvertToCustomer | `src/app/crm/actions.ts:138` | PASS | round2-modules-results.json: PASS CRM customer conversion action is repeat-idempotent |
| ACTION-0401 | CRM / Sales | actionAddActivity | `src/app/crm/actions.ts:154` | PASS | round2-modules-results.json: PASS CRM activity create and completion actions persist |
| ACTION-0402 | CRM / Sales | actionCompleteActivity | `src/app/crm/actions.ts:170` | PASS | round2-modules-results.json: PASS CRM activity create and completion actions persist |
| ACTION-0403 | CRM / Sales | actionCreateContact | `src/app/crm/actions.ts:180` | PASS | round2-modules-results.json: PASS CRM contact action creates primary contact |
| ACTION-0404 | Demo / Tenancy | actionStartTestDrive | `src/app/demo-actions.ts:13` | PASS | demo-results.json: PASS Native demo Start -> server cookie -> ping -> end |
| ACTION-0405 | Demo / Tenancy | actionEnterExistingDemo | `src/app/demo-actions.ts:103` | UNTESTED | Not yet exercised |
| ACTION-0406 | Demo / Tenancy | actionEndTestDrive | `src/app/demo-actions.ts:129` | UNTESTED | Not yet exercised |
| ACTION-0407 | Docs | actionCreateDocSpace | `src/app/docs/actions.ts:20` | UNTESTED | Not yet exercised |
| ACTION-0408 | Docs | actionCreateDocPage | `src/app/docs/actions.ts:26` | UNTESTED | Not yet exercised |
| ACTION-0409 | Docs | actionSaveDocPage | `src/app/docs/actions.ts:33` | UNTESTED | Not yet exercised |
| ACTION-0410 | Docs | actionRestoreDocRevision | `src/app/docs/actions.ts:39` | UNTESTED | Not yet exercised |
| ACTION-0411 | Docs | actionSignDocRevision | `src/app/docs/actions.ts:42` | UNTESTED | Not yet exercised |
| ACTION-0412 | Docs | actionCommentOnDoc | `src/app/docs/actions.ts:45` | UNTESTED | Not yet exercised |
| ACTION-0413 | Docs | actionResolveDocComment | `src/app/docs/actions.ts:48` | UNTESTED | Not yet exercised |
| ACTION-0414 | Docs | actionLinkDocRecord | `src/app/docs/actions.ts:51` | UNTESTED | Not yet exercised |
| ACTION-0415 | Docs | actionUnlinkDocRecord | `src/app/docs/actions.ts:57` | UNTESTED | Not yet exercised |
| ACTION-0416 | Docs | actionSearchDocTargets | `src/app/docs/actions.ts:62` | UNTESTED | Not yet exercised |
| ACTION-0417 | Service / Assets | actionCreateVehicle | `src/app/fleet/actions.ts:30` | UNTESTED | Not yet exercised |
| ACTION-0418 | Service / Assets | actionUpdateVehicle | `src/app/fleet/actions.ts:55` | UNTESTED | Not yet exercised |
| ACTION-0419 | Service / Assets | actionAddMaintenance | `src/app/fleet/actions.ts:85` | UNTESTED | Not yet exercised |
| ACTION-0420 | Service / Assets | actionCompleteMaintenance | `src/app/fleet/actions.ts:103` | UNTESTED | Not yet exercised |
| ACTION-0421 | Service / Assets | actionAddFuel | `src/app/fleet/actions.ts:119` | UNTESTED | Not yet exercised |
| ACTION-0422 | Inventory / Kitting | actionQuarantineExpired | `src/app/inventory/expiring/actions.ts:7` | UNTESTED | Not yet exercised |
| ACTION-0423 | Shipping / Logistics | actionCreateCarrier | `src/app/logistics/actions.ts:30` | UNTESTED | Not yet exercised |
| ACTION-0424 | Shipping / Logistics | actionToggleCarrier | `src/app/logistics/actions.ts:46` | UNTESTED | Not yet exercised |
| ACTION-0425 | Shipping / Logistics | actionRecordFreight | `src/app/logistics/actions.ts:53` | UNTESTED | Not yet exercised |
| ACTION-0426 | Shipping / Logistics | actionAddLandedCost | `src/app/logistics/actions.ts:75` | UNTESTED | Not yet exercised |
| ACTION-0427 | Shipping / Logistics | actionApplyLandedCost | `src/app/logistics/actions.ts:93` | UNTESTED | Not yet exercised |
| ACTION-0428 | Shipping / Logistics | actionSetLineWeight | `src/app/logistics/actions.ts:103` | UNTESTED | Not yet exercised |
| ACTION-0429 | Service / Assets | actionCreateEquipment | `src/app/maintenance/actions.ts:32` | UNTESTED | Not yet exercised |
| ACTION-0430 | Service / Assets | actionUpdateEquipment | `src/app/maintenance/actions.ts:54` | UNTESTED | Not yet exercised |
| ACTION-0431 | Service / Assets | actionRecordMeter | `src/app/maintenance/actions.ts:80` | UNTESTED | Not yet exercised |
| ACTION-0432 | Service / Assets | actionAddMaintenance | `src/app/maintenance/actions.ts:95` | UNTESTED | Not yet exercised |
| ACTION-0433 | Service / Assets | actionCompleteMaintenance | `src/app/maintenance/actions.ts:113` | UNTESTED | Not yet exercised |
| ACTION-0434 | Service / Assets | actionStartDowntime | `src/app/maintenance/actions.ts:130` | UNTESTED | Not yet exercised |
| ACTION-0435 | Service / Assets | actionEndDowntime | `src/app/maintenance/actions.ts:144` | UNTESTED | Not yet exercised |
| ACTION-0436 | Billing / Founding | actionStartPublicCheckout | `src/app/pricing/actions.ts:23` | UNTESTED | Not yet exercised |
| ACTION-0437 | Platform / Other | actionBackfillStockSerials | `src/app/serial-backfill-actions.ts:6` | UNTESTED | Not yet exercised |
| ACTION-0438 | Platform / Other | actionIssueTopUnitSerial | `src/app/serial-wo-actions.ts:6` | UNTESTED | Not yet exercised |
| ACTION-0439 | Platform / Other | listTravelerSerialState | `src/app/serial-wo-actions.ts:37` | UNTESTED | Not yet exercised |
| ACTION-0440 | Service / Assets | actionCreateTicket | `src/app/service/actions.ts:35` | PASS | priority-results.json: PASS HTTP action create service ticket persists; round2-modules-results.json: PASS Service asset and ticket actions link customer-owned equipment; round2-modules-results.json: PASS Service blank title is rejected without ticket writes |
| ACTION-0441 | Service / Assets | actionUpdateTicketStatus | `src/app/service/actions.ts:55` | FAIL | round2-modules-results.json: FAIL Service reopening completed ticket clears closedAt; round2-modules-results.json: FAIL Service status action rejects unknown state |
| ACTION-0442 | Service / Assets | actionScheduleVisit | `src/app/service/actions.ts:65` | PASS | round2-modules-results.json: PASS Service dispatch and start actions move ticket into work |
| ACTION-0443 | Service / Assets | actionStartVisit | `src/app/service/actions.ts:81` | PASS | round2-modules-results.json: PASS Service dispatch and start actions move ticket into work |
| ACTION-0444 | Service / Assets | actionCompleteVisit | `src/app/service/actions.ts:95` | PASS | round2-modules-results.json: PASS Service completing last visit closes the job |
| ACTION-0445 | Service / Assets | actionAddLabor | `src/app/service/actions.ts:111` | PASS | round2-modules-results.json: PASS Service labor/parts actions reconcile billable total; round2-modules-results.json: PASS Service negative labor/part quantities leave no records |
| ACTION-0446 | Service / Assets | actionAddPartUsage | `src/app/service/actions.ts:127` | PASS | round2-modules-results.json: PASS Service labor/parts actions reconcile billable total; round2-modules-results.json: PASS Service negative labor/part quantities leave no records |
| ACTION-0447 | Service / Assets | actionRemoveLabor | `src/app/service/actions.ts:152` | PASS | round2-modules-results.json: PASS Service removal actions reconcile billable total to zero |
| ACTION-0448 | Service / Assets | actionRemovePartUsage | `src/app/service/actions.ts:159` | PASS | round2-modules-results.json: PASS Service removal actions reconcile billable total to zero |
| ACTION-0449 | Service / Assets | actionCreateInstalledAsset | `src/app/service/actions.ts:166` | PASS | round2-modules-results.json: PASS Service asset and ticket actions link customer-owned equipment |
| ACTION-0450 | Accounts / Roles | actionStartTrial | `src/app/signup/actions.ts:18` | UNTESTED | Not yet exercised |
| ACTION-0451 | Platform / Other | actionCreateSupportTicketResult | `src/app/support/actions.ts:99` | UNTESTED | Not yet exercised |
| ACTION-0452 | Platform / Other | actionFetchSupportThread | `src/app/support/actions.ts:177` | UNTESTED | Not yet exercised |
| ACTION-0453 | Platform / Other | actionPostSupportMessageResult | `src/app/support/actions.ts:260` | UNTESTED | Not yet exercised |
| ACTION-0454 | Platform / Other | actionCreateSupportTicket | `src/app/support/actions.ts:296` | UNTESTED | Not yet exercised |
| ACTION-0455 | Platform / Other | actionPostSupportMessage | `src/app/support/actions.ts:308` | UNTESTED | Not yet exercised |
| ACTION-0456 | Platform / Other | actionAddSupportNote | `src/app/support/actions.ts:345` | UNTESTED | Not yet exercised |
| ACTION-0457 | Platform / Other | actionUpdateSupportTicket | `src/app/support/actions.ts:366` | UNTESTED | Not yet exercised |
| ACTION-0458 | Platform / Other | actionSupportTyping | `src/app/support/actions.ts:395` | UNTESTED | Not yet exercised |
| ACTION-0459 | Platform / Other | actionTranslateText | `src/app/support/actions.ts:410` | UNTESTED | Not yet exercised |
| ACTION-0460 | Platform / Other | logAudit | `src/lib/audit.ts:32` | UNTESTED | Not yet exercised |
| ACTION-0461 | Platform / Other | getAuditTrail | `src/lib/audit.ts:81` | UNTESTED | Not yet exercised |
| ACTION-0462 | PLM / BOM / ECO | certifyBomForPrototype | `src/lib/services/bom.ts:12` | UNTESTED | Not yet exercised |
| ACTION-0463 | PLM / BOM / ECO | certifyBom | `src/lib/services/bom.ts:55` | UNTESTED | Not yet exercised |
| ACTION-0464 | PLM / BOM / ECO | createBomRevision | `src/lib/services/bom.ts:144` | PASS | BOM create revision / add line / compare / where-used |
| ACTION-0465 | PLM / BOM / ECO | compareBomRevisions | `src/lib/services/bom.ts:212` | PASS | BOM create revision / add line / compare / where-used |
| ACTION-0466 | PLM / BOM / ECO | whereUsed | `src/lib/services/bom.ts:258` | PASS | BOM create revision / add line / compare / where-used |
| ACTION-0467 | PLM / BOM / ECO | createOrLinkBom | `src/lib/services/bom.ts:269` | PASS | BOM create revision / add line / compare / where-used |
| ACTION-0468 | PLM / BOM / ECO | addBomLine | `src/lib/services/bom.ts:287` | PASS | BOM rejects self-reference and zero add quantity |
| ACTION-0469 | PLM / BOM / ECO | updateBomLine | `src/lib/services/bom.ts:344` | FAIL | BOM line UPDATE rejects negative quantity |
| ACTION-0470 | PLM / BOM / ECO | removeBomLine | `src/lib/services/bom.ts:370` | UNTESTED | Not yet exercised |
| ACTION-0471 | Planning / Scheduling | getCapacityAndWorkload | `src/lib/services/capacity.ts:160` | PASS | capacity getCapacityAndWorkload |
| ACTION-0472 | Planning / Scheduling | assignWorkCenterStaff | `src/lib/services/capacity.ts:485` | UNTESTED | Not yet exercised |
| ACTION-0473 | Planning / Scheduling | getActiveStaffAssignments | `src/lib/services/capacity.ts:536` | PASS | capacity getActiveStaffAssignments |
| ACTION-0474 | Planning / Scheduling | removeWorkCenterStaff | `src/lib/services/capacity.ts:559` | UNTESTED | Not yet exercised |
| ACTION-0475 | CRM / Sales | createCustomer | `src/lib/services/customers.ts:48` | UNTESTED | Not yet exercised |
| ACTION-0476 | CRM / Sales | updateCustomer | `src/lib/services/customers.ts:82` | UNTESTED | Not yet exercised |
| ACTION-0477 | Platform / Other | listGfpContracts | `src/lib/services/gfp.ts:8` | UNTESTED | Not yet exercised |
| ACTION-0478 | Platform / Other | listGfpByContract | `src/lib/services/gfp.ts:20` | UNTESTED | Not yet exercised |
| ACTION-0479 | Platform / Other | listMasterDd1149 | `src/lib/services/gfp.ts:49` | UNTESTED | Not yet exercised |
| ACTION-0480 | Platform / Other | attachGfpDocument | `src/lib/services/gfp.ts:62` | UNTESTED | Not yet exercised |
| ACTION-0481 | Platform / Other | setGfpAuditInterval | `src/lib/services/gfp.ts:104` | UNTESTED | Not yet exercised |
| ACTION-0482 | Platform / Other | completeGfpAudit | `src/lib/services/gfp.ts:159` | UNTESTED | Not yet exercised |
| ACTION-0483 | Platform / Other | checkoutGfp | `src/lib/services/gfp.ts:254` | UNTESTED | Not yet exercised |
| ACTION-0484 | Platform / Other | checkinGfp | `src/lib/services/gfp.ts:302` | UNTESTED | Not yet exercised |
| ACTION-0485 | Platform / Other | listGfpCheckoutHistory | `src/lib/services/gfp.ts:405` | UNTESTED | Not yet exercised |
| ACTION-0486 | Platform / Other | searchGfpItems | `src/lib/services/gfp.ts:454` | UNTESTED | Not yet exercised |
| ACTION-0487 | Platform / Other | requestGfpConsumption | `src/lib/services/gfp.ts:493` | UNTESTED | Not yet exercised |
| ACTION-0488 | Platform / Other | decideGfpConsumption | `src/lib/services/gfp.ts:539` | UNTESTED | Not yet exercised |
| ACTION-0489 | Platform / Other | listPendingGfpConsumptions | `src/lib/services/gfp.ts:613` | UNTESTED | Not yet exercised |
| ACTION-0490 | Platform / Other | listUpcomingGfpAudits | `src/lib/services/gfp.ts:625` | UNTESTED | Not yet exercised |
| ACTION-0491 | Planning / Scheduling | getPlanningExceptions | `src/lib/services/planning-exceptions.ts:32` | PASS | planning-exceptions getPlanningExceptions |
| ACTION-0492 | Planning / Scheduling | createForecast | `src/lib/services/planning.ts:43` | FAIL | Forecast rejects negative demand quantity |
| ACTION-0493 | Planning / Scheduling | getPartSupplySnapshot | `src/lib/services/planning.ts:88` | PASS | Supply snapshot and capable-to-promise |
| ACTION-0494 | Planning / Scheduling | generateMaterialRequisitionFromForecast | `src/lib/services/planning.ts:143` | UNTESTED | Not yet exercised |
| ACTION-0495 | Planning / Scheduling | supplyFor | `src/lib/services/planning.ts:185` | UNTESTED | Not yet exercised |
| ACTION-0496 | Planning / Scheduling | explode | `src/lib/services/planning.ts:196` | UNTESTED | Not yet exercised |
| ACTION-0497 | Planning / Scheduling | releaseMaterialRequisition | `src/lib/services/planning.ts:394` | UNTESTED | Not yet exercised |
| ACTION-0498 | Planning / Scheduling | updateMrsLine | `src/lib/services/planning.ts:678` | UNTESTED | Not yet exercised |
| ACTION-0499 | Planning / Scheduling | addMrsLine | `src/lib/services/planning.ts:750` | UNTESTED | Not yet exercised |
| ACTION-0500 | Planning / Scheduling | removeMrsLine | `src/lib/services/planning.ts:798` | UNTESTED | Not yet exercised |
| ACTION-0501 | Planning / Scheduling | updateForecast | `src/lib/services/planning.ts:827` | UNTESTED | Not yet exercised |
| ACTION-0502 | Planning / Scheduling | upsertForecastLine | `src/lib/services/planning.ts:870` | UNTESTED | Not yet exercised |
| ACTION-0503 | Planning / Scheduling | removeForecastLine | `src/lib/services/planning.ts:909` | UNTESTED | Not yet exercised |
| ACTION-0504 | Planning / Scheduling | assessCapableToPromise | `src/lib/services/planning.ts:954` | PASS | Supply snapshot and capable-to-promise |
| ACTION-0505 | Purchasing / Receiving | getDefaultApprovalPolicy | `src/lib/services/pr-approval.ts:28` | UNTESTED | Not yet exercised |
| ACTION-0506 | Purchasing / Receiving | listApprovalPolicies | `src/lib/services/pr-approval.ts:42` | UNTESTED | Not yet exercised |
| ACTION-0507 | Purchasing / Receiving | startPrApprovalWorkflow | `src/lib/services/pr-approval.ts:375` | UNTESTED | Not yet exercised |
| ACTION-0508 | Purchasing / Receiving | canUserApproveStep | `src/lib/services/pr-approval.ts:636` | PASS | priority-results.json: PASS PR denial wrong-person approval leaves pipeline unchanged |
| ACTION-0509 | Purchasing / Receiving | decidePrApproval | `src/lib/services/pr-approval.ts:690` | FAIL | priority-results.json: PASS PR denial wrong-person approval leaves pipeline unchanged; priority-results.json: FAIL Same admin cannot sign demand AND buyer on same PR; finance-supply-results.json: PASS PR routing, buyer action, final approval and PO conversion actions |
| ACTION-0510 | Purchasing / Receiving | getPrApprovals | `src/lib/services/pr-approval.ts:890` | UNTESTED | Not yet exercised |
| ACTION-0511 | Purchasing / Receiving | listPrApprovalsForUser | `src/lib/services/pr-approval.ts:903` | UNTESTED | Not yet exercised |
| ACTION-0512 | Purchasing / Receiving | countPrApprovalsForUser | `src/lib/services/pr-approval.ts:970` | UNTESTED | Not yet exercised |
| ACTION-0513 | Purchasing / Receiving | saveApprovalPolicy | `src/lib/services/pr-approval.ts:977` | UNTESTED | Not yet exercised |
| ACTION-0514 | Purchasing / Receiving | ensureDefaultPrApprovalPolicy | `src/lib/services/pr-approval.ts:1097` | UNTESTED | Not yet exercised |
| ACTION-0515 | Purchasing / Receiving | approvalActionLabel | `src/lib/services/pr-approval.ts:1141` | UNTESTED | Not yet exercised |
| ACTION-0516 | Purchasing / Receiving | saveReceivingDocuments | `src/lib/services/receiving-inspection.ts:39` | UNTESTED | Not yet exercised |
| ACTION-0517 | Purchasing / Receiving | routeReceivingLineForInspection | `src/lib/services/receiving-inspection.ts:81` | PASS | round2-quality-results.json: PASS QC flagged receipt routes to pending VISUAL/GDT with unavailable stock |
| ACTION-0518 | Purchasing / Receiving | spawnFunctionalReceivingInspection | `src/lib/services/receiving-inspection.ts:261` | PASS | round2-quality-results.json: PASS QC PASS actions create functional test only after both QA gates |
| ACTION-0519 | Purchasing / Receiving | attestDockAcceptance | `src/lib/services/receiving-inspection.ts:393` | UNTESTED | Not yet exercised |
| ACTION-0520 | Purchasing / Receiving | completeReceivingInspection | `src/lib/services/receiving-inspection.ts:462` | FAIL | round2-quality-results.json: PASS QC completion requires attached evidence and does not mutate on missing docs; round2-quality-results.json: PASS Functional PASS returns receiving traveler READY_TO_STOCK; round2-quality-results.json: PASS Repeated QC completion rejected without duplicate NCR/docs; round2-quality-results.json: PASS QC failure creates NCR/MRB and quarantines all affected material; round2-quality-results.json: FAIL Failed receiving NCR retains source supplier for scorecards |
| ACTION-0521 | Purchasing / Receiving | tryCompleteReceivingTestWo | `src/lib/services/receiving-inspection.ts:698` | UNTESTED | Not yet exercised |
| ACTION-0522 | Purchasing / Receiving | tryCompleteInventoryReceivingInspections | `src/lib/services/receiving-inspection.ts:762` | PASS | round2-quality-results.json: PASS QC PASS actions create functional test only after both QA gates |
| ACTION-0523 | Purchasing / Receiving | completeReceivingAfterInspection | `src/lib/services/receiving-inspection.ts:961` | PASS | round2-quality-results.json: PASS After-inspection putaway service releases stock and completes travelers |
| ACTION-0524 | Purchasing / Receiving | updatePartInspectionFlags | `src/lib/services/receiving-inspection.ts:1117` | UNTESTED | Not yet exercised |
| ACTION-0525 | Purchasing / Receiving | listOpenTestInspections | `src/lib/services/receiving-inspection.ts:1145` | UNTESTED | Not yet exercised |
| ACTION-0526 | Purchasing / Receiving | parseTravelerSnapshot | `src/lib/services/receiving.ts:17` | UNTESTED | Not yet exercised |
| ACTION-0527 | Purchasing / Receiving | travelerPurpose | `src/lib/services/receiving.ts:38` | UNTESTED | Not yet exercised |
| ACTION-0528 | Purchasing / Receiving | reconcileRootTravelerStatus | `src/lib/services/receiving.ts:65` | UNTESTED | Not yet exercised |
| ACTION-0529 | Purchasing / Receiving | nextChildTravelerNumber | `src/lib/services/receiving.ts:162` | UNTESTED | Not yet exercised |
| ACTION-0530 | Purchasing / Receiving | createReceivingTravelerForPo | `src/lib/services/receiving.ts:211` | UNTESTED | Not yet exercised |
| ACTION-0531 | Purchasing / Receiving | createCustomerGfpTraveler | `src/lib/services/receiving.ts:283` | UNTESTED | Not yet exercised |
| ACTION-0532 | Purchasing / Receiving | syncReceivingTravelerStatus | `src/lib/services/receiving.ts:361` | UNTESTED | Not yet exercised |
| ACTION-0533 | Purchasing / Receiving | splitTravelerAfterReceive | `src/lib/services/receiving.ts:443` | UNTESTED | Not yet exercised |
| ACTION-0534 | Purchasing / Receiving | closePurchaseOrderFromReceiving | `src/lib/services/receiving.ts:1132` | UNTESTED | Not yet exercised |
| ACTION-0535 | Purchasing / Receiving | closeGfpTraveler | `src/lib/services/receiving.ts:1191` | UNTESTED | Not yet exercised |
| ACTION-0536 | Purchasing / Receiving | receivePurchaseOrder | `src/lib/services/supply-chain.ts:27` | FAIL | finance-supply-results.json: PASS Receiving overquantity fails without receipts or inventory changes; round2-quality-results.json: PASS QC flagged receipt routes to pending VISUAL/GDT with unavailable stock; round2-quality-results.json: FAIL Serialized receiving rejects missing serials before receipt writes; round2-quality-results.json: FAIL Serialized receiving rejects count mismatch serials before receipt writes; round2-quality-results.json: FAIL Serialized receiving rejects duplicate serials before receipt writes; round2-quality-results.json: FAIL Valid received serials become selectable stock serial identities |
| ACTION-0537 | Purchasing / Receiving | receiveGfpTraveler | `src/lib/services/supply-chain.ts:755` | UNTESTED | Not yet exercised |
| ACTION-0538 | Purchasing / Receiving | createNcrAndMrbFromInspection | `src/lib/services/supply-chain.ts:1145` | PASS | round2-quality-results.json: PASS QC failure creates NCR/MRB and quarantines all affected material |
| ACTION-0539 | Purchasing / Receiving | closeMrbCase | `src/lib/services/supply-chain.ts:1250` | PASS | round2-quality-results.json: PASS Open MRB cannot close before disposition; round2-quality-results.json: PASS MRB USE_AS_IS action releases quarantine and close action finalizes |
| ACTION-0540 | Purchasing / Receiving | dispositionMrb | `src/lib/services/supply-chain.ts:1277` | FAIL | scripts/verify/chunk-serials-rma.ts; scenario only; round2-quality-results.json: PASS MRB USE_AS_IS action releases quarantine and close action finalizes; round2-quality-results.json: FAIL MRB partial SCRAP preserves remainder quantity; round2-quality-results.json: FAIL MRB rejects negative disposition quantity before writing; round2-quality-results.json: FAIL Repeated MRB disposition cannot create duplicate decisions/postings |
| ACTION-0541 | Purchasing / Receiving | logCarActivity | `src/lib/services/supply-chain.ts:1612` | UNTESTED | Not yet exercised |
| ACTION-0542 | Purchasing / Receiving | updateCar | `src/lib/services/supply-chain.ts:1636` | UNTESTED | Not yet exercised |
| ACTION-0543 | Purchasing / Receiving | listOpenCars | `src/lib/services/supply-chain.ts:1786` | UNTESTED | Not yet exercised |
| ACTION-0544 | Purchasing / Receiving | updateSupplierScorecard | `src/lib/services/supply-chain.ts:1804` | UNTESTED | Not yet exercised |
| ACTION-0545 | Purchasing / Receiving | getValueStreamMetrics | `src/lib/services/supply-chain.ts:1901` | UNTESTED | Not yet exercised |
| ACTION-0546 | Purchasing / Receiving | capStatus | `src/lib/services/supply-chain.ts:1974` | UNTESTED | Not yet exercised |
| ACTION-0547 | Purchasing / Receiving | maxUtil | `src/lib/services/supply-chain.ts:1982` | UNTESTED | Not yet exercised |
| ACTION-0548 | Manufacturing / Test | getTestCenterQueue | `src/lib/services/test-center.ts:193` | UNTESTED | Not yet exercised |
| ACTION-0549 | Manufacturing / Test | getQaInspectionQueue | `src/lib/services/test-center.ts:463` | UNTESTED | Not yet exercised |
| ACTION-0550 | Inventory / Kitting | listUomUnits | `src/lib/services/uom.ts:6` | UNTESTED | Not yet exercised |
| ACTION-0551 | Inventory / Kitting | saveUomUnit | `src/lib/services/uom.ts:17` | UNTESTED | Not yet exercised |
| ACTION-0552 | Inventory / Kitting | saveUomConversion | `src/lib/services/uom.ts:60` | UNTESTED | Not yet exercised |
| ACTION-0553 | Inventory / Kitting | convertQty | `src/lib/services/uom.ts:113` | UNTESTED | Not yet exercised |
| ACTION-0554 | Service / Assets | listVirtualAssets | `src/lib/services/virtual-assets.ts:6` | UNTESTED | Not yet exercised |
| ACTION-0555 | Service / Assets | createVirtualAsset | `src/lib/services/virtual-assets.ts:50` | UNTESTED | Not yet exercised |
| ACTION-0556 | Service / Assets | assignVirtualAsset | `src/lib/services/virtual-assets.ts:104` | UNTESTED | Not yet exercised |
| ACTION-0557 | Service / Assets | unassignVirtualAsset | `src/lib/services/virtual-assets.ts:149` | UNTESTED | Not yet exercised |
| ACTION-0558 | Service / Assets | checkoutVirtualAsset | `src/lib/services/virtual-assets.ts:194` | UNTESTED | Not yet exercised |
| ACTION-0559 | Service / Assets | returnVirtualAsset | `src/lib/services/virtual-assets.ts:235` | UNTESTED | Not yet exercised |
| ACTION-0560 | Manufacturing / Test | listWorkCenters | `src/lib/services/workcenters.ts:7` | UNTESTED | Not yet exercised |
| ACTION-0561 | Manufacturing / Test | getDefaultWorkCenter | `src/lib/services/workcenters.ts:20` | UNTESTED | Not yet exercised |
| ACTION-0562 | Manufacturing / Test | getWorkCenterByCode | `src/lib/services/workcenters.ts:32` | UNTESTED | Not yet exercised |
| ACTION-0563 | Manufacturing / Test | resolveStepStation | `src/lib/services/workcenters.ts:43` | UNTESTED | Not yet exercised |
| ACTION-0564 | Manufacturing / Test | saveWorkCenter | `src/lib/services/workcenters.ts:86` | UNTESTED | Not yet exercised |
| ACTION-0565 | Manufacturing / Test | reassignWorkOrderStation | `src/lib/services/workcenters.ts:157` | UNTESTED | Not yet exercised |
| ACTION-0566 | Manufacturing / Test | reassignStepStation | `src/lib/services/workcenters.ts:225` | UNTESTED | Not yet exercised |
| ACTION-0567 | Manufacturing / Test | seedStepAssignments | `src/lib/services/workcenters.ts:292` | UNTESTED | Not yet exercised |
| ACTION-0568 | Manufacturing / Test | listWorkCenterCodesByArea | `src/lib/services/workcenters.ts:315` | UNTESTED | Not yet exercised |

### API checklist

| ID | Module | Function / route / model | Source | Status | Evidence / next step |
|---|---|---|---|---|---|
| API-0001 | Accounting / GovCon | GET /accounting/export | `src/app/accounting/export/route.ts:22` | PASS | API /accounting/export?report=pl; tested request only |
| API-0002 | Demo / Tenancy | GET /api/cron/drop-orphan-demos | `src/app/api/cron/drop-orphan-demos/route.ts:22` | UNTESTED | Not yet exercised |
| API-0003 | Demo / Tenancy | GET /api/cron/sweep-demos | `src/app/api/cron/sweep-demos/route.ts:19` | UNTESTED | Not yet exercised |
| API-0004 | Demo / Tenancy | GET /api/demo/end | `src/app/api/demo/end/route.ts:11` | PASS | demo-results.json: PASS Native demo Start -> server cookie -> ping -> end |
| API-0005 | Demo / Tenancy | POST /api/demo/end | `src/app/api/demo/end/route.ts:59` | UNTESTED | Not yet exercised |
| API-0006 | Demo / Tenancy | POST /api/demo/leave | `src/app/api/demo/leave/route.ts:9` | PASS | round2-demo-results.json: PASS Native demo leave clears cookie and destroys only its sandbox |
| API-0007 | Demo / Tenancy | GET /api/demo/leave | `src/app/api/demo/leave/route.ts:24` | UNTESTED | Not yet exercised |
| API-0008 | Demo / Tenancy | POST /api/demo/ping | `src/app/api/demo/ping/route.ts:6` | PASS | demo-results.json: PASS Native demo Start -> server cookie -> ping -> end |
| API-0009 | Demo / Tenancy | GET /api/demo/ping | `src/app/api/demo/ping/route.ts:16` | UNTESTED | Not yet exercised |
| API-0010 | Demo / Tenancy | GET /api/demo/reset | `src/app/api/demo/reset/route.ts:10` | PASS | round2-demo-results.json: PASS Native demo reset clears cookie and destroys only its sandbox |
| API-0011 | Platform / Other | POST /api/esd/humidity | `src/app/api/esd/humidity/route.ts:20` | UNTESTED | Not yet exercised |
| API-0012 | Reports | GET /api/export | `src/app/api/export/route.ts:19` | PASS | API /api/export?entity=parts; tested request only |
| API-0013 | Platform / Other | GET /api/geocode | `src/app/api/geocode/route.ts:23` | UNTESTED | Not yet exercised |
| API-0014 | Platform / Other | GET /api/health | `src/app/api/health/route.ts:12` | PASS | API /api/health; tested request only |
| API-0015 | Platform / Other | POST /api/leads | `src/app/api/leads/route.ts:6` | UNTESTED | Not yet exercised |
| API-0016 | Platform / Other | GET /api/plaid/link-src | `src/app/api/plaid/link-src/route.ts:24` | UNTESTED | Not yet exercised |
| API-0017 | Quality / NCR | GET /api/quality/tools/[id]/dxf | `src/app/api/quality/tools/[id]/dxf/route.ts:9` | UNTESTED | Not yet exercised |
| API-0018 | Platform / Other | GET /api/search | `src/app/api/search/route.ts:19` | PASS | API /api/search?q=QA; tested request only |
| API-0019 | Platform / Other | GET /api/staff/enter | `src/app/api/staff/enter/route.ts:25` | UNTESTED | Not yet exercised |
| API-0020 | Billing / Founding | POST /api/stripe/webhook | `src/app/api/stripe/webhook/route.ts:12` | PASS | Invalid Stripe signature rejected; tested request only |
| API-0021 | Platform / Other | POST /api/telemetry | `src/app/api/telemetry/route.ts:20` | UNTESTED | Not yet exercised |
| API-0022 | Platform / Other | POST /api/tts | `src/app/api/tts/route.ts:15` | UNTESTED | Not yet exercised |
| API-0023 | Reports | GET /reports/builder/export | `src/app/reports/builder/export/route.ts:8` | PASS | API /reports/builder/export?entity=items&cols=partNumber&cols=description; tested request only |
| API-0024 | Reports | GET /reports/export | `src/app/reports/export/route.ts:7` | PASS | API /reports/export?key=inventory; tested request only |
| API-0025 | Platform / Other | POST /api/e | `src/app/api/e/route.ts:15` | UNTESTED | Alias of telemetry POST; explicit re-export |

### SERVICE checklist

| ID | Module | Function / route / model | Source | Status | Evidence / next step |
|---|---|---|---|---|---|
| SERVICE-0001 | Platform / Other | Analytics | `src/lib/airgap-stubs/analytics.tsx:10` | UNTESTED | Not yet exercised |
| SERVICE-0002 | Platform / Other | airgapEnabled | `src/lib/airgap.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0003 | Platform / Other | conflictingIntegrations | `src/lib/airgap.ts:45` | UNTESTED | Not yet exercised |
| SERVICE-0004 | Platform / Other | geocodingEnabled | `src/lib/airgap.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0005 | Platform / Other | analyticsEnabled | `src/lib/airgap.ts:70` | UNTESTED | Not yet exercised |
| SERVICE-0006 | Accounts / Roles | requireApiUser | `src/lib/api-auth.ts:10` | UNTESTED | Not yet exercised |
| SERVICE-0007 | Accounts / Roles | unauthorized | `src/lib/api-auth.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0008 | Accounts / Roles | forbidden | `src/lib/api-auth.ts:26` | UNTESTED | Not yet exercised |
| SERVICE-0009 | Accounts / Roles | requireApiPermission | `src/lib/api-auth.ts:30` | UNTESTED | Not yet exercised |
| SERVICE-0010 | Accounts / Roles | sessionIdleMinutes | `src/lib/auth-core.ts:47` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0011 | Accounts / Roles | lastSeenRefreshMs | `src/lib/auth-core.ts:70` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0012 | Accounts / Roles | demoModeEnabled | `src/lib/auth-core.ts:76` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0013 | Accounts / Roles | assertLoginNotRateLimited | `src/lib/auth-core.ts:91` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0014 | Accounts / Roles | recordLoginFailure | `src/lib/auth-core.ts:108` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0015 | Accounts / Roles | clearLoginFailures | `src/lib/auth-core.ts:119` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0016 | Accounts / Roles | hashPassword | `src/lib/auth-core.ts:125` | UNTESTED | Not yet exercised |
| SERVICE-0017 | Accounts / Roles | verifyPassword | `src/lib/auth-core.ts:131` | PASS | round2-auth-results.json: PASS Real password login/session identifies ADMIN; round2-auth-results.json: PASS Real password login/session identifies OPERATOR; round2-auth-results.json: PASS Real password login/session identifies QUALITY; round2-auth-results.json: PASS Real password login/session identifies ACCOUNTING; round2-auth-results.json: PASS Real password login/session identifies PURCHASING; round2-auth-results.json: PASS Real password login/session identifies EXECUTIVE |
| SERVICE-0018 | Accounts / Roles | assertPasswordStrength | `src/lib/auth-core.ts:189` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0019 | Accounts / Roles | createSession | `src/lib/auth-core.ts:261` | UNTESTED | Not yet exercised |
| SERVICE-0020 | Accounts / Roles | createTenantSession | `src/lib/auth-core.ts:266` | UNTESTED | Not yet exercised |
| SERVICE-0021 | Accounts / Roles | getSessionUser | `src/lib/auth-core.ts:278` | PASS | round2-auth-results.json: PASS Real password login/session identifies ADMIN; round2-auth-results.json: PASS Real password login/session identifies OPERATOR; round2-auth-results.json: PASS Real password login/session identifies QUALITY; round2-auth-results.json: PASS Real password login/session identifies ACCOUNTING; round2-auth-results.json: PASS Real password login/session identifies PURCHASING; round2-auth-results.json: PASS Real password login/session identifies EXECUTIVE |
| SERVICE-0022 | Accounts / Roles | destroySession | `src/lib/auth-core.ts:322` | UNTESTED | Not yet exercised |
| SERVICE-0023 | Accounts / Roles | loginWithPassword | `src/lib/auth-core.ts:342` | PASS | round2-auth-results.json: PASS Real password login/session identifies ADMIN; round2-auth-results.json: PASS Real password login/session identifies OPERATOR; round2-auth-results.json: PASS Real password login/session identifies QUALITY; round2-auth-results.json: PASS Real password login/session identifies ACCOUNTING; round2-auth-results.json: PASS Real password login/session identifies PURCHASING; round2-auth-results.json: PASS Real password login/session identifies EXECUTIVE |
| SERVICE-0024 | Accounts / Roles | completeMfaLogin | `src/lib/auth-core.ts:453` | UNTESTED | Not yet exercised |
| SERVICE-0025 | Accounts / Roles | hasPendingMfa | `src/lib/auth-core.ts:470` | UNTESTED | Not yet exercised |
| SERVICE-0026 | Accounts / Roles | cancelMfaLogin | `src/lib/auth-core.ts:476` | UNTESTED | Not yet exercised |
| SERVICE-0027 | Accounts / Roles | needsBootstrap | `src/lib/auth-core.ts:497` | UNTESTED | Not yet exercised |
| SERVICE-0028 | Accounts / Roles | bootstrapFirstAdmin | `src/lib/auth-core.ts:518` | UNTESTED | Not yet exercised |
| SERVICE-0029 | Accounts / Roles | claimTenant | `src/lib/auth-core.ts:565` | UNTESTED | Not yet exercised |
| SERVICE-0030 | Accounts / Roles | createInvite | `src/lib/auth-core.ts:606` | UNTESTED | Not yet exercised |
| SERVICE-0031 | Accounts / Roles | getInviteByToken | `src/lib/auth-core.ts:736` | UNTESTED | Not yet exercised |
| SERVICE-0032 | Accounts / Roles | acceptInvite | `src/lib/auth-core.ts:754` | UNTESTED | Not yet exercised |
| SERVICE-0033 | Accounts / Roles | changePassword | `src/lib/auth-core.ts:827` | UNTESTED | Not yet exercised |
| SERVICE-0034 | Accounts / Roles | getCurrentUser | `src/lib/auth.ts:17` | UNTESTED | Not yet exercised |
| SERVICE-0035 | Accounts / Roles | getUserById | `src/lib/auth.ts:100` | UNTESTED | Not yet exercised |
| SERVICE-0036 | Accounts / Roles | listUsers | `src/lib/auth.ts:104` | UNTESTED | Not yet exercised |
| SERVICE-0037 | Accounts / Roles | canAccess | `src/lib/auth.ts:284` | UNTESTED | Not yet exercised |
| SERVICE-0038 | Accounts / Roles | userHasPermission | `src/lib/auth.ts:387` | PASS | scripts/verify/chunk-h-hr.ts; scenario only |
| SERVICE-0039 | Accounts / Roles | userCanView | `src/lib/auth.ts:544` | UNTESTED | Not yet exercised |
| SERVICE-0040 | Accounts / Roles | userCanSeeFinancials | `src/lib/auth.ts:555` | UNTESTED | Not yet exercised |
| SERVICE-0041 | Accounts / Roles | requireUser | `src/lib/auth.ts:562` | UNTESTED | Not yet exercised |
| SERVICE-0042 | Accounts / Roles | requirePermission | `src/lib/auth.ts:575` | UNTESTED | Not yet exercised |
| SERVICE-0043 | Platform / Other | code39Bars | `src/lib/barcode.ts:64` | UNTESTED | Not yet exercised |
| SERVICE-0044 | Platform / Other | carinaAudioGen | `src/lib/carina-audio.ts:10` | UNTESTED | Not yet exercised |
| SERVICE-0045 | Platform / Other | carinaBumpAudioGen | `src/lib/carina-audio.ts:14` | UNTESTED | Not yet exercised |
| SERVICE-0046 | Platform / Other | carinaIsAudioCurrent | `src/lib/carina-audio.ts:19` | UNTESTED | Not yet exercised |
| SERVICE-0047 | Platform / Other | carinaIsSpeaking | `src/lib/carina-audio.ts:23` | UNTESTED | Not yet exercised |
| SERVICE-0048 | Platform / Other | carinaStopAllAudio | `src/lib/carina-audio.ts:27` | UNTESTED | Not yet exercised |
| SERVICE-0049 | Platform / Other | carinaPlaySpeech | `src/lib/carina-audio.ts:52` | UNTESTED | Not yet exercised |
| SERVICE-0050 | Platform / Other | getCatalogAnchor | `src/lib/carina-catalog.ts:753` | UNTESTED | Not yet exercised |
| SERVICE-0051 | Platform / Other | listCatalogForPrompt | `src/lib/carina-catalog.ts:757` | UNTESTED | Not yet exercised |
| SERVICE-0052 | Platform / Other | scoreCatalogMatch | `src/lib/carina-catalog.ts:804` | UNTESTED | Not yet exercised |
| SERVICE-0053 | Platform / Other | wantsPointOnly | `src/lib/carina-catalog.ts:845` | UNTESTED | Not yet exercised |
| SERVICE-0054 | Platform / Other | bestPointAnchor | `src/lib/carina-catalog.ts:852` | UNTESTED | Not yet exercised |
| SERVICE-0055 | Platform / Other | inventStepsFromCatalog | `src/lib/carina-catalog.ts:861` | UNTESTED | Not yet exercised |
| SERVICE-0056 | Platform / Other | resolveAnchorIds | `src/lib/carina-catalog.ts:904` | UNTESTED | Not yet exercised |
| SERVICE-0057 | Platform / Other | anchorsToTourSteps | `src/lib/carina-catalog.ts:919` | UNTESTED | Not yet exercised |
| SERVICE-0058 | Platform / Other | resolveLang | `src/lib/carina-language.ts:53` | UNTESTED | Not yet exercised |
| SERVICE-0059 | Platform / Other | loadStoredLang | `src/lib/carina-language.ts:68` | UNTESTED | Not yet exercised |
| SERVICE-0060 | Platform / Other | storeLang | `src/lib/carina-language.ts:77` | UNTESTED | Not yet exercised |
| SERVICE-0061 | Platform / Other | detectLanguageSwitch | `src/lib/carina-language.ts:90` | UNTESTED | Not yet exercised |
| SERVICE-0062 | Platform / Other | ttsLanguageCode | `src/lib/carina-language.ts:134` | UNTESTED | Not yet exercised |
| SERVICE-0063 | Platform / Other | enableCarinaVoiceEvent | `src/lib/carina-voice-bus.ts:9` | UNTESTED | Not yet exercised |
| SERVICE-0064 | Platform / Other | stopCarinaVoiceEvent | `src/lib/carina-voice-bus.ts:13` | UNTESTED | Not yet exercised |
| SERVICE-0065 | Platform / Other | carinaListenChangedEvent | `src/lib/carina-voice-bus.ts:17` | UNTESTED | Not yet exercised |
| SERVICE-0066 | Platform / Other | carinaRecAliveEvent | `src/lib/carina-voice-bus.ts:26` | UNTESTED | Not yet exercised |
| SERVICE-0067 | Platform / Other | persistWantListen | `src/lib/carina-voice-bus.ts:32` | UNTESTED | Not yet exercised |
| SERVICE-0068 | Platform / Other | readWantListen | `src/lib/carina-voice-bus.ts:44` | UNTESTED | Not yet exercised |
| SERVICE-0069 | Platform / Other | carinaPointEvent | `src/lib/carina-voice-bus.ts:53` | UNTESTED | Not yet exercised |
| SERVICE-0070 | Platform / Other | comparePageMetadata | `src/lib/compare/metadata.ts:5` | UNTESTED | Not yet exercised |
| SERVICE-0071 | Platform / Other | classifyHref | `src/lib/compare/model.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0072 | Platform / Other | externalLinkAttrs | `src/lib/compare/model.ts:48` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0073 | Platform / Other | parseCompareDocument | `src/lib/compare/model.ts:132` | UNTESTED | Not yet exercised |
| SERVICE-0074 | Platform / Other | inlineToText | `src/lib/compare/model.ts:175` | UNTESTED | Not yet exercised |
| SERVICE-0075 | Platform / Other | visibleText | `src/lib/compare/model.ts:185` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0076 | Platform / Other | faqEntries | `src/lib/compare/model.ts:224` | UNTESTED | Not yet exercised |
| SERVICE-0077 | Platform / Other | faqPageJsonLd | `src/lib/compare/model.ts:231` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0078 | Platform / Other | walkLinks | `src/lib/compare/model.ts:246` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0079 | Platform / Other | demoCta | `src/lib/compare/model.ts:268` | UNTESTED | Not yet exercised |
| SERVICE-0080 | Platform / Other | subsectionLabel | `src/lib/compare/model.ts:281` | UNTESTED | Not yet exercised |
| SERVICE-0081 | Platform / Other | headingId | `src/lib/compare/model.ts:291` | UNTESTED | Not yet exercised |
| SERVICE-0082 | Platform / Other | getComparePage | `src/lib/compare/pages.ts:37` | UNTESTED | Not yet exercised |
| SERVICE-0083 | Platform / Other | requireComparePage | `src/lib/compare/pages.ts:42` | UNTESTED | Not yet exercised |
| SERVICE-0084 | Platform / Other | prepareComparePage | `src/lib/compare/pages.ts:54` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0085 | Billing / Founding | pricingTableCell | `src/lib/compare/pricing-copy.ts:41` | UNTESTED | Not yet exercised |
| SERVICE-0086 | Billing / Founding | pricingSetupSentence | `src/lib/compare/pricing-copy.ts:51` | UNTESTED | Not yet exercised |
| SERVICE-0087 | Billing / Founding | pricingFaqLead | `src/lib/compare/pricing-copy.ts:64` | UNTESTED | Not yet exercised |
| SERVICE-0088 | Billing / Founding | materializeCompareCopy | `src/lib/compare/pricing-copy.ts:74` | UNTESTED | Not yet exercised |
| SERVICE-0089 | Platform / Other | fireConfetti | `src/lib/confetti.ts:6` | UNTESTED | Not yet exercised |
| SERVICE-0090 | Platform / Other | frame | `src/lib/confetti.ts:49` | UNTESTED | Not yet exercised |
| SERVICE-0091 | Platform / Other | clientForSchema | `src/lib/db.ts:73` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0092 | Platform / Other | isValidSchemaName | `src/lib/db.ts:86` | UNTESTED | Not yet exercised |
| SERVICE-0093 | Platform / Other | controlPlaneClient | `src/lib/db.ts:97` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0094 | Platform / Other | currentRequestSchema | `src/lib/db.ts:157` | UNTESTED | Not yet exercised |
| SERVICE-0095 | Platform / Other | sandboxDir | `src/lib/db.ts:202` | UNTESTED | Not yet exercised |
| SERVICE-0096 | Platform / Other | sandboxDbPath | `src/lib/db.ts:206` | UNTESTED | Not yet exercised |
| SERVICE-0097 | Platform / Other | materializeSandbox | `src/lib/db.ts:210` | UNTESTED | Not yet exercised |
| SERVICE-0098 | Platform / Other | destroySandbox | `src/lib/db.ts:216` | UNTESTED | Not yet exercised |
| SERVICE-0099 | Demo / Tenancy | isAnonymousDemoRequest | `src/lib/demo-request.ts:8` | UNTESTED | Not yet exercised |
| SERVICE-0100 | Docs | safeDocHref | `src/lib/docs/content.ts:13` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0101 | Docs | parseDocContent | `src/lib/docs/content.ts:24` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0102 | Docs | clean | `src/lib/docs/content.ts:29` | UNTESTED | Not yet exercised |
| SERVICE-0103 | Docs | docText | `src/lib/docs/content.ts:46` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0104 | Docs | templateContent | `src/lib/docs/content.ts:62` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0105 | Docs | diffDocLines | `src/lib/docs/content.ts:68` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0106 | Platform / Other | toolLabelDxf | `src/lib/dxf.ts:27` | UNTESTED | Not yet exercised |
| SERVICE-0107 | Platform / Other | holidayDate | `src/lib/federal-holidays.ts:62` | UNTESTED | Not yet exercised |
| SERVICE-0108 | Platform / Other | computeObservedHolidays | `src/lib/federal-holidays.ts:70` | UNTESTED | Not yet exercised |
| SERVICE-0109 | Platform / Other | flashToast | `src/lib/flash.ts:16` | UNTESTED | Not yet exercised |
| SERVICE-0110 | Platform / Other | readFlashToast | `src/lib/flash.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0111 | Platform / Other | getTour | `src/lib/guides.ts:812` | UNTESTED | Not yet exercised |
| SERVICE-0112 | Platform / Other | listToursForAi | `src/lib/guides.ts:817` | UNTESTED | Not yet exercised |
| SERVICE-0113 | Platform / Other | matchTourFromQuery | `src/lib/guides.ts:835` | UNTESTED | Not yet exercised |
| SERVICE-0114 | Platform / Other | getLegalDoc | `src/lib/legal-content.ts:293` | UNTESTED | Not yet exercised |
| SERVICE-0115 | Platform / Other | moduleKeyForPath | `src/lib/modules.ts:161` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0116 | Platform / Other | isPathEnabled | `src/lib/modules.ts:178` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0117 | Platform / Other | moduleLabel | `src/lib/modules.ts:183` | UNTESTED | Not yet exercised |
| SERVICE-0118 | Platform / Other | activeNavHref | `src/lib/navigation.ts:220` | UNTESTED | Not yet exercised |
| SERVICE-0119 | Platform / Other | createBrandedPdf | `src/lib/pdf.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0120 | Platform / Other | generateWorkOrderTravelerPdf | `src/lib/pdf.ts:77` | UNTESTED | Not yet exercised |
| SERVICE-0121 | Platform / Other | generatePurchaseOrderPdf | `src/lib/pdf.ts:138` | UNTESTED | Not yet exercised |
| SERVICE-0122 | Admin / Settings | isPlatformContext | `src/lib/platform.ts:13` | UNTESTED | Not yet exercised |
| SERVICE-0123 | Admin / Settings | isPlatformSupportEnabled | `src/lib/platform.ts:21` | UNTESTED | Not yet exercised |
| SERVICE-0124 | Platform / Other | workOrderHoldProvenance | `src/lib/provenance.ts:12` | UNTESTED | Not yet exercised |
| SERVICE-0125 | Platform / Other | workOrderMrbProvenance | `src/lib/provenance.ts:30` | UNTESTED | Not yet exercised |
| SERVICE-0126 | Platform / Other | workOrderQrPayload | `src/lib/qr.ts:7` | UNTESTED | Not yet exercised |
| SERVICE-0127 | Platform / Other | generateQrDataUrl | `src/lib/qr.ts:20` | UNTESTED | Not yet exercised |
| SERVICE-0128 | Platform / Other | generateQrSvg | `src/lib/qr.ts:33` | UNTESTED | Not yet exercised |
| SERVICE-0129 | Platform / Other | redactSecrets | `src/lib/redact-secrets.ts:18` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0130 | Platform / Other | redactError | `src/lib/redact-secrets.ts:30` | UNTESTED | Not yet exercised |
| SERVICE-0131 | Platform / Other | requestAppUrl | `src/lib/request-app-url.ts:8` | UNTESTED | Not yet exercised |
| SERVICE-0132 | Platform / Other | publicOriginFromRequest | `src/lib/request-origin.ts:7` | UNTESTED | Not yet exercised |
| SERVICE-0133 | Platform / Other | publicUrlFromRequest | `src/lib/request-origin.ts:43` | UNTESTED | Not yet exercised |
| SERVICE-0134 | Accounting / GovCon | get1099Report | `src/lib/services/accounting-reports.ts:16` | PASS | accounting-reports get1099Report |
| SERVICE-0135 | Accounting / GovCon | setSupplier1099 | `src/lib/services/accounting-reports.ts:67` | UNTESTED | Not yet exercised |
| SERVICE-0136 | Accounting / GovCon | getBudgetVsActual | `src/lib/services/accounting-reports.ts:94` | PASS | accounting-reports getBudgetVsActual |
| SERVICE-0137 | Platform / Other | clockOutAllActiveWork | `src/lib/services/active-work.ts:13` | UNTESTED | Not yet exercised |
| SERVICE-0138 | Platform / Other | looksLikeErpTopic | `src/lib/services/ai.ts:53` | UNTESTED | Not yet exercised |
| SERVICE-0139 | Platform / Other | getAiContextSummary | `src/lib/services/ai.ts:87` | UNTESTED | Not yet exercised |
| SERVICE-0140 | Platform / Other | processAiQuery | `src/lib/services/ai.ts:125` | UNTESTED | Not yet exercised |
| SERVICE-0141 | Platform / Other | processAiConversation | `src/lib/services/ai.ts:415` | UNTESTED | Not yet exercised |
| SERVICE-0142 | Purchasing / Receiving | getAslPolicy | `src/lib/services/asl.ts:13` | UNTESTED | Not yet exercised |
| SERVICE-0143 | Purchasing / Receiving | updateAslPolicy | `src/lib/services/asl.ts:21` | UNTESTED | Not yet exercised |
| SERVICE-0144 | Purchasing / Receiving | certIsValid | `src/lib/services/asl.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0145 | Purchasing / Receiving | supplierMeetsCertPolicy | `src/lib/services/asl.ts:74` | UNTESTED | Not yet exercised |
| SERVICE-0146 | Purchasing / Receiving | setSupplierAsl | `src/lib/services/asl.ts:107` | UNTESTED | Not yet exercised |
| SERVICE-0147 | Purchasing / Receiving | upsertSupplierCertification | `src/lib/services/asl.ts:191` | UNTESTED | Not yet exercised |
| SERVICE-0148 | Purchasing / Receiving | deleteSupplierCertification | `src/lib/services/asl.ts:240` | UNTESTED | Not yet exercised |
| SERVICE-0149 | Purchasing / Receiving | refreshCertStatuses | `src/lib/services/asl.ts:257` | UNTESTED | Not yet exercised |
| SERVICE-0150 | Service / Assets | createAsset | `src/lib/services/assets.ts:10` | UNTESTED | Not yet exercised |
| SERVICE-0151 | Service / Assets | checkoutAsset | `src/lib/services/assets.ts:46` | UNTESTED | Not yet exercised |
| SERVICE-0152 | Service / Assets | checkinAsset | `src/lib/services/assets.ts:101` | UNTESTED | Not yet exercised |
| SERVICE-0153 | Service / Assets | getAssetsOverview | `src/lib/services/assets.ts:135` | PASS | assets getAssetsOverview |
| SERVICE-0154 | Quality / NCR | saveAudit | `src/lib/services/audits.ts:21` | UNTESTED | Not yet exercised |
| SERVICE-0155 | Quality / NCR | listAuditFindings | `src/lib/services/audits.ts:88` | UNTESTED | Not yet exercised |
| SERVICE-0156 | Quality / NCR | updateAuditFinding | `src/lib/services/audits.ts:96` | UNTESTED | Not yet exercised |
| SERVICE-0157 | Accounting / GovCon | connectBankAccount | `src/lib/services/banking.ts:16` | UNTESTED | Not yet exercised |
| SERVICE-0158 | Accounting / GovCon | parseOfx | `src/lib/services/banking.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0159 | Accounting / GovCon | looksLikeOfx | `src/lib/services/banking.ts:97` | UNTESTED | Not yet exercised |
| SERVICE-0160 | Accounting / GovCon | importBankData | `src/lib/services/banking.ts:106` | UNTESTED | Not yet exercised |
| SERVICE-0161 | Accounting / GovCon | importBankTransactions | `src/lib/services/banking.ts:169` | UNTESTED | Not yet exercised |
| SERVICE-0162 | Accounting / GovCon | categorizeBankTransaction | `src/lib/services/banking.ts:258` | UNTESTED | Not yet exercised |
| SERVICE-0163 | Accounting / GovCon | reconcileBankTransaction | `src/lib/services/banking.ts:308` | UNTESTED | Not yet exercised |
| SERVICE-0164 | Accounting / GovCon | getBankingOverview | `src/lib/services/banking.ts:321` | UNTESTED | Not yet exercised |
| SERVICE-0165 | Accounting / GovCon | suggestBankCategories | `src/lib/services/banking.ts:373` | UNTESTED | Not yet exercised |
| SERVICE-0166 | Billing / Founding | raiseArInvoiceForShipment | `src/lib/services/billing.ts:23` | UNTESTED | Not yet exercised |
| SERVICE-0167 | Billing / Founding | raiseApInvoiceForReceipt | `src/lib/services/billing.ts:125` | UNTESTED | Not yet exercised |
| SERVICE-0168 | Billing / Founding | createVendorApInvoice | `src/lib/services/billing.ts:197` | UNTESTED | Not yet exercised |
| SERVICE-0169 | PMO / Budgets | sanitizeChargeCode | `src/lib/services/budgets.ts:37` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0170 | PMO / Budgets | chargeCodeFromBudgetName | `src/lib/services/budgets.ts:49` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0171 | PMO / Budgets | projectWbsChargeCode | `src/lib/services/budgets.ts:59` | PASS | scripts/verify/chunk-b-auth.ts; scenario only |
| SERVICE-0172 | PMO / Budgets | wbsCodePathFromLeaf | `src/lib/services/budgets.ts:76` | PASS | scripts/verify/chunk-g-pmo.ts; scenario only |
| SERVICE-0173 | PMO / Budgets | defaultProjectWbsChargeCode | `src/lib/services/budgets.ts:95` | UNTESTED | Not yet exercised |
| SERVICE-0174 | PMO / Budgets | ensureProjectWbsChargeCodes | `src/lib/services/budgets.ts:106` | PASS | scripts/verify/chunk-g-pmo.ts; scenario only |
| SERVICE-0175 | PMO / Budgets | createBudget | `src/lib/services/budgets.ts:209` | UNTESTED | Not yet exercised |
| SERVICE-0176 | PMO / Budgets | updateBudget | `src/lib/services/budgets.ts:387` | UNTESTED | Not yet exercised |
| SERVICE-0177 | PMO / Budgets | enactBudget | `src/lib/services/budgets.ts:556` | UNTESTED | Not yet exercised |
| SERVICE-0178 | PMO / Budgets | closeBudget | `src/lib/services/budgets.ts:637` | UNTESTED | Not yet exercised |
| SERVICE-0179 | PMO / Budgets | getEnactedChargeCodes | `src/lib/services/budgets.ts:654` | UNTESTED | Not yet exercised |
| SERVICE-0180 | PMO / Budgets | findBudgetByChargeCode | `src/lib/services/budgets.ts:687` | UNTESTED | Not yet exercised |
| SERVICE-0181 | PMO / Budgets | resolveUserLaborRate | `src/lib/services/budgets.ts:697` | UNTESTED | Not yet exercised |
| SERVICE-0182 | PMO / Budgets | setUserCompensation | `src/lib/services/budgets.ts:709` | UNTESTED | Not yet exercised |
| SERVICE-0183 | PMO / Budgets | postBudgetCharge | `src/lib/services/budgets.ts:751` | UNTESTED | Not yet exercised |
| SERVICE-0184 | PMO / Budgets | postTimesheetBudgetCharges | `src/lib/services/budgets.ts:927` | UNTESTED | Not yet exercised |
| SERVICE-0185 | PMO / Budgets | chargeBudgetMaterialFromPr | `src/lib/services/budgets.ts:977` | UNTESTED | Not yet exercised |
| SERVICE-0186 | PMO / Budgets | listBudgets | `src/lib/services/budgets.ts:1013` | UNTESTED | Not yet exercised |
| SERVICE-0187 | PMO / Budgets | getBudgetDetail | `src/lib/services/budgets.ts:1047` | UNTESTED | Not yet exercised |
| SERVICE-0188 | Platform / Other | tryCarinaAction | `src/lib/services/carina-actions.ts:326` | UNTESTED | Not yet exercised |
| SERVICE-0189 | Platform / Other | carinaUnitEconomics | `src/lib/services/carina-cost.ts:72` | UNTESTED | Not yet exercised |
| SERVICE-0190 | Platform / Other | formatCarinaCostReport | `src/lib/services/carina-cost.ts:142` | UNTESTED | Not yet exercised |
| SERVICE-0191 | Platform / Other | getCarinaFeatures | `src/lib/services/carina-features.ts:28` | UNTESTED | Not yet exercised |
| SERVICE-0192 | Platform / Other | checkCarinaRateLimit | `src/lib/services/carina-rate-limit.ts:38` | UNTESTED | Not yet exercised |
| SERVICE-0193 | PLM / BOM / ECO | parseEcrAttachments | `src/lib/services/cm-library.ts:18` | UNTESTED | Not yet exercised |
| SERVICE-0194 | PLM / BOM / ECO | resolvePrimaryDrawing | `src/lib/services/cm-library.ts:50` | UNTESTED | Not yet exercised |
| SERVICE-0195 | PLM / BOM / ECO | ensureAdminFolder | `src/lib/services/cm-library.ts:67` | UNTESTED | Not yet exercised |
| SERVICE-0196 | PLM / BOM / ECO | ensureWorkInstructionsFolder | `src/lib/services/cm-library.ts:111` | UNTESTED | Not yet exercised |
| SERVICE-0197 | PLM / BOM / ECO | retainWorkInstructionMaster | `src/lib/services/cm-library.ts:138` | UNTESTED | Not yet exercised |
| SERVICE-0198 | PLM / BOM / ECO | createCmFolder | `src/lib/services/cm-library.ts:232` | UNTESTED | Not yet exercised |
| SERVICE-0199 | PLM / BOM / ECO | updateCmFolder | `src/lib/services/cm-library.ts:311` | UNTESTED | Not yet exercised |
| SERVICE-0200 | PLM / BOM / ECO | deleteCmFolder | `src/lib/services/cm-library.ts:347` | UNTESTED | Not yet exercised |
| SERVICE-0201 | PLM / BOM / ECO | moveCmDocument | `src/lib/services/cm-library.ts:382` | UNTESTED | Not yet exercised |
| SERVICE-0202 | PLM / BOM / ECO | updateCmDocument | `src/lib/services/cm-library.ts:401` | UNTESTED | Not yet exercised |
| SERVICE-0203 | PLM / BOM / ECO | deleteCmDocument | `src/lib/services/cm-library.ts:441` | UNTESTED | Not yet exercised |
| SERVICE-0204 | PLM / BOM / ECO | mapCrToColumn | `src/lib/services/cm-library.ts:462` | UNTESTED | Not yet exercised |
| SERVICE-0205 | PLM / BOM / ECO | mapDocumentEcrToColumn | `src/lib/services/cm-library.ts:484` | UNTESTED | Not yet exercised |
| SERVICE-0206 | PLM / BOM / ECO | mapWiToColumn | `src/lib/services/cm-library.ts:490` | UNTESTED | Not yet exercised |
| SERVICE-0207 | PLM / BOM / ECO | mapBomToColumn | `src/lib/services/cm-library.ts:499` | UNTESTED | Not yet exercised |
| SERVICE-0208 | PLM / BOM / ECO | moveChangeRequestColumn | `src/lib/services/cm-library.ts:508` | UNTESTED | Not yet exercised |
| SERVICE-0209 | PLM / BOM / ECO | ensureArchiveFolder | `src/lib/services/cm-library.ts:541` | UNTESTED | Not yet exercised |
| SERVICE-0210 | PLM / BOM / ECO | searchCmDocumentsByNumber | `src/lib/services/cm-library.ts:596` | UNTESTED | Not yet exercised |
| SERVICE-0211 | PLM / BOM / ECO | createDocumentEcr | `src/lib/services/cm-library.ts:617` | UNTESTED | Not yet exercised |
| SERVICE-0212 | PLM / BOM / ECO | assignEcrApprovers | `src/lib/services/cm-library.ts:943` | UNTESTED | Not yet exercised |
| SERVICE-0213 | PLM / BOM / ECO | releaseDocumentEcr | `src/lib/services/cm-library.ts:1009` | UNTESTED | Not yet exercised |
| SERVICE-0214 | PLM / BOM / ECO | addEcrAttachments | `src/lib/services/cm-library.ts:1195` | UNTESTED | Not yet exercised |
| SERVICE-0215 | PLM / BOM / ECO | setEcrPrimaryAttachment | `src/lib/services/cm-library.ts:1276` | UNTESTED | Not yet exercised |
| SERVICE-0216 | PLM / BOM / ECO | addChangeRequestComment | `src/lib/services/cm-library.ts:1316` | UNTESTED | Not yet exercised |
| SERVICE-0217 | PLM / BOM / ECO | formatNumberFromScheme | `src/lib/services/cm-numbers.ts:49` | UNTESTED | Not yet exercised |
| SERVICE-0218 | PLM / BOM / ECO | schemeExample | `src/lib/services/cm-numbers.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0219 | PLM / BOM / ECO | ensureDefaultNumberSchemes | `src/lib/services/cm-numbers.ts:82` | UNTESTED | Not yet exercised |
| SERVICE-0220 | PLM / BOM / ECO | listNumberSchemes | `src/lib/services/cm-numbers.ts:113` | UNTESTED | Not yet exercised |
| SERVICE-0221 | PLM / BOM / ECO | updateNumberScheme | `src/lib/services/cm-numbers.ts:121` | UNTESTED | Not yet exercised |
| SERVICE-0222 | PLM / BOM / ECO | createNumberRequest | `src/lib/services/cm-numbers.ts:215` | UNTESTED | Not yet exercised |
| SERVICE-0223 | PLM / BOM / ECO | assignNumberToRequest | `src/lib/services/cm-numbers.ts:297` | UNTESTED | Not yet exercised |
| SERVICE-0224 | PLM / BOM / ECO | rejectNumberRequest | `src/lib/services/cm-numbers.ts:432` | UNTESTED | Not yet exercised |
| SERVICE-0225 | PLM / BOM / ECO | cancelNumberRequest | `src/lib/services/cm-numbers.ts:470` | UNTESTED | Not yet exercised |
| SERVICE-0226 | PLM / BOM / ECO | registerNumberManually | `src/lib/services/cm-numbers.ts:491` | UNTESTED | Not yet exercised |
| SERVICE-0227 | PLM / BOM / ECO | updateRegistryStatus | `src/lib/services/cm-numbers.ts:548` | UNTESTED | Not yet exercised |
| SERVICE-0228 | PLM / BOM / ECO | markRegistryInUse | `src/lib/services/cm-numbers.ts:583` | UNTESTED | Not yet exercised |
| SERVICE-0229 | PLM / BOM / ECO | linkRegistryToReleasedDocument | `src/lib/services/cm-numbers.ts:608` | UNTESTED | Not yet exercised |
| SERVICE-0230 | PLM / BOM / ECO | listNumberRequests | `src/lib/services/cm-numbers.ts:625` | UNTESTED | Not yet exercised |
| SERVICE-0231 | PLM / BOM / ECO | listNumberRegistry | `src/lib/services/cm-numbers.ts:640` | UNTESTED | Not yet exercised |
| SERVICE-0232 | PLM / BOM / ECO | listAvailableNumbersForEcr | `src/lib/services/cm-numbers.ts:678` | UNTESTED | Not yet exercised |
| SERVICE-0233 | PLM / BOM / ECO | previewNextNumber | `src/lib/services/cm-numbers.ts:701` | UNTESTED | Not yet exercised |
| SERVICE-0234 | PMO / Budgets | getPartCommittedTotal | `src/lib/services/commitments.ts:19` | UNTESTED | Not yet exercised |
| SERVICE-0235 | PMO / Budgets | getPartCommitments | `src/lib/services/commitments.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0236 | PMO / Budgets | releaseCommitment | `src/lib/services/commitments.ts:89` | UNTESTED | Not yet exercised |
| SERVICE-0237 | Admin / Settings | getCompanyDepartments | `src/lib/services/company.ts:20` | UNTESTED | Not yet exercised |
| SERVICE-0238 | Platform / Other | getCustomerCreditSnapshot | `src/lib/services/credit.ts:29` | UNTESTED | Not yet exercised |
| SERVICE-0239 | Platform / Other | evaluateDepositRequirement | `src/lib/services/credit.ts:90` | UNTESTED | Not yet exercised |
| SERVICE-0240 | CRM / Sales | listLeads | `src/lib/services/crm.ts:59` | PASS | CRM create/list lead and reject empty company |
| SERVICE-0241 | CRM / Sales | createLead | `src/lib/services/crm.ts:67` | PASS | CRM create/list lead and reject empty company |
| SERVICE-0242 | CRM / Sales | updateLeadStatus | `src/lib/services/crm.ts:100` | UNTESTED | Not yet exercised |
| SERVICE-0243 | CRM / Sales | convertLead | `src/lib/services/crm.ts:117` | FAIL | CRM double lead conversion must not duplicate opportunity |
| SERVICE-0244 | CRM / Sales | createOpportunity | `src/lib/services/crm.ts:156` | PASS | CRM promote lead and list/get opportunity |
| SERVICE-0245 | CRM / Sales | listOpportunities | `src/lib/services/crm.ts:197` | PASS | CRM promote lead and list/get opportunity |
| SERVICE-0246 | CRM / Sales | getOpportunity | `src/lib/services/crm.ts:213` | PASS | CRM promote lead and list/get opportunity |
| SERVICE-0247 | CRM / Sales | updateOpportunity | `src/lib/services/crm.ts:220` | UNTESTED | Not yet exercised |
| SERVICE-0248 | CRM / Sales | setStage | `src/lib/services/crm.ts:236` | PASS | CRM lost reason validation / stage transition |
| SERVICE-0249 | CRM / Sales | convertToCustomer | `src/lib/services/crm.ts:271` | PASS | CRM won deal customer conversion is idempotent |
| SERVICE-0250 | CRM / Sales | addActivity | `src/lib/services/crm.ts:317` | PASS | CRM task create / complete / open-task summary |
| SERVICE-0251 | CRM / Sales | completeActivity | `src/lib/services/crm.ts:343` | PASS | CRM task create / complete / open-task summary |
| SERVICE-0252 | CRM / Sales | getOpenTasks | `src/lib/services/crm.ts:351` | PASS | CRM task create / complete / open-task summary |
| SERVICE-0253 | CRM / Sales | listContacts | `src/lib/services/crm.ts:361` | PASS | CRM listContacts |
| SERVICE-0254 | CRM / Sales | createContact | `src/lib/services/crm.ts:369` | UNTESTED | Not yet exercised |
| SERVICE-0255 | CRM / Sales | getPipeline | `src/lib/services/crm.ts:410` | PASS | CRM getPipeline |
| SERVICE-0256 | CRM / Sales | getCrmSummary | `src/lib/services/crm.ts:427` | PASS | CRM getCrmSummary |
| SERVICE-0257 | CRM / Sales | getLostReasons | `src/lib/services/crm.ts:466` | PASS | CRM getLostReasons |
| SERVICE-0258 | Inventory / Kitting | createCycleCount | `src/lib/services/cycle-counts.ts:8` | PASS | Cycle count create / negative quantity and incomplete completion gates |
| SERVICE-0259 | Inventory / Kitting | recordCycleCountLine | `src/lib/services/cycle-counts.ts:71` | PASS | Cycle count record all / complete / repeated completion denied |
| SERVICE-0260 | Inventory / Kitting | completeCycleCount | `src/lib/services/cycle-counts.ts:109` | PASS | Cycle count record all / complete / repeated completion denied |
| SERVICE-0261 | Inventory / Kitting | cancelCycleCount | `src/lib/services/cycle-counts.ts:213` | UNTESTED | Not yet exercised |
| SERVICE-0262 | Platform / Other | disciplineForUser | `src/lib/services/dashboard-pulse.ts:39` | UNTESTED | Not yet exercised |
| SERVICE-0263 | Platform / Other | getDisciplinePulse | `src/lib/services/dashboard-pulse.ts:62` | UNTESTED | Not yet exercised |
| SERVICE-0264 | Admin / Settings | parseDelimited | `src/lib/services/data-import.ts:21` | UNTESTED | Not yet exercised |
| SERVICE-0265 | Admin / Settings | runImport | `src/lib/services/data-import.ts:189` | UNTESTED | Not yet exercised |
| SERVICE-0266 | Demo / Tenancy | reapAbandonedDemos | `src/lib/services/demo-reaper.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0267 | Docs | requireDocsAccess | `src/lib/services/docs.ts:24` | UNTESTED | Not yet exercised |
| SERVICE-0268 | Docs | revisionHash | `src/lib/services/docs.ts:43` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0269 | Docs | createDocSpace | `src/lib/services/docs.ts:48` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0270 | Docs | createDocPage | `src/lib/services/docs.ts:56` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0271 | Docs | saveDocPage | `src/lib/services/docs.ts:77` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0272 | Docs | restoreDocRevision | `src/lib/services/docs.ts:103` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0273 | Docs | signDocRevision | `src/lib/services/docs.ts:111` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0274 | Docs | addDocComment | `src/lib/services/docs.ts:127` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0275 | Docs | resolveDocComment | `src/lib/services/docs.ts:134` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0276 | Docs | searchDocTargets | `src/lib/services/docs.ts:141` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0277 | Docs | linkDocRecord | `src/lib/services/docs.ts:158` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0278 | Docs | unlinkDocRecord | `src/lib/services/docs.ts:168` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0279 | Docs | isDocsSchemaMissing | `src/lib/services/docs.ts:173` | UNTESTED | Not yet exercised |
| SERVICE-0280 | Platform / Other | sendEmail | `src/lib/services/email.ts:14` | UNTESTED | Not yet exercised |
| SERVICE-0281 | Platform / Other | composePoEmail | `src/lib/services/email.ts:117` | UNTESTED | Not yet exercised |
| SERVICE-0282 | Platform / Other | composeQuoteEmail | `src/lib/services/email.ts:165` | UNTESTED | Not yet exercised |
| SERVICE-0283 | Platform / Other | parseInboundEmail | `src/lib/services/email.ts:241` | UNTESTED | Not yet exercised |
| SERVICE-0284 | Platform / Other | listEmailMessages | `src/lib/services/email.ts:378` | UNTESTED | Not yet exercised |
| SERVICE-0285 | PLM / BOM / ECO | createCampaign | `src/lib/services/engineering-work.ts:53` | UNTESTED | Not yet exercised |
| SERVICE-0286 | PLM / BOM / ECO | updateCampaign | `src/lib/services/engineering-work.ts:102` | UNTESTED | Not yet exercised |
| SERVICE-0287 | PLM / BOM / ECO | createSaga | `src/lib/services/engineering-work.ts:148` | UNTESTED | Not yet exercised |
| SERVICE-0288 | PLM / BOM / ECO | updateSaga | `src/lib/services/engineering-work.ts:225` | UNTESTED | Not yet exercised |
| SERVICE-0289 | PLM / BOM / ECO | createEngTask | `src/lib/services/engineering-work.ts:271` | UNTESTED | Not yet exercised |
| SERVICE-0290 | PLM / BOM / ECO | updateEngTask | `src/lib/services/engineering-work.ts:388` | UNTESTED | Not yet exercised |
| SERVICE-0291 | PLM / BOM / ECO | breakDownTask | `src/lib/services/engineering-work.ts:445` | UNTESTED | Not yet exercised |
| SERVICE-0292 | PLM / BOM / ECO | createProductionEngIssue | `src/lib/services/engineering-work.ts:479` | UNTESTED | Not yet exercised |
| SERVICE-0293 | PLM / BOM / ECO | acceptProductionIssueAsTask | `src/lib/services/engineering-work.ts:587` | UNTESTED | Not yet exercised |
| SERVICE-0294 | PLM / BOM / ECO | updateProductionEngIssue | `src/lib/services/engineering-work.ts:630` | UNTESTED | Not yet exercised |
| SERVICE-0295 | PLM / BOM / ECO | listProductionEngIssues | `src/lib/services/engineering-work.ts:714` | UNTESTED | Not yet exercised |
| SERVICE-0296 | PLM / BOM / ECO | listProductEngTasks | `src/lib/services/engineering-work.ts:742` | UNTESTED | Not yet exercised |
| SERVICE-0297 | PLM / BOM / ECO | addEngDependency | `src/lib/services/engineering-work.ts:758` | UNTESTED | Not yet exercised |
| SERVICE-0298 | PLM / BOM / ECO | ensureDefaultSwimLanes | `src/lib/services/engineering-work.ts:836` | UNTESTED | Not yet exercised |
| SERVICE-0299 | PLM / BOM / ECO | listSwimLanes | `src/lib/services/engineering-work.ts:853` | UNTESTED | Not yet exercised |
| SERVICE-0300 | PLM / BOM / ECO | createSwimLane | `src/lib/services/engineering-work.ts:861` | UNTESTED | Not yet exercised |
| SERVICE-0301 | PLM / BOM / ECO | removeSwimLane | `src/lib/services/engineering-work.ts:885` | UNTESTED | Not yet exercised |
| SERVICE-0302 | PLM / BOM / ECO | listPmAlerts | `src/lib/services/engineering-work.ts:905` | UNTESTED | Not yet exercised |
| SERVICE-0303 | PLM / BOM / ECO | markAlertRead | `src/lib/services/engineering-work.ts:919` | UNTESTED | Not yet exercised |
| SERVICE-0304 | PLM / BOM / ECO | removeEngDependency | `src/lib/services/engineering-work.ts:926` | UNTESTED | Not yet exercised |
| SERVICE-0305 | PLM / BOM / ECO | listDependenciesForDiscipline | `src/lib/services/engineering-work.ts:930` | UNTESTED | Not yet exercised |
| SERVICE-0306 | PLM / BOM / ECO | createEngSprint | `src/lib/services/engineering-work.ts:1022` | UNTESTED | Not yet exercised |
| SERVICE-0307 | PLM / BOM / ECO | updateEngSprint | `src/lib/services/engineering-work.ts:1049` | UNTESTED | Not yet exercised |
| SERVICE-0308 | PLM / BOM / ECO | listEngSprints | `src/lib/services/engineering-work.ts:1069` | UNTESTED | Not yet exercised |
| SERVICE-0309 | PLM / BOM / ECO | assignTaskToSprint | `src/lib/services/engineering-work.ts:1092` | UNTESTED | Not yet exercised |
| SERVICE-0310 | PLM / BOM / ECO | assignSagaToSprint | `src/lib/services/engineering-work.ts:1102` | UNTESTED | Not yet exercised |
| SERVICE-0311 | PLM / BOM / ECO | getDisciplineBoard | `src/lib/services/engineering-work.ts:1113` | UNTESTED | Not yet exercised |
| SERVICE-0312 | PLM / BOM / ECO | scanIntoTask | `src/lib/services/engineering-work.ts:1308` | UNTESTED | Not yet exercised |
| SERVICE-0313 | PLM / BOM / ECO | scanOutOfTask | `src/lib/services/engineering-work.ts:1382` | UNTESTED | Not yet exercised |
| SERVICE-0314 | PLM / BOM / ECO | createWbsElement | `src/lib/services/engineering-work.ts:1565` | UNTESTED | Not yet exercised |
| SERVICE-0315 | PLM / BOM / ECO | updateWbsElement | `src/lib/services/engineering-work.ts:1645` | UNTESTED | Not yet exercised |
| SERVICE-0316 | PLM / BOM / ECO | getWbsTree | `src/lib/services/engineering-work.ts:1701` | UNTESTED | Not yet exercised |
| SERVICE-0317 | PLM / BOM / ECO | getWbsDetail | `src/lib/services/engineering-work.ts:1720` | UNTESTED | Not yet exercised |
| SERVICE-0318 | PLM / BOM / ECO | listCampaignsForProject | `src/lib/services/engineering-work.ts:1752` | UNTESTED | Not yet exercised |
| SERVICE-0319 | PLM / BOM / ECO | listSagasByDiscipline | `src/lib/services/engineering-work.ts:1773` | UNTESTED | Not yet exercised |
| SERVICE-0320 | PLM / BOM / ECO | getDisciplineSummaries | `src/lib/services/engineering-work.ts:1802` | UNTESTED | Not yet exercised |
| SERVICE-0321 | PLM / BOM / ECO | getBurndownData | `src/lib/services/engineering-work.ts:1844` | UNTESTED | Not yet exercised |
| SERVICE-0322 | PLM / BOM / ECO | listOpenScans | `src/lib/services/engineering-work.ts:1966` | UNTESTED | Not yet exercised |
| SERVICE-0323 | Service / Assets | createTicket | `src/lib/services/field-service.ts:64` | PASS | Service ticket create/list/detail |
| SERVICE-0324 | Service / Assets | listTickets | `src/lib/services/field-service.ts:109` | PASS | Service ticket create/list/detail |
| SERVICE-0325 | Service / Assets | getTicket | `src/lib/services/field-service.ts:143` | PASS | Service ticket create/list/detail |
| SERVICE-0326 | Service / Assets | updateTicketStatus | `src/lib/services/field-service.ts:156` | UNTESTED | Not yet exercised |
| SERVICE-0327 | Service / Assets | scheduleVisit | `src/lib/services/field-service.ts:184` | PASS | Service dispatch / start / labor / parts / complete |
| SERVICE-0328 | Service / Assets | updateVisit | `src/lib/services/field-service.ts:214` | UNTESTED | Not yet exercised |
| SERVICE-0329 | Service / Assets | startVisit | `src/lib/services/field-service.ts:230` | PASS | Service dispatch / start / labor / parts / complete |
| SERVICE-0330 | Service / Assets | completeVisit | `src/lib/services/field-service.ts:257` | PASS | Service dispatch / start / labor / parts / complete |
| SERVICE-0331 | Service / Assets | addLabor | `src/lib/services/field-service.ts:303` | PASS | Service rejects zero/negative labor and parts |
| SERVICE-0332 | Service / Assets | addPartUsage | `src/lib/services/field-service.ts:326` | PASS | Service rejects zero/negative labor and parts |
| SERVICE-0333 | Service / Assets | removeLabor | `src/lib/services/field-service.ts:351` | UNTESTED | Not yet exercised |
| SERVICE-0334 | Service / Assets | removePartUsage | `src/lib/services/field-service.ts:355` | UNTESTED | Not yet exercised |
| SERVICE-0335 | Service / Assets | getTicketTotals | `src/lib/services/field-service.ts:374` | PASS | Service dispatch / start / labor / parts / complete |
| SERVICE-0336 | Service / Assets | listInstalledAssets | `src/lib/services/field-service.ts:414` | PASS | Service listInstalledAssets |
| SERVICE-0337 | Service / Assets | createInstalledAsset | `src/lib/services/field-service.ts:425` | UNTESTED | Not yet exercised |
| SERVICE-0338 | Service / Assets | isUnderWarranty | `src/lib/services/field-service.ts:458` | UNTESTED | Not yet exercised |
| SERVICE-0339 | Service / Assets | getServiceSummary | `src/lib/services/field-service.ts:464` | PASS | Service getServiceSummary |
| SERVICE-0340 | Service / Assets | listVehicles | `src/lib/services/fleet.ts:42` | PASS | fleet listVehicles |
| SERVICE-0341 | Service / Assets | getVehicle | `src/lib/services/fleet.ts:55` | UNTESTED | Not yet exercised |
| SERVICE-0342 | Service / Assets | createVehicle | `src/lib/services/fleet.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0343 | Service / Assets | updateVehicle | `src/lib/services/fleet.ts:116` | UNTESTED | Not yet exercised |
| SERVICE-0344 | Service / Assets | recordOdometer | `src/lib/services/fleet.ts:132` | UNTESTED | Not yet exercised |
| SERVICE-0345 | Service / Assets | addMaintenance | `src/lib/services/fleet.ts:147` | UNTESTED | Not yet exercised |
| SERVICE-0346 | Service / Assets | completeMaintenance | `src/lib/services/fleet.ts:181` | UNTESTED | Not yet exercised |
| SERVICE-0347 | Service / Assets | getMaintenanceDue | `src/lib/services/fleet.ts:259` | PASS | fleet getMaintenanceDue |
| SERVICE-0348 | Service / Assets | getComplianceDue | `src/lib/services/fleet.ts:304` | PASS | fleet getComplianceDue |
| SERVICE-0349 | Service / Assets | addFuelLog | `src/lib/services/fleet.ts:348` | UNTESTED | Not yet exercised |
| SERVICE-0350 | Service / Assets | getVehicleCost | `src/lib/services/fleet.ts:379` | UNTESTED | Not yet exercised |
| SERVICE-0351 | Billing / Founding | qualifiesForFounding | `src/lib/services/founding-membership.ts:7` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0352 | Billing / Founding | foundingMembership | `src/lib/services/founding-membership.ts:13` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0353 | Billing / Founding | subscriptionFoundingMembership | `src/lib/services/founding-membership.ts:20` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0354 | Billing / Founding | foundingGrant | `src/lib/services/founding-membership.ts:35` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0355 | Billing / Founding | reviewFounderStripeState | `src/lib/services/founding-stripe-review.ts:2` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0356 | Accounting / GovCon | getGaapReportPack | `src/lib/services/gaap.ts:17` | PASS | gaap getGaapReportPack |
| SERVICE-0357 | Accounting / GovCon | getAccountRegister | `src/lib/services/gaap.ts:135` | UNTESTED | Not yet exercised |
| SERVICE-0358 | Accounting / GovCon | getMonthEndCloseStatus | `src/lib/services/gaap.ts:223` | PASS | gaap getMonthEndCloseStatus |
| SERVICE-0359 | Accounting / GovCon | getReclassifyData | `src/lib/services/gaap.ts:311` | PASS | gaap getReclassifyData |
| SERVICE-0360 | Accounting / GovCon | reclassifyJournalLines | `src/lib/services/gaap.ts:387` | UNTESTED | Not yet exercised |
| SERVICE-0361 | Accounting / GovCon | postJournal | `src/lib/services/gaap.ts:490` | PASS | GL balanced journal remains pending / idempotency; priority-results.json: PASS Closed-period post rejected with no JE/line writes; round2-finance-results.json: PASS Pending JE does not change isolated account balances |
| SERVICE-0362 | Accounting / GovCon | getAccountingCloseDate | `src/lib/services/gaap.ts:692` | UNTESTED | Not yet exercised |
| SERVICE-0363 | Accounting / GovCon | setAccountingCloseDate | `src/lib/services/gaap.ts:726` | PASS | priority-results.json: PASS Closed-period post rejected with no JE/line writes |
| SERVICE-0364 | Accounting / GovCon | approveJournal | `src/lib/services/gaap.ts:763` | FAIL | priority-results.json: PASS Accounting self-approval denied when separation enabled; priority-results.json: PASS Accounting approval applies once and is repeat safe; round2-finance-results.json: PASS Approved JE reconciles account balances to posted lines; round2-finance-results.json: FAIL Concurrent approvals apply the same JE balances only once |
| SERVICE-0365 | Accounting / GovCon | voidJournal | `src/lib/services/gaap.ts:806` | PASS | round2-finance-results.json: PASS Void unposted journal requires reason and never applies balances |
| SERVICE-0366 | Accounting / GovCon | listJournalEntries | `src/lib/services/gaap.ts:834` | PASS | gaap listJournalEntries |
| SERVICE-0367 | Accounting / GovCon | recordArPayment | `src/lib/services/gaap.ts:865` | FAIL | finance-supply-results.json: FAIL AR rejected GL posting rolls back payment and invoice; round2-finance-results.json: PASS AR partial/full receipts reconcile subledger and GL; round2-finance-results.json: FAIL AR overpayment cannot disappear from subledger; round2-finance-results.json: FAIL AR payment journal honors supplied historical payment date |
| SERVICE-0368 | Accounting / GovCon | recordApPayment | `src/lib/services/gaap.ts:922` | FAIL | finance-supply-results.json: FAIL AP rejected GL posting rolls back payment and invoice; round2-finance-results.json: PASS AP partial/full receipts reconcile subledger and GL; round2-finance-results.json: FAIL AP overpayment cannot disappear from subledger; round2-finance-results.json: FAIL AP payment journal honors supplied historical payment date |
| SERVICE-0369 | Accounting / GovCon | createExpenseEntry | `src/lib/services/gaap.ts:978` | UNTESTED | Not yet exercised |
| SERVICE-0370 | Accounting / GovCon | reverseJournalEntry | `src/lib/services/gaap.ts:1028` | FAIL | finance-supply-results.json: FAIL Journal reversal retains FAR unallowable classification; finance-supply-results.json: PASS Journal reversal is balanced and cannot run twice; round2-finance-results.json: PASS Reversal reconciles original balances back to zero |
| SERVICE-0371 | Accounting / GovCon | runDueAutoReversals | `src/lib/services/gaap.ts:1073` | UNTESTED | Not yet exercised |
| SERVICE-0372 | Accounting / GovCon | getAccountingOverview | `src/lib/services/gaap.ts:1100` | PASS | gaap getAccountingOverview |
| SERVICE-0373 | Accounting / GovCon | getCashFlowStatement | `src/lib/services/gaap.ts:1209` | PASS | gaap getCashFlowStatement |
| SERVICE-0374 | Accounting / GovCon | ensureAccountingDefaults | `src/lib/services/gl-posting.ts:133` | UNTESTED | Not yet exercised |
| SERVICE-0375 | Accounting / GovCon | ensureFiscalPeriods | `src/lib/services/gl-posting.ts:186` | UNTESTED | Not yet exercised |
| SERVICE-0376 | Accounting / GovCon | postMaterialIssue | `src/lib/services/gl-posting.ts:331` | PASS | round2-finance-results.json: PASS Manufacturing postings capitalize material/labor/fringe/OH but not G&A |
| SERVICE-0377 | Accounting / GovCon | postDirectLabor | `src/lib/services/gl-posting.ts:356` | PASS | round2-finance-results.json: PASS Manufacturing postings capitalize material/labor/fringe/OH but not G&A |
| SERVICE-0378 | Accounting / GovCon | postWorkOrderCompletion | `src/lib/services/gl-posting.ts:418` | PASS | round2-finance-results.json: PASS Manufacturing completion relieves WIP and reconciles variance; round2-finance-results.json: PASS Repeat completion posting is idempotent |
| SERVICE-0379 | Accounting / GovCon | postScrap | `src/lib/services/gl-posting.ts:459` | PASS | round2-finance-results.json: PASS GFP scrap never posts company expense |
| SERVICE-0380 | Accounting / GovCon | postInventoryAdjustment | `src/lib/services/gl-posting.ts:485` | PASS | round2-finance-results.json: PASS Inventory shortage/surplus and OSP postings are balanced |
| SERVICE-0381 | Accounting / GovCon | postOutsideProcessing | `src/lib/services/gl-posting.ts:506` | PASS | round2-finance-results.json: PASS Inventory shortage/surplus and OSP postings are balanced |
| SERVICE-0382 | Accounting / GovCon | chargeForSalesOrder | `src/lib/services/gl-posting.ts:530` | UNTESTED | Not yet exercised |
| SERVICE-0383 | Accounting / GovCon | chargeForPurchaseOrder | `src/lib/services/gl-posting.ts:547` | UNTESTED | Not yet exercised |
| SERVICE-0384 | Platform / Other | grokConfigured | `src/lib/services/grok.ts:18` | UNTESTED | Not yet exercised |
| SERVICE-0385 | Platform / Other | grokModel | `src/lib/services/grok.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0386 | Platform / Other | grokChat | `src/lib/services/grok.ts:26` | UNTESTED | Not yet exercised |
| SERVICE-0387 | Platform / Other | grokTranslate | `src/lib/services/grok.ts:80` | UNTESTED | Not yet exercised |
| SERVICE-0388 | Platform / Other | probeGrok | `src/lib/services/grok.ts:101` | UNTESTED | Not yet exercised |
| SERVICE-0389 | HR / Time | getTrainingMatrix | `src/lib/services/hr.ts:63` | UNTESTED | Not yet exercised |
| SERVICE-0390 | HR / Time | getComplianceItems | `src/lib/services/hr.ts:186` | UNTESTED | Not yet exercised |
| SERVICE-0391 | HR / Time | getHrPersona | `src/lib/services/hr.ts:280` | UNTESTED | Not yet exercised |
| SERVICE-0392 | HR / Time | canDecideFor | `src/lib/services/hr.ts:303` | UNTESTED | Not yet exercised |
| SERVICE-0393 | HR / Time | decidePtoRequest | `src/lib/services/hr.ts:317` | UNTESTED | Not yet exercised |
| SERVICE-0394 | HR / Time | createPtoRequest | `src/lib/services/hr.ts:365` | UNTESTED | Not yet exercised |
| SERVICE-0395 | HR / Time | decideTimeEntry | `src/lib/services/hr.ts:407` | UNTESTED | Not yet exercised |
| SERVICE-0396 | HR / Time | getExpenseReimbursements | `src/lib/services/hr.ts:459` | UNTESTED | Not yet exercised |
| SERVICE-0397 | HR / Time | payExpenseReport | `src/lib/services/hr.ts:472` | UNTESTED | Not yet exercised |
| SERVICE-0398 | HR / Time | advanceExpenseReport | `src/lib/services/hr.ts:521` | UNTESTED | Not yet exercised |
| SERVICE-0399 | HR / Time | updateGoalProgress | `src/lib/services/hr.ts:571` | UNTESTED | Not yet exercised |
| SERVICE-0400 | HR / Time | certExpiryTone | `src/lib/services/hr.ts:595` | UNTESTED | Not yet exercised |
| SERVICE-0401 | HR / Time | getPendingApprovals | `src/lib/services/hr.ts:605` | UNTESTED | Not yet exercised |
| SERVICE-0402 | HR / Time | getEmployeeProfile | `src/lib/services/hr.ts:645` | UNTESTED | Not yet exercised |
| SERVICE-0403 | HR / Time | getTeamOverview | `src/lib/services/hr.ts:717` | UNTESTED | Not yet exercised |
| SERVICE-0404 | HR / Time | upsertPerformanceReview | `src/lib/services/hr.ts:738` | UNTESTED | Not yet exercised |
| SERVICE-0405 | HR / Time | createEmployeeGoal | `src/lib/services/hr.ts:789` | UNTESTED | Not yet exercised |
| SERVICE-0406 | Quality / NCR | supportsInspections | `src/lib/services/inspections.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0407 | Quality / NCR | parseTemplate | `src/lib/services/inspections.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0408 | Quality / NCR | setInspectionTemplate | `src/lib/services/inspections.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0409 | Quality / NCR | saveInspection | `src/lib/services/inspections.ts:41` | UNTESTED | Not yet exercised |
| SERVICE-0410 | Quality / NCR | listInspections | `src/lib/services/inspections.ts:83` | UNTESTED | Not yet exercised |
| SERVICE-0411 | Quality / NCR | recordHumidity | `src/lib/services/inspections.ts:93` | UNTESTED | Not yet exercised |
| SERVICE-0412 | Quality / NCR | humiditySummary | `src/lib/services/inspections.ts:117` | PASS | inspections humiditySummary |
| SERVICE-0413 | Quality / NCR | humidityTone | `src/lib/services/inspections.ts:130` | UNTESTED | Not yet exercised |
| SERVICE-0414 | Quality / NCR | getEsdProgram | `src/lib/services/inspections.ts:134` | PASS | inspections getEsdProgram |
| SERVICE-0415 | Inventory / Kitting | createPart | `src/lib/services/items.ts:52` | UNTESTED | Not yet exercised |
| SERVICE-0416 | Inventory / Kitting | updatePart | `src/lib/services/items.ts:111` | UNTESTED | Not yet exercised |
| SERVICE-0417 | Inventory / Kitting | upsertPartVendor | `src/lib/services/items.ts:216` | UNTESTED | Not yet exercised |
| SERVICE-0418 | Inventory / Kitting | listApprovedSuppliers | `src/lib/services/items.ts:284` | UNTESTED | Not yet exercised |
| SERVICE-0419 | Inventory / Kitting | isSupplierApprovedForPo | `src/lib/services/items.ts:294` | UNTESTED | Not yet exercised |
| SERVICE-0420 | Inventory / Kitting | findKanbanShortages | `src/lib/services/kanban-replenishment.ts:25` | UNTESTED | Not yet exercised |
| SERVICE-0421 | Inventory / Kitting | ensureKanbanReplenishmentPrs | `src/lib/services/kanban-replenishment.ts:172` | UNTESTED | Not yet exercised |
| SERVICE-0422 | Inventory / Kitting | getUpcomingKits | `src/lib/services/kitting.ts:38` | UNTESTED | Not yet exercised |
| SERVICE-0423 | Inventory / Kitting | sweepKitReadiness | `src/lib/services/kitting.ts:90` | UNTESTED | Not yet exercised |
| SERVICE-0424 | Inventory / Kitting | getKitRefsForMrs | `src/lib/services/kitting.ts:113` | UNTESTED | Not yet exercised |
| SERVICE-0425 | Platform / Other | listBusinessPriorities | `src/lib/services/leadership.ts:4` | UNTESTED | Not yet exercised |
| SERVICE-0426 | Platform / Other | upsertBusinessPriority | `src/lib/services/leadership.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0427 | Platform / Other | setPriorityStatus | `src/lib/services/leadership.ts:77` | UNTESTED | Not yet exercised |
| SERVICE-0428 | Platform / Other | getExecutiveKpis | `src/lib/services/leadership.ts:97` | UNTESTED | Not yet exercised |
| SERVICE-0429 | Admin / Settings | canonicalPayload | `src/lib/services/license.ts:95` | UNTESTED | Not yet exercised |
| SERVICE-0430 | Admin / Settings | licenseRequired | `src/lib/services/license.ts:109` | UNTESTED | Not yet exercised |
| SERVICE-0431 | Admin / Settings | getLicenseStatus | `src/lib/services/license.ts:125` | UNTESTED | Not yet exercised |
| SERVICE-0432 | Admin / Settings | licenseBootLine | `src/lib/services/license.ts:231` | UNTESTED | Not yet exercised |
| SERVICE-0433 | Shipping / Logistics | listCarriers | `src/lib/services/logistics.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0434 | Shipping / Logistics | createCarrier | `src/lib/services/logistics.ts:38` | UNTESTED | Not yet exercised |
| SERVICE-0435 | Shipping / Logistics | updateCarrier | `src/lib/services/logistics.ts:72` | UNTESTED | Not yet exercised |
| SERVICE-0436 | Shipping / Logistics | trackingLink | `src/lib/services/logistics.ts:77` | UNTESTED | Not yet exercised |
| SERVICE-0437 | Shipping / Logistics | recordFreight | `src/lib/services/logistics.ts:89` | UNTESTED | Not yet exercised |
| SERVICE-0438 | Shipping / Logistics | listFreight | `src/lib/services/logistics.ts:123` | UNTESTED | Not yet exercised |
| SERVICE-0439 | Shipping / Logistics | getFreightSummary | `src/lib/services/logistics.ts:142` | UNTESTED | Not yet exercised |
| SERVICE-0440 | Shipping / Logistics | addLandedCost | `src/lib/services/logistics.ts:165` | UNTESTED | Not yet exercised |
| SERVICE-0441 | Shipping / Logistics | listLandedCosts | `src/lib/services/logistics.ts:187` | UNTESTED | Not yet exercised |
| SERVICE-0442 | Shipping / Logistics | previewAllocation | `src/lib/services/logistics.ts:255` | UNTESTED | Not yet exercised |
| SERVICE-0443 | Shipping / Logistics | setReceiptLineWeight | `src/lib/services/logistics.ts:349` | UNTESTED | Not yet exercised |
| SERVICE-0444 | Shipping / Logistics | applyLandedCost | `src/lib/services/logistics.ts:370` | UNTESTED | Not yet exercised |
| SERVICE-0445 | Shipping / Logistics | getReceiptLandedTotals | `src/lib/services/logistics.ts:422` | UNTESTED | Not yet exercised |
| SERVICE-0446 | Shipping / Logistics | getUnappliedCharges | `src/lib/services/logistics.ts:436` | UNTESTED | Not yet exercised |
| SERVICE-0447 | Service / Assets | listEquipment | `src/lib/services/maintenance.ts:42` | PASS | maintenance listEquipment |
| SERVICE-0448 | Service / Assets | getEquipment | `src/lib/services/maintenance.ts:52` | UNTESTED | Not yet exercised |
| SERVICE-0449 | Service / Assets | createEquipment | `src/lib/services/maintenance.ts:63` | UNTESTED | Not yet exercised |
| SERVICE-0450 | Service / Assets | updateEquipment | `src/lib/services/maintenance.ts:108` | UNTESTED | Not yet exercised |
| SERVICE-0451 | Service / Assets | recordMeter | `src/lib/services/maintenance.ts:122` | UNTESTED | Not yet exercised |
| SERVICE-0452 | Service / Assets | addMaintenance | `src/lib/services/maintenance.ts:152` | UNTESTED | Not yet exercised |
| SERVICE-0453 | Service / Assets | completeMaintenance | `src/lib/services/maintenance.ts:180` | UNTESTED | Not yet exercised |
| SERVICE-0454 | Service / Assets | getMaintenanceDue | `src/lib/services/maintenance.ts:253` | PASS | maintenance getMaintenanceDue |
| SERVICE-0455 | Service / Assets | startDowntime | `src/lib/services/maintenance.ts:301` | UNTESTED | Not yet exercised |
| SERVICE-0456 | Service / Assets | endDowntime | `src/lib/services/maintenance.ts:325` | UNTESTED | Not yet exercised |
| SERVICE-0457 | Service / Assets | getDowntimePareto | `src/lib/services/maintenance.ts:351` | PASS | maintenance getDowntimePareto |
| SERVICE-0458 | Service / Assets | getAvailability | `src/lib/services/maintenance.ts:381` | PASS | maintenance getAvailability |
| SERVICE-0459 | Service / Assets | getMaintenanceSummary | `src/lib/services/maintenance.ts:420` | PASS | maintenance getMaintenanceSummary |
| SERVICE-0460 | Platform / Other | mfaConfigured | `src/lib/services/mfa.ts:51` | UNTESTED | Not yet exercised |
| SERVICE-0461 | Platform / Other | startEnrolment | `src/lib/services/mfa.ts:104` | UNTESTED | Not yet exercised |
| SERVICE-0462 | Platform / Other | confirmEnrolment | `src/lib/services/mfa.ts:135` | UNTESTED | Not yet exercised |
| SERVICE-0463 | Platform / Other | disableMfa | `src/lib/services/mfa.ts:175` | UNTESTED | Not yet exercised |
| SERVICE-0464 | Platform / Other | getMfaStatus | `src/lib/services/mfa.ts:211` | UNTESTED | Not yet exercised |
| SERVICE-0465 | Platform / Other | requiresMfa | `src/lib/services/mfa.ts:286` | UNTESTED | Not yet exercised |
| SERVICE-0466 | Platform / Other | createChallenge | `src/lib/services/mfa.ts:302` | UNTESTED | Not yet exercised |
| SERVICE-0467 | Platform / Other | verifyChallenge | `src/lib/services/mfa.ts:329` | UNTESTED | Not yet exercised |
| SERVICE-0468 | Platform / Other | purgeExpiredChallenges | `src/lib/services/mfa.ts:400` | UNTESTED | Not yet exercised |
| SERVICE-0469 | Platform / Other | isMissingTableError | `src/lib/services/module-health.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0470 | Platform / Other | checkModuleHealth | `src/lib/services/module-health.ts:29` | UNTESTED | Not yet exercised |
| SERVICE-0471 | Platform / Other | getNotificationSummary | `src/lib/services/notifications.ts:24` | UNTESTED | Not yet exercised |
| SERVICE-0472 | CRM / Sales | recordTrace | `src/lib/services/order-fulfillment.ts:7` | UNTESTED | Not yet exercised |
| SERVICE-0473 | CRM / Sales | getAvailableQty | `src/lib/services/order-fulfillment.ts:50` | UNTESTED | Not yet exercised |
| SERVICE-0474 | CRM / Sales | getAvailableInventory | `src/lib/services/order-fulfillment.ts:61` | UNTESTED | Not yet exercised |
| SERVICE-0475 | CRM / Sales | createSalesOrder | `src/lib/services/order-fulfillment.ts:105` | PASS | scripts/verify/chunk-c2-money-path.ts; scenario only; priority-results.json: PASS Invalid customer FK leaves no sales order or lines; priority-results.json: PASS Invalid second SO line rolls back entire header/lines |
| SERVICE-0476 | CRM / Sales | createQuote | `src/lib/services/order-fulfillment.ts:215` | UNTESTED | Not yet exercised |
| SERVICE-0477 | CRM / Sales | convertQuoteToSalesOrder | `src/lib/services/order-fulfillment.ts:285` | UNTESTED | Not yet exercised |
| SERVICE-0478 | CRM / Sales | planSalesOrderFulfillment | `src/lib/services/order-fulfillment.ts:367` | PASS | scripts/verify/chunk-c2-money-path.ts; scenario only; priority-results.json: PASS Plan linked SO creates production WO from existing certified BOM |
| SERVICE-0479 | CRM / Sales | checkBomMaterialAvailability | `src/lib/services/order-fulfillment.ts:736` | UNTESTED | Not yet exercised |
| SERVICE-0480 | CRM / Sales | planWorkOrderMaterials | `src/lib/services/order-fulfillment.ts:787` | PASS | priority-results.json: PASS WO materials readiness and kit action create |
| SERVICE-0481 | CRM / Sales | refreshWorkOrderMaterialReadiness | `src/lib/services/order-fulfillment.ts:967` | PASS | priority-results.json: PASS WO materials readiness and kit action create |
| SERVICE-0482 | CRM / Sales | refreshAllWaitingMaterial | `src/lib/services/order-fulfillment.ts:1028` | UNTESTED | Not yet exercised |
| SERVICE-0483 | CRM / Sales | captureReceivingPhotos | `src/lib/services/order-fulfillment.ts:1041` | UNTESTED | Not yet exercised |
| SERVICE-0484 | CRM / Sales | putAwayInventory | `src/lib/services/order-fulfillment.ts:1151` | UNTESTED | Not yet exercised |
| SERVICE-0485 | CRM / Sales | putAwayAllReceiving | `src/lib/services/order-fulfillment.ts:1265` | UNTESTED | Not yet exercised |
| SERVICE-0486 | CRM / Sales | createKitOrder | `src/lib/services/order-fulfillment.ts:1286` | UNTESTED | Not yet exercised |
| SERVICE-0487 | CRM / Sales | completeKitOrder | `src/lib/services/order-fulfillment.ts:1361` | FAIL | manufacturing-edge-results.json: FAIL Resume multi-line short kit does not duplicate already staged stock |
| SERVICE-0488 | CRM / Sales | startProductionFromKit | `src/lib/services/order-fulfillment.ts:1702` | UNTESTED | Not yet exercised |
| SERVICE-0489 | CRM / Sales | completeWorkOrderToStock | `src/lib/services/order-fulfillment.ts:1732` | FAIL | Task-only WO can complete without inventory part |
| SERVICE-0490 | CRM / Sales | syncSalesOrderReadyStatus | `src/lib/services/order-fulfillment.ts:1978` | UNTESTED | Not yet exercised |
| SERVICE-0491 | CRM / Sales | canShipNow | `src/lib/services/order-fulfillment.ts:2010` | UNTESTED | Not yet exercised |
| SERVICE-0492 | CRM / Sales | ensureShipmentForSalesOrder | `src/lib/services/order-fulfillment.ts:2050` | UNTESTED | Not yet exercised |
| SERVICE-0493 | CRM / Sales | createManualShipment | `src/lib/services/order-fulfillment.ts:2142` | UNTESTED | Not yet exercised |
| SERVICE-0494 | CRM / Sales | verifyShipmentPackingList | `src/lib/services/order-fulfillment.ts:2229` | PASS | scripts/verify/chunk-c2-money-path.ts; scenario only |
| SERVICE-0495 | CRM / Sales | packShipment | `src/lib/services/order-fulfillment.ts:2253` | PASS | scripts/verify/chunk-c2-money-path.ts; scenario only |
| SERVICE-0496 | CRM / Sales | issueManualShipmentInventory | `src/lib/services/order-fulfillment.ts:2295` | UNTESTED | Not yet exercised |
| SERVICE-0497 | CRM / Sales | shipSalesOrder | `src/lib/services/order-fulfillment.ts:2392` | PASS | scripts/verify/chunk-c2-money-path.ts; scenario only |
| SERVICE-0498 | CRM / Sales | getDigitalTraveler | `src/lib/services/order-fulfillment.ts:2676` | UNTESTED | Not yet exercised |
| SERVICE-0499 | Accounts / Roles | ensurePermissionCatalog | `src/lib/services/permissions.ts:12` | UNTESTED | Not yet exercised |
| SERVICE-0500 | Accounts / Roles | ensureDefaultPermissionGroups | `src/lib/services/permissions.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0501 | Accounts / Roles | listPermissionGroups | `src/lib/services/permissions.ts:152` | UNTESTED | Not yet exercised |
| SERVICE-0502 | Accounts / Roles | assignUserToGroup | `src/lib/services/permissions.ts:171` | UNTESTED | Not yet exercised |
| SERVICE-0503 | Accounts / Roles | removeUserFromGroup | `src/lib/services/permissions.ts:187` | UNTESTED | Not yet exercised |
| SERVICE-0504 | Accounts / Roles | grantUserPermission | `src/lib/services/permissions.ts:201` | UNTESTED | Not yet exercised |
| SERVICE-0505 | Accounts / Roles | createPermissionGroup | `src/lib/services/permissions.ts:227` | UNTESTED | Not yet exercised |
| SERVICE-0506 | Accounts / Roles | toggleGroupPermission | `src/lib/services/permissions.ts:255` | UNTESTED | Not yet exercised |
| SERVICE-0507 | Platform / Other | plaidEnabled | `src/lib/services/plaid.ts:25` | UNTESTED | Not yet exercised |
| SERVICE-0508 | Platform / Other | createLinkToken | `src/lib/services/plaid.ts:73` | UNTESTED | Not yet exercised |
| SERVICE-0509 | Platform / Other | exchangePublicToken | `src/lib/services/plaid.ts:102` | UNTESTED | Not yet exercised |
| SERVICE-0510 | Platform / Other | syncPlaidTransactions | `src/lib/services/plaid.ts:182` | UNTESTED | Not yet exercised |
| SERVICE-0511 | Platform / Other | syncAllPlaid | `src/lib/services/plaid.ts:295` | UNTESTED | Not yet exercised |
| SERVICE-0512 | PMO / Budgets | createProgram | `src/lib/services/pmo.ts:48` | UNTESTED | Not yet exercised |
| SERVICE-0513 | PMO / Budgets | updateProgram | `src/lib/services/pmo.ts:104` | UNTESTED | Not yet exercised |
| SERVICE-0514 | PMO / Budgets | addProgramClin | `src/lib/services/pmo.ts:169` | UNTESTED | Not yet exercised |
| SERVICE-0515 | PMO / Budgets | listPrograms | `src/lib/services/pmo.ts:203` | PASS | pmo listPrograms |
| SERVICE-0516 | PMO / Budgets | createProject | `src/lib/services/pmo.ts:228` | UNTESTED | Not yet exercised |
| SERVICE-0517 | PMO / Budgets | updateProjectCharter | `src/lib/services/pmo.ts:359` | UNTESTED | Not yet exercised |
| SERVICE-0518 | PMO / Budgets | addProjectRisk | `src/lib/services/pmo.ts:458` | UNTESTED | Not yet exercised |
| SERVICE-0519 | PMO / Budgets | updateProjectRisk | `src/lib/services/pmo.ts:498` | UNTESTED | Not yet exercised |
| SERVICE-0520 | PMO / Budgets | addProjectIssue | `src/lib/services/pmo.ts:531` | UNTESTED | Not yet exercised |
| SERVICE-0521 | PMO / Budgets | updateProjectIssue | `src/lib/services/pmo.ts:558` | UNTESTED | Not yet exercised |
| SERVICE-0522 | PMO / Budgets | upsertRaciEntry | `src/lib/services/pmo.ts:580` | UNTESTED | Not yet exercised |
| SERVICE-0523 | PMO / Budgets | deleteRaciEntry | `src/lib/services/pmo.ts:622` | UNTESTED | Not yet exercised |
| SERVICE-0524 | PMO / Budgets | addCommunication | `src/lib/services/pmo.ts:626` | UNTESTED | Not yet exercised |
| SERVICE-0525 | PMO / Budgets | deleteCommunication | `src/lib/services/pmo.ts:654` | UNTESTED | Not yet exercised |
| SERVICE-0526 | PMO / Budgets | addProjectTask | `src/lib/services/pmo.ts:660` | UNTESTED | Not yet exercised |
| SERVICE-0527 | PMO / Budgets | updateProjectTask | `src/lib/services/pmo.ts:698` | UNTESTED | Not yet exercised |
| SERVICE-0528 | PMO / Budgets | addProjectMilestone | `src/lib/services/pmo.ts:723` | UNTESTED | Not yet exercised |
| SERVICE-0529 | PMO / Budgets | updateProjectMilestone | `src/lib/services/pmo.ts:744` | UNTESTED | Not yet exercised |
| SERVICE-0530 | PMO / Budgets | saveWikiPage | `src/lib/services/pmo.ts:768` | UNTESTED | Not yet exercised |
| SERVICE-0531 | PMO / Budgets | deleteWikiPage | `src/lib/services/pmo.ts:812` | UNTESTED | Not yet exercised |
| SERVICE-0532 | PMO / Budgets | createPiIncrement | `src/lib/services/pmo.ts:818` | UNTESTED | Not yet exercised |
| SERVICE-0533 | PMO / Budgets | updatePiIncrement | `src/lib/services/pmo.ts:851` | UNTESTED | Not yet exercised |
| SERVICE-0534 | PMO / Budgets | addPiFeature | `src/lib/services/pmo.ts:871` | UNTESTED | Not yet exercised |
| SERVICE-0535 | PMO / Budgets | addCostEntry | `src/lib/services/pmo.ts:897` | UNTESTED | Not yet exercised |
| SERVICE-0536 | PMO / Budgets | recomputeProjectDevelopmentCost | `src/lib/services/pmo.ts:932` | UNTESTED | Not yet exercised |
| SERVICE-0537 | PMO / Budgets | recomputeProductDevelopmentCost | `src/lib/services/pmo.ts:946` | UNTESTED | Not yet exercised |
| SERVICE-0538 | PMO / Budgets | syncRequirementsToProduct | `src/lib/services/pmo.ts:973` | UNTESTED | Not yet exercised |
| SERVICE-0539 | PMO / Budgets | syncMilestonesToProduct | `src/lib/services/pmo.ts:1033` | UNTESTED | Not yet exercised |
| SERVICE-0540 | PMO / Budgets | addProjectRequirement | `src/lib/services/pmo.ts:1085` | UNTESTED | Not yet exercised |
| SERVICE-0541 | PMO / Budgets | linkProductToProject | `src/lib/services/pmo.ts:1120` | UNTESTED | Not yet exercised |
| SERVICE-0542 | PMO / Budgets | getProjectDetail | `src/lib/services/pmo.ts:1141` | UNTESTED | Not yet exercised |
| SERVICE-0543 | PMO / Budgets | listProjects | `src/lib/services/pmo.ts:1191` | PASS | pmo listProjects |
| SERVICE-0544 | PMO / Budgets | listPlanningQuarters | `src/lib/services/pmo.ts:1230` | PASS | pmo listPlanningQuarters |
| SERVICE-0545 | PMO / Budgets | createPlanningQuarter | `src/lib/services/pmo.ts:1242` | UNTESTED | Not yet exercised |
| SERVICE-0546 | PMO / Budgets | updatePlanningQuarter | `src/lib/services/pmo.ts:1270` | UNTESTED | Not yet exercised |
| SERVICE-0547 | PMO / Budgets | createPmoSprint | `src/lib/services/pmo.ts:1290` | UNTESTED | Not yet exercised |
| SERVICE-0548 | Purchasing / Receiving | amendPurchaseOrder | `src/lib/services/po-amend.ts:82` | UNTESTED | Not yet exercised |
| SERVICE-0549 | Purchasing / Receiving | decidePoAmendment | `src/lib/services/po-amend.ts:155` | UNTESTED | Not yet exercised |
| SERVICE-0550 | Purchasing / Receiving | listPoAmendmentsForUser | `src/lib/services/po-amend.ts:237` | UNTESTED | Not yet exercised |
| SERVICE-0551 | Purchasing / Receiving | updatePoDeliveryDates | `src/lib/services/po-amend.ts:292` | UNTESTED | Not yet exercised |
| SERVICE-0552 | Accounting / GovCon | roundMoney | `src/lib/services/posting-rules.ts:10` | UNTESTED | Not yet exercised |
| SERVICE-0553 | Accounting / GovCon | roundRate | `src/lib/services/posting-rules.ts:14` | UNTESTED | Not yet exercised |
| SERVICE-0554 | Accounting / GovCon | journalBalanceError | `src/lib/services/posting-rules.ts:21` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0555 | Accounting / GovCon | isPeriodLocked | `src/lib/services/posting-rules.ts:31` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0556 | Accounting / GovCon | journalApprovalBlock | `src/lib/services/posting-rules.ts:46` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0557 | Accounting / GovCon | netIncurred | `src/lib/services/posting-rules.ts:99` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0558 | Accounting / GovCon | allowablePoolCosts | `src/lib/services/posting-rules.ts:147` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0559 | Accounting / GovCon | actualIndirectRate | `src/lib/services/posting-rules.ts:156` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0560 | Accounting / GovCon | allocateIndirect | `src/lib/services/posting-rules.ts:164` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0561 | Accounting / GovCon | programOutlook | `src/lib/services/posting-rules.ts:174` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0562 | Accounting / GovCon | completionEntry | `src/lib/services/posting-rules.ts:209` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0563 | Accounting / GovCon | provisionalBilling | `src/lib/services/posting-rules.ts:252` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0564 | Accounting / GovCon | weekdayShortfalls | `src/lib/services/posting-rules.ts:287` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0565 | Accounting / GovCon | describeTimeEdits | `src/lib/services/posting-rules.ts:320` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0566 | Accounting / GovCon | gfpContractMatches | `src/lib/services/posting-rules.ts:380` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0567 | Purchasing / Receiving | getPrChargeSnapshot | `src/lib/services/pr-buyer.ts:7` | UNTESTED | Not yet exercised |
| SERVICE-0568 | Purchasing / Receiving | saveBuyerPackage | `src/lib/services/pr-buyer.ts:101` | UNTESTED | Not yet exercised |
| SERVICE-0569 | Purchasing / Receiving | assignPrBuyer | `src/lib/services/pr-buyer.ts:240` | UNTESTED | Not yet exercised |
| SERVICE-0570 | Purchasing / Receiving | ensureBuyerScanIn | `src/lib/services/pr-buyer.ts:307` | UNTESTED | Not yet exercised |
| SERVICE-0571 | Purchasing / Receiving | clockOutBuyerWork | `src/lib/services/pr-buyer.ts:351` | UNTESTED | Not yet exercised |
| SERVICE-0572 | Purchasing / Receiving | confirmBuyerPackageStep | `src/lib/services/pr-buyer.ts:474` | FAIL | priority-results.json: FAIL Same admin cannot sign demand AND buyer on same PR |
| SERVICE-0573 | Purchasing / Receiving | isBuyerPackageComplete | `src/lib/services/pr-buyer.ts:645` | UNTESTED | Not yet exercised |
| SERVICE-0574 | PLM / BOM / ECO | createProduct | `src/lib/services/products.ts:67` | UNTESTED | Not yet exercised |
| SERVICE-0575 | PLM / BOM / ECO | updateProduct | `src/lib/services/products.ts:213` | UNTESTED | Not yet exercised |
| SERVICE-0576 | PLM / BOM / ECO | advanceProductLifecycle | `src/lib/services/products.ts:384` | UNTESTED | Not yet exercised |
| SERVICE-0577 | PLM / BOM / ECO | addProductPart | `src/lib/services/products.ts:471` | UNTESTED | Not yet exercised |
| SERVICE-0578 | PLM / BOM / ECO | removeProductPart | `src/lib/services/products.ts:496` | UNTESTED | Not yet exercised |
| SERVICE-0579 | PLM / BOM / ECO | addProductDocument | `src/lib/services/products.ts:512` | UNTESTED | Not yet exercised |
| SERVICE-0580 | PLM / BOM / ECO | removeProductDocument | `src/lib/services/products.ts:541` | UNTESTED | Not yet exercised |
| SERVICE-0581 | PLM / BOM / ECO | addProductRequirement | `src/lib/services/products.ts:545` | UNTESTED | Not yet exercised |
| SERVICE-0582 | PLM / BOM / ECO | updateProductRequirement | `src/lib/services/products.ts:582` | UNTESTED | Not yet exercised |
| SERVICE-0583 | PLM / BOM / ECO | removeProductRequirement | `src/lib/services/products.ts:616` | UNTESTED | Not yet exercised |
| SERVICE-0584 | PLM / BOM / ECO | addProductVariant | `src/lib/services/products.ts:620` | UNTESTED | Not yet exercised |
| SERVICE-0585 | PLM / BOM / ECO | removeProductVariant | `src/lib/services/products.ts:651` | UNTESTED | Not yet exercised |
| SERVICE-0586 | PLM / BOM / ECO | addProductMilestone | `src/lib/services/products.ts:655` | UNTESTED | Not yet exercised |
| SERVICE-0587 | PLM / BOM / ECO | updateProductMilestone | `src/lib/services/products.ts:681` | UNTESTED | Not yet exercised |
| SERVICE-0588 | PLM / BOM / ECO | removeProductMilestone | `src/lib/services/products.ts:703` | UNTESTED | Not yet exercised |
| SERVICE-0589 | PLM / BOM / ECO | addProductMember | `src/lib/services/products.ts:707` | UNTESTED | Not yet exercised |
| SERVICE-0590 | PLM / BOM / ECO | removeProductMember | `src/lib/services/products.ts:723` | UNTESTED | Not yet exercised |
| SERVICE-0591 | PLM / BOM / ECO | listProducts | `src/lib/services/products.ts:727` | UNTESTED | Not yet exercised |
| SERVICE-0592 | PLM / BOM / ECO | getProductDetail | `src/lib/services/products.ts:773` | UNTESTED | Not yet exercised |
| SERVICE-0593 | PLM / BOM / ECO | productFieldsFromForm | `src/lib/services/products.ts:843` | UNTESTED | Not yet exercised |
| SERVICE-0594 | PMO / Budgets | getProgramFinancials | `src/lib/services/program-financials.ts:40` | UNTESTED | Not yet exercised |
| SERVICE-0595 | PMO / Budgets | booksIncurredByProgram | `src/lib/services/program-financials.ts:152` | PASS | program-financials booksIncurredByProgram |
| SERVICE-0596 | PMO / Budgets | computeIndirectRates | `src/lib/services/program-financials.ts:173` | PASS | program-financials computeIndirectRates |
| SERVICE-0597 | PMO / Budgets | jobCostRows | `src/lib/services/program-financials.ts:240` | PASS | program-financials jobCostRows |
| SERVICE-0598 | PMO / Budgets | laborDistributionRows | `src/lib/services/program-financials.ts:299` | PASS | program-financials laborDistributionRows |
| SERVICE-0599 | PMO / Budgets | wipValuationRows | `src/lib/services/program-financials.ts:338` | PASS | program-financials wipValuationRows |
| SERVICE-0600 | PMO / Budgets | reportProgramPl | `src/lib/services/program-financials.ts:386` | UNTESTED | Not yet exercised |
| SERVICE-0601 | PMO / Budgets | reportJobProfit | `src/lib/services/program-financials.ts:425` | UNTESTED | Not yet exercised |
| SERVICE-0602 | PMO / Budgets | reportWipBooks | `src/lib/services/program-financials.ts:462` | UNTESTED | Not yet exercised |
| SERVICE-0603 | PMO / Budgets | reportLaborDistribution | `src/lib/services/program-financials.ts:471` | UNTESTED | Not yet exercised |
| SERVICE-0604 | PMO / Budgets | reportIndirectRates | `src/lib/services/program-financials.ts:502` | UNTESTED | Not yet exercised |
| SERVICE-0605 | PMO / Budgets | reportUnallowables | `src/lib/services/program-financials.ts:525` | UNTESTED | Not yet exercised |
| SERVICE-0606 | PMO / Budgets | reportIce | `src/lib/services/program-financials.ts:568` | UNTESTED | Not yet exercised |
| SERVICE-0607 | PMO / Budgets | reportGlDetail | `src/lib/services/program-financials.ts:628` | UNTESTED | Not yet exercised |
| SERVICE-0608 | PMO / Budgets | submitProgramPolicyToCm | `src/lib/services/program-policy.ts:18` | UNTESTED | Not yet exercised |
| SERVICE-0609 | PMO / Budgets | linkExistingPolicy | `src/lib/services/program-policy.ts:51` | UNTESTED | Not yet exercised |
| SERVICE-0610 | PMO / Budgets | getProgramPolicy | `src/lib/services/program-policy.ts:68` | UNTESTED | Not yet exercised |
| SERVICE-0611 | PMO / Budgets | listPolicyCandidates | `src/lib/services/program-policy.ts:106` | UNTESTED | Not yet exercised |
| SERVICE-0612 | Purchasing / Receiving | prRequiresCatalogParts | `src/lib/services/purchase-requests.ts:30` | UNTESTED | Not yet exercised |
| SERVICE-0613 | Purchasing / Receiving | createStandalonePurchaseRequest | `src/lib/services/purchase-requests.ts:55` | PASS | finance-supply-results.json: PASS PR catalog validation rejects unknown/inactive parts before writes; finance-supply-results.json: PASS PR routing, buyer action, final approval and PO conversion actions |
| SERVICE-0614 | Purchasing / Receiving | submitDraftPurchaseRequest | `src/lib/services/purchase-requests.ts:276` | PASS | priority-results.json: PASS Standalone PR draft action + submission routes approvals |
| SERVICE-0615 | Quality / NCR | defaultIncidentSteps | `src/lib/services/quality-incidents.ts:14` | UNTESTED | Not yet exercised |
| SERVICE-0616 | Quality / NCR | linkCalToolToMrb | `src/lib/services/quality-incidents.ts:55` | UNTESTED | Not yet exercised |
| SERVICE-0617 | Quality / NCR | setCalToolDisposition | `src/lib/services/quality-incidents.ts:78` | UNTESTED | Not yet exercised |
| SERVICE-0618 | Quality / NCR | triggerIncidentFromMrb | `src/lib/services/quality-incidents.ts:104` | UNTESTED | Not yet exercised |
| SERVICE-0619 | Quality / NCR | logCounterfeitIncident | `src/lib/services/quality-incidents.ts:147` | UNTESTED | Not yet exercised |
| SERVICE-0620 | Quality / NCR | sendCounterfeitToMrb | `src/lib/services/quality-incidents.ts:182` | UNTESTED | Not yet exercised |
| SERVICE-0621 | Quality / NCR | updateIncidentSteps | `src/lib/services/quality-incidents.ts:220` | UNTESTED | Not yet exercised |
| SERVICE-0622 | Quality / NCR | setIncidentResult | `src/lib/services/quality-incidents.ts:224` | UNTESTED | Not yet exercised |
| SERVICE-0623 | Quality / NCR | mrbCasesForTools | `src/lib/services/quality-incidents.ts:230` | UNTESTED | Not yet exercised |
| SERVICE-0624 | Quality / NCR | ensureQualityPrograms | `src/lib/services/quality-programs.ts:31` | UNTESTED | Not yet exercised |
| SERVICE-0625 | Quality / NCR | statusFor | `src/lib/services/quality-programs.ts:59` | UNTESTED | Not yet exercised |
| SERVICE-0626 | Quality / NCR | refreshProgramStatuses | `src/lib/services/quality-programs.ts:69` | UNTESTED | Not yet exercised |
| SERVICE-0627 | Quality / NCR | getProgramByKey | `src/lib/services/quality-programs.ts:79` | UNTESTED | Not yet exercised |
| SERVICE-0628 | Quality / NCR | createQualityItem | `src/lib/services/quality-programs.ts:83` | UNTESTED | Not yet exercised |
| SERVICE-0629 | Quality / NCR | setItemStatus | `src/lib/services/quality-programs.ts:131` | UNTESTED | Not yet exercised |
| SERVICE-0630 | Quality / NCR | recordQualityEvent | `src/lib/services/quality-programs.ts:139` | UNTESTED | Not yet exercised |
| SERVICE-0631 | Quality / NCR | qualityComplianceSummary | `src/lib/services/quality-programs.ts:193` | PASS | quality-programs qualityComplianceSummary |
| SERVICE-0632 | Platform / Other | getRadiatorSlides | `src/lib/services/radiators.ts:28` | UNTESTED | Not yet exercised |
| SERVICE-0633 | Purchasing / Receiving | guideForReceivingInspection | `src/lib/services/receiving-station-guide.ts:28` | UNTESTED | Not yet exercised |
| SERVICE-0634 | Purchasing / Receiving | batchStationNextGuides | `src/lib/services/receiving-station-guide.ts:159` | UNTESTED | Not yet exercised |
| SERVICE-0635 | Purchasing / Receiving | defaultStationCode | `src/lib/services/receiving-time.ts:23` | UNTESTED | Not yet exercised |
| SERVICE-0636 | Purchasing / Receiving | scanIntoReceivingTraveler | `src/lib/services/receiving-time.ts:92` | UNTESTED | Not yet exercised |
| SERVICE-0637 | Purchasing / Receiving | scanOutOfReceivingTraveler | `src/lib/services/receiving-time.ts:162` | UNTESTED | Not yet exercised |
| SERVICE-0638 | Purchasing / Receiving | materialHandlerHasOpenWork | `src/lib/services/receiving-time.ts:273` | UNTESTED | Not yet exercised |
| SERVICE-0639 | Purchasing / Receiving | scanOutFamilyIfNoMhWork | `src/lib/services/receiving-time.ts:355` | UNTESTED | Not yet exercised |
| SERVICE-0640 | Purchasing / Receiving | deliverTravelerToStation | `src/lib/services/receiving-time.ts:414` | UNTESTED | Not yet exercised |
| SERVICE-0641 | Purchasing / Receiving | clearTravelerStation | `src/lib/services/receiving-time.ts:519` | UNTESTED | Not yet exercised |
| SERVICE-0642 | Purchasing / Receiving | stationAreaOf | `src/lib/services/receiving-time.ts:540` | UNTESTED | Not yet exercised |
| SERVICE-0643 | Purchasing / Receiving | inferDeliverArea | `src/lib/services/receiving-time.ts:555` | UNTESTED | Not yet exercised |
| SERVICE-0644 | Purchasing / Receiving | nextActionForTraveler | `src/lib/services/receiving-ui.ts:10` | UNTESTED | Not yet exercised |
| SERVICE-0645 | Purchasing / Receiving | stepperState | `src/lib/services/receiving-ui.ts:254` | UNTESTED | Not yet exercised |
| SERVICE-0646 | Purchasing / Receiving | listNextLabel | `src/lib/services/receiving-ui.ts:311` | UNTESTED | Not yet exercised |
| SERVICE-0647 | HR / Time | createRequisition | `src/lib/services/recruiting.ts:66` | UNTESTED | Not yet exercised |
| SERVICE-0648 | HR / Time | updateRequisitionStatus | `src/lib/services/recruiting.ts:107` | UNTESTED | Not yet exercised |
| SERVICE-0649 | HR / Time | addCandidate | `src/lib/services/recruiting.ts:120` | UNTESTED | Not yet exercised |
| SERVICE-0650 | HR / Time | moveCandidateStage | `src/lib/services/recruiting.ts:156` | UNTESTED | Not yet exercised |
| SERVICE-0651 | HR / Time | createOnboarding | `src/lib/services/recruiting.ts:208` | UNTESTED | Not yet exercised |
| SERVICE-0652 | HR / Time | updateOnboarding | `src/lib/services/recruiting.ts:251` | UNTESTED | Not yet exercised |
| SERVICE-0653 | HR / Time | setChecklistItem | `src/lib/services/recruiting.ts:263` | UNTESTED | Not yet exercised |
| SERVICE-0654 | HR / Time | completeOnboarding | `src/lib/services/recruiting.ts:297` | UNTESTED | Not yet exercised |
| SERVICE-0655 | HR / Time | recordBackgroundCheck | `src/lib/services/recruiting.ts:331` | UNTESTED | Not yet exercised |
| SERVICE-0656 | HR / Time | updateBackgroundCheck | `src/lib/services/recruiting.ts:373` | UNTESTED | Not yet exercised |
| SERVICE-0657 | Accounting / GovCon | computeNextRun | `src/lib/services/recurring-journals.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0658 | Accounting / GovCon | createRecurringJournal | `src/lib/services/recurring-journals.ts:53` | UNTESTED | Not yet exercised |
| SERVICE-0659 | Accounting / GovCon | setRecurringJournalActive | `src/lib/services/recurring-journals.ts:87` | UNTESTED | Not yet exercised |
| SERVICE-0660 | Accounting / GovCon | deleteRecurringJournal | `src/lib/services/recurring-journals.ts:110` | UNTESTED | Not yet exercised |
| SERVICE-0661 | Accounting / GovCon | listRecurringJournals | `src/lib/services/recurring-journals.ts:114` | UNTESTED | Not yet exercised |
| SERVICE-0662 | Accounting / GovCon | runDueRecurringJournals | `src/lib/services/recurring-journals.ts:159` | UNTESTED | Not yet exercised |
| SERVICE-0663 | Reports | runCustomReport | `src/lib/services/report-builder.ts:346` | UNTESTED | Not yet exercised |
| SERVICE-0664 | Reports | runReport | `src/lib/services/reports.ts:90` | PASS | Report ice run and CSV |
| SERVICE-0665 | Reports | toCsv | `src/lib/services/reports.ts:447` | PASS | Report ice run and CSV |
| SERVICE-0666 | PLM / BOM / ECO | createRequirement | `src/lib/services/requirements.ts:43` | UNTESTED | Not yet exercised |
| SERVICE-0667 | PLM / BOM / ECO | updateRequirementStatus | `src/lib/services/requirements.ts:106` | UNTESTED | Not yet exercised |
| SERVICE-0668 | PLM / BOM / ECO | linkRequirementToWork | `src/lib/services/requirements.ts:152` | UNTESTED | Not yet exercised |
| SERVICE-0669 | PLM / BOM / ECO | removeRequirementTrace | `src/lib/services/requirements.ts:203` | UNTESTED | Not yet exercised |
| SERVICE-0670 | PLM / BOM / ECO | getRequirementsBoard | `src/lib/services/requirements.ts:223` | UNTESTED | Not yet exercised |
| SERVICE-0671 | HR / Time | getReviewPolicy | `src/lib/services/review-cycles.ts:15` | UNTESTED | Not yet exercised |
| SERVICE-0672 | HR / Time | parseReviewQuestions | `src/lib/services/review-cycles.ts:34` | UNTESTED | Not yet exercised |
| SERVICE-0673 | HR / Time | saveReviewPolicy | `src/lib/services/review-cycles.ts:51` | UNTESTED | Not yet exercised |
| SERVICE-0674 | HR / Time | openDueReviewCycles | `src/lib/services/review-cycles.ts:105` | UNTESTED | Not yet exercised |
| SERVICE-0675 | HR / Time | submitSelfReview | `src/lib/services/review-cycles.ts:162` | UNTESTED | Not yet exercised |
| SERVICE-0676 | HR / Time | saveManagerReviewNotes | `src/lib/services/review-cycles.ts:202` | UNTESTED | Not yet exercised |
| SERVICE-0677 | HR / Time | signOffReview | `src/lib/services/review-cycles.ts:286` | UNTESTED | Not yet exercised |
| SERVICE-0678 | HR / Time | canViewPerson | `src/lib/services/review-cycles.ts:344` | UNTESTED | Not yet exercised |
| SERVICE-0679 | HR / Time | getPersonPage | `src/lib/services/review-cycles.ts:355` | UNTESTED | Not yet exercised |
| SERVICE-0680 | HR / Time | parseSelfRatings | `src/lib/services/review-cycles.ts:388` | UNTESTED | Not yet exercised |
| SERVICE-0681 | Service / Assets | lookupForRma | `src/lib/services/rma.ts:41` | UNTESTED | Not yet exercised |
| SERVICE-0682 | Service / Assets | createRmaRequest | `src/lib/services/rma.ts:86` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0683 | Service / Assets | issueRma | `src/lib/services/rma.ts:172` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0684 | Service / Assets | createRepairQuoteForRma | `src/lib/services/rma.ts:250` | UNTESTED | Not yet exercised |
| SERVICE-0685 | Service / Assets | acceptRepairQuote | `src/lib/services/rma.ts:310` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0686 | Service / Assets | createRepairWorkOrderFromRma | `src/lib/services/rma.ts:351` | UNTESTED | Not yet exercised |
| SERVICE-0687 | Service / Assets | updateRepairQuote | `src/lib/services/rma.ts:431` | UNTESTED | Not yet exercised |
| SERVICE-0688 | Service / Assets | adjustRmaQuotePrice | `src/lib/services/rma.ts:518` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0689 | Service / Assets | listRmas | `src/lib/services/rma.ts:588` | UNTESTED | Not yet exercised |
| SERVICE-0690 | Service / Assets | getRmaDetail | `src/lib/services/rma.ts:603` | UNTESTED | Not yet exercised |
| SERVICE-0691 | Planning / Scheduling | getPlanningSettings | `src/lib/services/schedule.ts:74` | PASS | schedule getPlanningSettings |
| SERVICE-0692 | Planning / Scheduling | savePlanningSettings | `src/lib/services/schedule.ts:93` | UNTESTED | Not yet exercised |
| SERVICE-0693 | Planning / Scheduling | isWorkingDay | `src/lib/services/schedule.ts:116` | UNTESTED | Not yet exercised |
| SERVICE-0694 | Planning / Scheduling | resolveMinutesPerDaySync | `src/lib/services/schedule.ts:127` | UNTESTED | Not yet exercised |
| SERVICE-0695 | Planning / Scheduling | resolveMinutesPerDay | `src/lib/services/schedule.ts:137` | UNTESTED | Not yet exercised |
| SERVICE-0696 | Planning / Scheduling | nextWorkingStart | `src/lib/services/schedule.ts:227` | UNTESTED | Not yet exercised |
| SERVICE-0697 | Planning / Scheduling | endOfWorkingDay | `src/lib/services/schedule.ts:242` | UNTESTED | Not yet exercised |
| SERVICE-0698 | Planning / Scheduling | subtractWorkingMinutes | `src/lib/services/schedule.ts:256` | UNTESTED | Not yet exercised |
| SERVICE-0699 | Planning / Scheduling | addWorkingMinutes | `src/lib/services/schedule.ts:297` | UNTESTED | Not yet exercised |
| SERVICE-0700 | Planning / Scheduling | workingMinutesBetween | `src/lib/services/schedule.ts:342` | UNTESTED | Not yet exercised |
| SERVICE-0701 | Planning / Scheduling | overlapWorkingHours | `src/lib/services/schedule.ts:383` | UNTESTED | Not yet exercised |
| SERVICE-0702 | Planning / Scheduling | computeEstimateFromSteps | `src/lib/services/schedule.ts:415` | UNTESTED | Not yet exercised |
| SERVICE-0703 | Planning / Scheduling | computeWorkOrderEstimate | `src/lib/services/schedule.ts:453` | UNTESTED | Not yet exercised |
| SERVICE-0704 | Planning / Scheduling | refreshWorkOrderEstimate | `src/lib/services/schedule.ts:506` | UNTESTED | Not yet exercised |
| SERVICE-0705 | Planning / Scheduling | estimateMinutesForWorkInstructions | `src/lib/services/schedule.ts:530` | UNTESTED | Not yet exercised |
| SERVICE-0706 | Planning / Scheduling | buildCalendarContext | `src/lib/services/schedule.ts:562` | UNTESTED | Not yet exercised |
| SERVICE-0707 | Planning / Scheduling | backSchedule | `src/lib/services/schedule.ts:584` | UNTESTED | Not yet exercised |
| SERVICE-0708 | Planning / Scheduling | forwardSchedule | `src/lib/services/schedule.ts:610` | UNTESTED | Not yet exercised |
| SERVICE-0709 | Planning / Scheduling | rescheduleWorkOrder | `src/lib/services/schedule.ts:640` | UNTESTED | Not yet exercised |
| SERVICE-0710 | Planning / Scheduling | resolveBuyLeadDays | `src/lib/services/schedule.ts:754` | UNTESTED | Not yet exercised |
| SERVICE-0711 | Planning / Scheduling | neededByFromLead | `src/lib/services/schedule.ts:780` | UNTESTED | Not yet exercised |
| SERVICE-0712 | Planning / Scheduling | defaultChildOffsetMinutes | `src/lib/services/schedule.ts:795` | UNTESTED | Not yet exercised |
| SERVICE-0713 | Planning / Scheduling | calendarDaysBetween | `src/lib/services/schedule.ts:803` | UNTESTED | Not yet exercised |
| SERVICE-0714 | Planning / Scheduling | bulkRescheduleOpenWorkOrders | `src/lib/services/schedule.ts:810` | UNTESTED | Not yet exercised |
| SERVICE-0715 | Planning / Scheduling | reportLabel | `src/lib/services/scheduled-reports.ts:22` | UNTESTED | Not yet exercised |
| SERVICE-0716 | Planning / Scheduling | createScheduledReport | `src/lib/services/scheduled-reports.ts:33` | UNTESTED | Not yet exercised |
| SERVICE-0717 | Planning / Scheduling | setScheduledReportActive | `src/lib/services/scheduled-reports.ts:60` | UNTESTED | Not yet exercised |
| SERVICE-0718 | Planning / Scheduling | deleteScheduledReport | `src/lib/services/scheduled-reports.ts:74` | UNTESTED | Not yet exercised |
| SERVICE-0719 | Planning / Scheduling | listScheduledReports | `src/lib/services/scheduled-reports.ts:78` | PASS | scheduled-reports listScheduledReports |
| SERVICE-0720 | Planning / Scheduling | runDueScheduledReports | `src/lib/services/scheduled-reports.ts:141` | UNTESTED | Not yet exercised |
| SERVICE-0721 | Manufacturing / Test | mintSerial | `src/lib/services/serials.ts:24` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0722 | Manufacturing / Test | ensureWorkOrderUnits | `src/lib/services/serials.ts:62` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0723 | Manufacturing / Test | assignUnitSerial | `src/lib/services/serials.ts:97` | UNTESTED | Not yet exercised |
| SERVICE-0724 | Manufacturing / Test | assignKitSerialToUnit | `src/lib/services/serials.ts:152` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0725 | Manufacturing / Test | listKitSerialPlan | `src/lib/services/serials.ts:221` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0726 | Manufacturing / Test | installSerial | `src/lib/services/serials.ts:234` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0727 | Manufacturing / Test | removeSerialInstall | `src/lib/services/serials.ts:319` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0728 | Manufacturing / Test | openMrbForTornDownSerial | `src/lib/services/serials.ts:387` | UNTESTED | Not yet exercised |
| SERVICE-0729 | Manufacturing / Test | getSerialTree | `src/lib/services/serials.ts:468` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0730 | Manufacturing / Test | build | `src/lib/services/serials.ts:480` | UNTESTED | Not yet exercised |
| SERVICE-0731 | Manufacturing / Test | whereUsedSerial | `src/lib/services/serials.ts:539` | UNTESTED | Not yet exercised |
| SERVICE-0732 | Manufacturing / Test | findSerial | `src/lib/services/serials.ts:557` | UNTESTED | Not yet exercised |
| SERVICE-0733 | Manufacturing / Test | listSerials | `src/lib/services/serials.ts:574` | UNTESTED | Not yet exercised |
| SERVICE-0734 | Manufacturing / Test | startWarranty | `src/lib/services/serials.ts:604` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0735 | Manufacturing / Test | evaluateWarranty | `src/lib/services/serials.ts:634` | PASS | scripts/verify/chunk-serials-rma.ts; scenario only |
| SERVICE-0736 | Inventory / Kitting | computeExpiry | `src/lib/services/shelf-life.ts:20` | UNTESTED | Not yet exercised |
| SERVICE-0737 | Inventory / Kitting | recordLot | `src/lib/services/shelf-life.ts:34` | UNTESTED | Not yet exercised |
| SERVICE-0738 | Inventory / Kitting | getExpiringLots | `src/lib/services/shelf-life.ts:102` | UNTESTED | Not yet exercised |
| SERVICE-0739 | Inventory / Kitting | getExpirySummary | `src/lib/services/shelf-life.ts:141` | UNTESTED | Not yet exercised |
| SERVICE-0740 | Inventory / Kitting | checkLotUsable | `src/lib/services/shelf-life.ts:156` | UNTESTED | Not yet exercised |
| SERVICE-0741 | Inventory / Kitting | quarantineExpiredLots | `src/lib/services/shelf-life.ts:176` | UNTESTED | Not yet exercised |
| SERVICE-0742 | Inventory / Kitting | getLotsForPart | `src/lib/services/shelf-life.ts:205` | UNTESTED | Not yet exercised |
| SERVICE-0743 | Accounts / Roles | verifySignaturePin | `src/lib/services/signature-pin.ts:8` | PASS | scripts/test-docs.ts; scenario only |
| SERVICE-0744 | Accounts / Roles | captureSignupLead | `src/lib/services/signup-lead.ts:16` | UNTESTED | Not yet exercised |
| SERVICE-0745 | Manufacturing / Test | listStockSerialsForParts | `src/lib/services/stock-serials.ts:4` | UNTESTED | Not yet exercised |
| SERVICE-0746 | Billing / Founding | buildIntroScheduleUpdate | `src/lib/services/stripe-intro.ts:14` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0747 | Billing / Founding | stripeEnabled | `src/lib/services/stripe.ts:46` | UNTESTED | Not yet exercised |
| SERVICE-0748 | Billing / Founding | priceIdForPlan | `src/lib/services/stripe.ts:58` | UNTESTED | Not yet exercised |
| SERVICE-0749 | Billing / Founding | firstYearPriceIdForPlan | `src/lib/services/stripe.ts:63` | UNTESTED | Not yet exercised |
| SERVICE-0750 | Billing / Founding | retrieveCheckoutSession | `src/lib/services/stripe.ts:165` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0751 | Billing / Founding | createCheckoutSession | `src/lib/services/stripe.ts:215` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0752 | Billing / Founding | createTrialCheckoutSession | `src/lib/services/stripe.ts:313` | UNTESTED | Not yet exercised |
| SERVICE-0753 | Billing / Founding | ensureIntroRenewalSchedule | `src/lib/services/stripe.ts:401` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0754 | Billing / Founding | verifyWebhook | `src/lib/services/stripe.ts:469` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0755 | Billing / Founding | handleWebhookEvent | `src/lib/services/stripe.ts:537` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0756 | Billing / Founding | owner | `src/lib/services/stripe.ts:552` | UNTESTED | Not yet exercised |
| SERVICE-0757 | Billing / Founding | membershipFor | `src/lib/services/stripe.ts:567` | UNTESTED | Not yet exercised |
| SERVICE-0758 | Billing / Founding | subscriptionIdForEvent | `src/lib/services/stripe.ts:632` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0759 | Billing / Founding | isFreeShop | `src/lib/services/subscription-plans.ts:140` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0760 | Billing / Founding | paidShopSeats | `src/lib/services/subscription-plans.ts:147` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0761 | Billing / Founding | getPlan | `src/lib/services/subscription-plans.ts:184` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0762 | Billing / Founding | isPerSeatPlan | `src/lib/services/subscription-plans.ts:188` | UNTESTED | Not yet exercised |
| SERVICE-0763 | Billing / Founding | normalizeSeats | `src/lib/services/subscription-plans.ts:194` | UNTESTED | Not yet exercised |
| SERVICE-0764 | Billing / Founding | formatPlanMoney | `src/lib/services/subscription-plans.ts:208` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0765 | Billing / Founding | priceCents | `src/lib/services/subscription-plans.ts:212` | UNTESTED | Not yet exercised |
| SERVICE-0766 | Billing / Founding | firstYearBillingCycles | `src/lib/services/subscription-plans.ts:220` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0767 | Billing / Founding | shopFirstYearMonthly | `src/lib/services/subscription-plans.ts:227` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0768 | Billing / Founding | firstYearPeriodPriceForPlan | `src/lib/services/subscription-plans.ts:239` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0769 | Billing / Founding | periodPriceForPlan | `src/lib/services/subscription-plans.ts:255` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0770 | Billing / Founding | annualPriceForPlan | `src/lib/services/subscription-plans.ts:267` | UNTESTED | Not yet exercised |
| SERVICE-0771 | Billing / Founding | planSeatsLabel | `src/lib/services/subscription-plans.ts:280` | UNTESTED | Not yet exercised |
| SERVICE-0772 | Billing / Founding | planPriceView | `src/lib/services/subscription-plans.ts:303` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0773 | Billing / Founding | firstYearOfferSummary | `src/lib/services/subscription-plans.ts:358` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0774 | Billing / Founding | pricingSectionLead | `src/lib/services/subscription-plans.ts:368` | UNTESTED | Not yet exercised |
| SERVICE-0775 | Billing / Founding | addBillingCycles | `src/lib/services/subscription-plans.ts:373` | UNTESTED | Not yet exercised |
| SERVICE-0776 | Billing / Founding | getSeatUsage | `src/lib/services/subscription.ts:83` | UNTESTED | Not yet exercised |
| SERVICE-0777 | Billing / Founding | assertSeatAvailableForInvite | `src/lib/services/subscription.ts:131` | UNTESTED | Not yet exercised |
| SERVICE-0778 | Billing / Founding | assertSeatAvailableForAccept | `src/lib/services/subscription.ts:184` | UNTESTED | Not yet exercised |
| SERVICE-0779 | Billing / Founding | getSubscriptionState | `src/lib/services/subscription.ts:242` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0780 | Billing / Founding | startTrial | `src/lib/services/subscription.ts:312` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0781 | Billing / Founding | activatePlan | `src/lib/services/subscription.ts:338` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0782 | Billing / Founding | cancelSubscription | `src/lib/services/subscription.ts:401` | PASS | scripts/test-founding-billing.ts; scenario only |
| SERVICE-0783 | Platform / Other | isSupportStaffRole | `src/lib/services/support.ts:46` | UNTESTED | Not yet exercised |
| SERVICE-0784 | Platform / Other | listSupportStaffNotifyEmails | `src/lib/services/support.ts:61` | UNTESTED | Not yet exercised |
| SERVICE-0785 | Platform / Other | notifySupportStaff | `src/lib/services/support.ts:82` | UNTESTED | Not yet exercised |
| SERVICE-0786 | Platform / Other | createSupportTicket | `src/lib/services/support.ts:189` | UNTESTED | Not yet exercised |
| SERVICE-0787 | Platform / Other | createGuestSupportTicket | `src/lib/services/support.ts:265` | UNTESTED | Not yet exercised |
| SERVICE-0788 | Platform / Other | listMySupportTickets | `src/lib/services/support.ts:345` | UNTESTED | Not yet exercised |
| SERVICE-0789 | Platform / Other | listSupportTicketsByGuestEmail | `src/lib/services/support.ts:357` | UNTESTED | Not yet exercised |
| SERVICE-0790 | Platform / Other | listAllSupportTickets | `src/lib/services/support.ts:370` | UNTESTED | Not yet exercised |
| SERVICE-0791 | Platform / Other | countOpenSupportForStaff | `src/lib/services/support.ts:401` | UNTESTED | Not yet exercised |
| SERVICE-0792 | Platform / Other | countUnreadRepliesForUser | `src/lib/services/support.ts:410` | UNTESTED | Not yet exercised |
| SERVICE-0793 | Platform / Other | getSupportTicket | `src/lib/services/support.ts:422` | UNTESTED | Not yet exercised |
| SERVICE-0794 | Platform / Other | getSupportTicketByGuestToken | `src/lib/services/support.ts:446` | UNTESTED | Not yet exercised |
| SERVICE-0795 | Platform / Other | canAccessTicket | `src/lib/services/support.ts:463` | UNTESTED | Not yet exercised |
| SERVICE-0796 | Platform / Other | postSupportMessage | `src/lib/services/support.ts:473` | UNTESTED | Not yet exercised |
| SERVICE-0797 | Platform / Other | addSupportNote | `src/lib/services/support.ts:570` | UNTESTED | Not yet exercised |
| SERVICE-0798 | Platform / Other | updateSupportTicket | `src/lib/services/support.ts:606` | UNTESTED | Not yet exercised |
| SERVICE-0799 | Platform / Other | listPlatformAdmins | `src/lib/services/support.ts:689` | UNTESTED | Not yet exercised |
| SERVICE-0800 | Platform / Other | isTypingActive | `src/lib/services/support.ts:699` | UNTESTED | Not yet exercised |
| SERVICE-0801 | Platform / Other | setSupportTyping | `src/lib/services/support.ts:705` | UNTESTED | Not yet exercised |
| SERVICE-0802 | Platform / Other | markSupportThreadRead | `src/lib/services/support.ts:736` | UNTESTED | Not yet exercised |
| SERVICE-0803 | Accounting / GovCon | getTaxYear | `src/lib/services/tax-tables.ts:119` | UNTESTED | Not yet exercised |
| SERVICE-0804 | Accounting / GovCon | annualIncomeTax | `src/lib/services/tax-tables.ts:126` | UNTESTED | Not yet exercised |
| SERVICE-0805 | Accounting / GovCon | computeFederalWithholding | `src/lib/services/tax-tables.ts:149` | UNTESTED | Not yet exercised |
| SERVICE-0806 | Accounting / GovCon | computeFica | `src/lib/services/tax-tables.ts:188` | UNTESTED | Not yet exercised |
| SERVICE-0807 | Platform / Other | recordEvent | `src/lib/services/telemetry.ts:67` | UNTESTED | Not yet exercised |
| SERVICE-0808 | Platform / Other | trackEvent | `src/lib/services/telemetry.ts:96` | UNTESTED | Not yet exercised |
| SERVICE-0809 | Platform / Other | getTelemetryHealth | `src/lib/services/telemetry.ts:114` | UNTESTED | Not yet exercised |
| SERVICE-0810 | Platform / Other | getDemoFunnel | `src/lib/services/telemetry.ts:154` | UNTESTED | Not yet exercised |
| SERVICE-0811 | Platform / Other | getTopPages | `src/lib/services/telemetry.ts:199` | UNTESTED | Not yet exercised |
| SERVICE-0812 | Platform / Other | getTopActions | `src/lib/services/telemetry.ts:217` | UNTESTED | Not yet exercised |
| SERVICE-0813 | Platform / Other | issueFingerprint | `src/lib/services/telemetry.ts:270` | UNTESTED | Not yet exercised |
| SERVICE-0814 | Platform / Other | getErrorGroups | `src/lib/services/telemetry.ts:308` | UNTESTED | Not yet exercised |
| SERVICE-0815 | Platform / Other | getIssueTrackingHealth | `src/lib/services/telemetry.ts:415` | UNTESTED | Not yet exercised |
| SERVICE-0816 | Platform / Other | setIssueStatus | `src/lib/services/telemetry.ts:427` | UNTESTED | Not yet exercised |
| SERVICE-0817 | Platform / Other | getIssueHistories | `src/lib/services/telemetry.ts:502` | UNTESTED | Not yet exercised |
| SERVICE-0818 | Platform / Other | getLiveDemos | `src/lib/services/telemetry.ts:566` | UNTESTED | Not yet exercised |
| SERVICE-0819 | Platform / Other | getDailyStarts | `src/lib/services/telemetry.ts:606` | UNTESTED | Not yet exercised |
| SERVICE-0820 | Demo / Tenancy | applyHardening | `src/lib/services/tenancy.ts:121` | UNTESTED | Not yet exercised |
| SERVICE-0821 | Demo / Tenancy | provisionSchema | `src/lib/services/tenancy.ts:129` | UNTESTED | Not yet exercised |
| SERVICE-0822 | Demo / Tenancy | dropSchema | `src/lib/services/tenancy.ts:149` | PASS | demo-results.json: PASS Demo invalid schema names and public clone/drop protected |
| SERVICE-0823 | Demo / Tenancy | createTenant | `src/lib/services/tenancy.ts:164` | UNTESTED | Not yet exercised |
| SERVICE-0824 | Demo / Tenancy | getTenantBySchema | `src/lib/services/tenancy.ts:202` | PASS | demo-results.json: PASS Provision demo registry/schema and read isolated seeded records |
| SERVICE-0825 | Demo / Tenancy | touchTenant | `src/lib/services/tenancy.ts:208` | PASS | demo-results.json: PASS Demo heartbeat and destroy preserve public and mark registry |
| SERVICE-0826 | Demo / Tenancy | destroyTenant | `src/lib/services/tenancy.ts:216` | PASS | demo-results.json: PASS Demo heartbeat and destroy preserve public and mark registry |
| SERVICE-0827 | Demo / Tenancy | sweepIdleDemos | `src/lib/services/tenancy.ts:224` | PASS | demo-results.json: PASS Idle demo sweep removes only expired demo |
| SERVICE-0828 | Demo / Tenancy | demoSchemaIsLive | `src/lib/services/tenancy.ts:256` | PASS | demo-results.json: PASS Provision demo registry/schema and read isolated seeded records; demo-results.json: PASS Demo heartbeat and destroy preserve public and mark registry |
| SERVICE-0829 | Demo / Tenancy | tenantClient | `src/lib/services/tenancy.ts:269` | PASS | demo-results.json: PASS Provision demo registry/schema and read isolated seeded records |
| SERVICE-0830 | Demo / Tenancy | demoTemplateExists | `src/lib/services/tenancy.ts:280` | PASS | demo-results.json: PASS Local demo_template clone and template existence |
| SERVICE-0831 | Demo / Tenancy | cloneSchema | `src/lib/services/tenancy.ts:294` | PASS | demo-results.json: PASS Demo invalid schema names and public clone/drop protected; demo-results.json: PASS Local demo_template clone and template existence |
| SERVICE-0832 | Demo / Tenancy | demoPoolTarget | `src/lib/services/tenancy.ts:386` | PASS | round2-demo-results.json: PASS Demo pool warm and sequential refill honor target |
| SERVICE-0833 | Demo / Tenancy | demoIdleMinutes | `src/lib/services/tenancy.ts:442` | UNTESTED | Not yet exercised |
| SERVICE-0834 | Demo / Tenancy | warmOneDemo | `src/lib/services/tenancy.ts:448` | PASS | round2-demo-results.json: PASS Demo pool warm and sequential refill honor target |
| SERVICE-0835 | Demo / Tenancy | ensureDemoPool | `src/lib/services/tenancy.ts:490` | FAIL | round2-demo-results.json: PASS Demo pool warm and sequential refill honor target; round2-demo-results.json: FAIL Concurrent refills cannot exceed configured spare target |
| SERVICE-0836 | Demo / Tenancy | recycleStalePool | `src/lib/services/tenancy.ts:522` | PASS | round2-demo-results.json: PASS Recycle stale READY schemas preserves active and public fixtures |
| SERVICE-0837 | Demo / Tenancy | provisionDemo | `src/lib/services/tenancy.ts:577` | PASS | demo-results.json: PASS Provision demo registry/schema and read isolated seeded records; round2-demo-results.json: PASS Concurrent pool claims never share schema, exhausted pool cold-starts |
| SERVICE-0838 | Demo / Tenancy | provisionCustomerTenant | `src/lib/services/tenancy.ts:628` | UNTESTED | Not yet exercised |
| SERVICE-0839 | Demo / Tenancy | registerTenantLogin | `src/lib/services/tenancy.ts:788` | UNTESTED | Not yet exercised |
| SERVICE-0840 | Demo / Tenancy | issueOnboardingLink | `src/lib/services/tenancy.ts:809` | UNTESTED | Not yet exercised |
| SERVICE-0841 | Demo / Tenancy | tenantBySetupToken | `src/lib/services/tenancy.ts:826` | UNTESTED | Not yet exercised |
| SERVICE-0842 | Demo / Tenancy | clearSetupToken | `src/lib/services/tenancy.ts:838` | UNTESTED | Not yet exercised |
| SERVICE-0843 | Demo / Tenancy | tenantByStripe | `src/lib/services/tenancy.ts:848` | UNTESTED | Not yet exercised |
| SERVICE-0844 | Platform / Other | deriveClaim | `src/lib/services/tenant-activity.ts:50` | PASS | scripts/smoke-unit.ts; scenario only |
| SERVICE-0845 | Platform / Other | loadTenantActivity | `src/lib/services/tenant-activity.ts:132` | UNTESTED | Not yet exercised |
| SERVICE-0846 | Platform / Other | loadTenantActivities | `src/lib/services/tenant-activity.ts:178` | UNTESTED | Not yet exercised |
| SERVICE-0847 | Platform / Other | worker | `src/lib/services/tenant-activity.ts:184` | UNTESTED | Not yet exercised |
| SERVICE-0848 | Manufacturing / Test | createTestProcedure | `src/lib/services/test-procedures.ts:11` | UNTESTED | Not yet exercised |
| SERVICE-0849 | Manufacturing / Test | addTestProcedureStep | `src/lib/services/test-procedures.ts:74` | UNTESTED | Not yet exercised |
| SERVICE-0850 | Manufacturing / Test | submitTestProcedureToCm | `src/lib/services/test-procedures.ts:107` | UNTESTED | Not yet exercised |
| SERVICE-0851 | Manufacturing / Test | releaseTestProcedure | `src/lib/services/test-procedures.ts:176` | UNTESTED | Not yet exercised |
| SERVICE-0852 | Manufacturing / Test | listTestProcedures | `src/lib/services/test-procedures.ts:275` | UNTESTED | Not yet exercised |
| SERVICE-0853 | Manufacturing / Test | getTestProcedureDetail | `src/lib/services/test-procedures.ts:285` | UNTESTED | Not yet exercised |
| SERVICE-0854 | Manufacturing / Test | recordTestStepSignOff | `src/lib/services/test-procedures.ts:306` | UNTESTED | Not yet exercised |
| SERVICE-0855 | HR / Time | getPayrollPolicy | `src/lib/services/timesheets.ts:48` | UNTESTED | Not yet exercised |
| SERVICE-0856 | HR / Time | parseHolidays | `src/lib/services/timesheets.ts:56` | UNTESTED | Not yet exercised |
| SERVICE-0857 | HR / Time | periodForDate | `src/lib/services/timesheets.ts:83` | UNTESTED | Not yet exercised |
| SERVICE-0858 | HR / Time | periodDays | `src/lib/services/timesheets.ts:126` | UNTESTED | Not yet exercised |
| SERVICE-0859 | HR / Time | getOrCreateTimesheet | `src/lib/services/timesheets.ts:144` | UNTESTED | Not yet exercised |
| SERVICE-0860 | HR / Time | pushApprovedPtoToTimesheets | `src/lib/services/timesheets.ts:272` | UNTESTED | Not yet exercised |
| SERVICE-0861 | HR / Time | addTimesheetEntry | `src/lib/services/timesheets.ts:291` | UNTESTED | Not yet exercised |
| SERVICE-0862 | HR / Time | attachEntryToTimesheet | `src/lib/services/timesheets.ts:350` | UNTESTED | Not yet exercised |
| SERVICE-0863 | HR / Time | removeTimesheetEntry | `src/lib/services/timesheets.ts:367` | UNTESTED | Not yet exercised |
| SERVICE-0864 | HR / Time | submitTimesheet | `src/lib/services/timesheets.ts:384` | UNTESTED | Not yet exercised |
| SERVICE-0865 | HR / Time | classifyHours | `src/lib/services/timesheets.ts:478` | UNTESTED | Not yet exercised |
| SERVICE-0866 | HR / Time | saveTimecardGrid | `src/lib/services/timesheets.ts:530` | UNTESTED | Not yet exercised |
| SERVICE-0867 | HR / Time | decideTimesheetApproval | `src/lib/services/timesheets.ts:936` | UNTESTED | Not yet exercised |
| SERVICE-0868 | HR / Time | getTimecardReviewQueue | `src/lib/services/timesheets.ts:1013` | UNTESTED | Not yet exercised |
| SERVICE-0869 | HR / Time | decideReviewerBucketsForTimesheet | `src/lib/services/timesheets.ts:1065` | UNTESTED | Not yet exercised |
| SERVICE-0870 | HR / Time | processTimesheet | `src/lib/services/timesheets.ts:1103` | UNTESTED | Not yet exercised |
| SERVICE-0871 | HR / Time | getPayStub | `src/lib/services/timesheets.ts:1258` | UNTESTED | Not yet exercised |
| SERVICE-0872 | HR / Time | getPayrollRun | `src/lib/services/timesheets.ts:1314` | UNTESTED | Not yet exercised |
| SERVICE-0873 | HR / Time | runPayroll | `src/lib/services/timesheets.ts:1416` | UNTESTED | Not yet exercised |
| SERVICE-0874 | HR / Time | getTimesheetDetail | `src/lib/services/timesheets.ts:1431` | UNTESTED | Not yet exercised |
| SERVICE-0875 | HR / Time | listMyTimesheets | `src/lib/services/timesheets.ts:1453` | UNTESTED | Not yet exercised |
| SERVICE-0876 | HR / Time | getPtoBalances | `src/lib/services/timesheets.ts:1466` | UNTESTED | Not yet exercised |
| SERVICE-0877 | Quality / NCR | createToolbox | `src/lib/services/tool-control.ts:17` | UNTESTED | Not yet exercised |
| SERVICE-0878 | Quality / NCR | assignToolToToolbox | `src/lib/services/tool-control.ts:42` | UNTESTED | Not yet exercised |
| SERVICE-0879 | Quality / NCR | listToolboxes | `src/lib/services/tool-control.ts:54` | UNTESTED | Not yet exercised |
| SERVICE-0880 | Quality / NCR | saveToolboxInspection | `src/lib/services/tool-control.ts:69` | UNTESTED | Not yet exercised |
| SERVICE-0881 | Quality / NCR | createToolReport | `src/lib/services/tool-control.ts:90` | UNTESTED | Not yet exercised |
| SERVICE-0882 | Quality / NCR | updateToolReportPieces | `src/lib/services/tool-control.ts:164` | UNTESTED | Not yet exercised |
| SERVICE-0883 | Quality / NCR | declarePieceUnrecoverable | `src/lib/services/tool-control.ts:181` | UNTESTED | Not yet exercised |
| SERVICE-0884 | Quality / NCR | raiseFodIncident | `src/lib/services/tool-control.ts:201` | UNTESTED | Not yet exercised |
| SERVICE-0885 | Quality / NCR | placeReplacementPr | `src/lib/services/tool-control.ts:218` | UNTESTED | Not yet exercised |
| SERVICE-0886 | Quality / NCR | updateToolReportSteps | `src/lib/services/tool-control.ts:239` | UNTESTED | Not yet exercised |
| SERVICE-0887 | Quality / NCR | setToolReportStatus | `src/lib/services/tool-control.ts:243` | UNTESTED | Not yet exercised |
| SERVICE-0888 | Quality / NCR | parseJson | `src/lib/services/tool-control.ts:258` | UNTESTED | Not yet exercised |
| SERVICE-0889 | Platform / Other | base32Encode | `src/lib/services/totp.ts:30` | UNTESTED | Not yet exercised |
| SERVICE-0890 | Platform / Other | base32Decode | `src/lib/services/totp.ts:46` | UNTESTED | Not yet exercised |
| SERVICE-0891 | Platform / Other | generateSecret | `src/lib/services/totp.ts:65` | UNTESTED | Not yet exercised |
| SERVICE-0892 | Platform / Other | currentStep | `src/lib/services/totp.ts:71` | UNTESTED | Not yet exercised |
| SERVICE-0893 | Platform / Other | codeForStep | `src/lib/services/totp.ts:76` | UNTESTED | Not yet exercised |
| SERVICE-0894 | Platform / Other | verifyCode | `src/lib/services/totp.ts:107` | UNTESTED | Not yet exercised |
| SERVICE-0895 | Platform / Other | otpauthUri | `src/lib/services/totp.ts:132` | UNTESTED | Not yet exercised |
| SERVICE-0896 | Platform / Other | getWoMaterialGenealogy | `src/lib/services/traceability.ts:24` | UNTESTED | Not yet exercised |
| SERVICE-0897 | Platform / Other | getTraceChain | `src/lib/services/traceability.ts:127` | UNTESTED | Not yet exercised |
| SERVICE-0898 | Platform / Other | resolveStagingLocation | `src/lib/services/wip-locations.ts:17` | UNTESTED | Not yet exercised |
| SERVICE-0899 | Platform / Other | moveWorkOrderToLocation | `src/lib/services/wip-locations.ts:56` | UNTESTED | Not yet exercised |
| SERVICE-0900 | Platform / Other | consumeWorkOrderWip | `src/lib/services/wip-locations.ts:157` | UNTESTED | Not yet exercised |
| SERVICE-0901 | Manufacturing / Test | createToolPurchaseRequestForWi | `src/lib/services/work-instructions.ts:96` | UNTESTED | Not yet exercised |
| SERVICE-0902 | Manufacturing / Test | createWorkInstruction | `src/lib/services/work-instructions.ts:206` | UNTESTED | Not yet exercised |
| SERVICE-0903 | Manufacturing / Test | addWorkInstructionStep | `src/lib/services/work-instructions.ts:307` | UNTESTED | Not yet exercised |
| SERVICE-0904 | Manufacturing / Test | submitWiToCm | `src/lib/services/work-instructions.ts:347` | UNTESTED | Not yet exercised |
| SERVICE-0905 | Manufacturing / Test | releaseWorkInstructionFromCm | `src/lib/services/work-instructions.ts:446` | UNTESTED | Not yet exercised |
| SERVICE-0906 | Manufacturing / Test | createWiRevisionFromReleased | `src/lib/services/work-instructions.ts:515` | UNTESTED | Not yet exercised |
| SERVICE-0907 | Manufacturing / Test | linkWiToBom | `src/lib/services/work-instructions.ts:613` | UNTESTED | Not yet exercised |
| SERVICE-0908 | Manufacturing / Test | workOrderPrefix | `src/lib/services/work-orders.ts:19` | UNTESTED | Not yet exercised |
| SERVICE-0909 | Manufacturing / Test | resolveWorkOrderSource | `src/lib/services/work-orders.ts:32` | UNTESTED | Not yet exercised |
| SERVICE-0910 | Manufacturing / Test | createWorkOrder | `src/lib/services/work-orders.ts:68` | FAIL | Production WO without any BOM must be rejected |
| SERVICE-0911 | Manufacturing / Test | ensureWorkOrderTravelerSteps | `src/lib/services/work-orders.ts:349` | UNTESTED | Not yet exercised |
| SERVICE-0912 | Manufacturing / Test | startWorkOrderProduction | `src/lib/services/work-orders.ts:450` | PASS | scripts/verify/chunk-e-mfg.ts; scenario only; priority-results.json: PASS Start kitted production and sign traveler via own PIN actions |
| SERVICE-0913 | Manufacturing / Test | updateWorkOrderStatus | `src/lib/services/work-orders.ts:523` | UNTESTED | Not yet exercised |
| SERVICE-0914 | Manufacturing / Test | signOffStep | `src/lib/services/work-orders.ts:569` | UNTESTED | Not yet exercised |
| SERVICE-0915 | Manufacturing / Test | stationOf | `src/lib/services/work-orders.ts:671` | UNTESTED | Not yet exercised |
| SERVICE-0916 | Manufacturing / Test | ensurePrototypeWorkInstruction | `src/lib/services/work-orders.ts:860` | UNTESTED | Not yet exercised |
| SERVICE-0917 | Manufacturing / Test | finishPrototypeWorkOrder | `src/lib/services/work-orders.ts:931` | UNTESTED | Not yet exercised |
| SERVICE-0918 | Manufacturing / Test | defaultReceivingWorkCenterCode | `src/lib/services/work-orders.ts:1039` | UNTESTED | Not yet exercised |
| SERVICE-0919 | Manufacturing / Test | sendWorkOrderToReceivingPutaway | `src/lib/services/work-orders.ts:1065` | UNTESTED | Not yet exercised |
| SERVICE-0920 | Manufacturing / Test | getFloorBoardData | `src/lib/services/work-orders.ts:1134` | UNTESTED | Not yet exercised |
| SERVICE-0921 | Platform / Other | getSiteUrl | `src/lib/site.ts:43` | UNTESTED | Not yet exercised |
| SERVICE-0922 | Platform / Other | getTabBrand | `src/lib/tab-brand.ts:18` | UNTESTED | Not yet exercised |
| SERVICE-0923 | Platform / Other | cn | `src/lib/utils.ts:5` | UNTESTED | Not yet exercised |
| SERVICE-0924 | Platform / Other | formatCurrency | `src/lib/utils.ts:9` | UNTESTED | Not yet exercised |
| SERVICE-0925 | Platform / Other | compactCurrency | `src/lib/utils.ts:19` | UNTESTED | Not yet exercised |
| SERVICE-0926 | Platform / Other | formatNumber | `src/lib/utils.ts:28` | UNTESTED | Not yet exercised |
| SERVICE-0927 | Platform / Other | formatPercent | `src/lib/utils.ts:34` | UNTESTED | Not yet exercised |
| SERVICE-0928 | Platform / Other | formatDate | `src/lib/utils.ts:38` | UNTESTED | Not yet exercised |
| SERVICE-0929 | Platform / Other | formatRelative | `src/lib/utils.ts:48` | UNTESTED | Not yet exercised |
| SERVICE-0930 | Platform / Other | statusColor | `src/lib/utils.ts:55` | UNTESTED | Not yet exercised |
| SERVICE-0931 | Platform / Other | priorityColor | `src/lib/utils.ts:177` | UNTESTED | Not yet exercised |
| SERVICE-0932 | Platform / Other | scoreRatingColor | `src/lib/utils.ts:181` | UNTESTED | Not yet exercised |
| SERVICE-0933 | Platform / Other | computeEvm | `src/lib/utils.ts:192` | UNTESTED | Not yet exercised |
| SERVICE-0934 | Platform / Other | parseJsonArray | `src/lib/utils.ts:200` | UNTESTED | Not yet exercised |
| SERVICE-0935 | Platform / Other | slugify | `src/lib/utils.ts:209` | UNTESTED | Not yet exercised |
| SERVICE-0936 | Platform / Other | isGfpLocation | `src/lib/utils.ts:214` | UNTESTED | Not yet exercised |
| SERVICE-0937 | Platform / Other | isWorkArea | `src/lib/work-areas.ts:11` | UNTESTED | Not yet exercised |

### MODEL checklist

| ID | Module | Function / route / model | Source | Status | Evidence / next step |
|---|---|---|---|---|---|
| MODEL-0001 | Data models | User | `prisma/schema.prisma:19` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0002 | Data models | AuditLog | `prisma/schema.prisma:132` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0003 | Data models | Approval | `prisma/schema.prisma:149` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0004 | Data models | ApprovalPolicy | `prisma/schema.prisma:170` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0005 | Data models | ApprovalPolicyStep | `prisma/schema.prisma:184` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0006 | Data models | UomUnit | `prisma/schema.prisma:218` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0007 | Data models | UomConversion | `prisma/schema.prisma:234` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0008 | Data models | Part | `prisma/schema.prisma:247` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0009 | Data models | PartVendor | `prisma/schema.prisma:343` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0010 | Data models | BomHeader | `prisma/schema.prisma:368` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0011 | Data models | BomLine | `prisma/schema.prisma:400` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0012 | Data models | WorkInstruction | `prisma/schema.prisma:420` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0013 | Data models | TestProcedure | `prisma/schema.prisma:470` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0014 | Data models | TestProcedureSignOff | `prisma/schema.prisma:509` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0015 | Data models | TestProcedureStep | `prisma/schema.prisma:531` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0016 | Data models | WorkInstructionStep | `prisma/schema.prisma:548` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0017 | Data models | WorkInstructionSignOff | `prisma/schema.prisma:590` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0018 | Data models | WorkOrder | `prisma/schema.prisma:611` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0019 | Data models | Forecast | `prisma/schema.prisma:733` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0020 | Data models | ForecastLine | `prisma/schema.prisma:754` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0021 | Data models | Budget | `prisma/schema.prisma:773` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0022 | Data models | BudgetForecast | `prisma/schema.prisma:839` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0023 | Data models | BudgetCharge | `prisma/schema.prisma:852` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0024 | Data models | MaterialRequisition | `prisma/schema.prisma:881` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0025 | Data models | MaterialRequisitionLine | `prisma/schema.prisma:903` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0026 | Data models | WorkOrderInstruction | `prisma/schema.prisma:937` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0027 | Data models | WorkOrderStepCompletion | `prisma/schema.prisma:946` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0028 | Data models | WorkOrderStatusHistory | `prisma/schema.prisma:967` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0029 | Data models | ChangeRequest | `prisma/schema.prisma:982` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0030 | Data models | ChangeRequestComment | `prisma/schema.prisma:1059` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0031 | Data models | CmBoardMember | `prisma/schema.prisma:1073` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0032 | Data models | CmFolder | `prisma/schema.prisma:1085` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0033 | Data models | CmDocument | `prisma/schema.prisma:1122` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0034 | Data models | CmNumberScheme | `prisma/schema.prisma:1176` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0035 | Data models | CmNumberRequest | `prisma/schema.prisma:1209` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0036 | Data models | CmNumberRegistry | `prisma/schema.prisma:1249` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0037 | Data models | Product | `prisma/schema.prisma:1289` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0038 | Data models | ProductLifecycleEvent | `prisma/schema.prisma:1393` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0039 | Data models | ProductMember | `prisma/schema.prisma:1408` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0040 | Data models | ProductPart | `prisma/schema.prisma:1424` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0041 | Data models | ProductDocument | `prisma/schema.prisma:1441` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0042 | Data models | ProductVariant | `prisma/schema.prisma:1463` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0043 | Data models | ProductRequirement | `prisma/schema.prisma:1481` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0044 | Data models | ProductMilestone | `prisma/schema.prisma:1505` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0045 | Data models | Program | `prisma/schema.prisma:1528` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0046 | Data models | Project | `prisma/schema.prisma:1573` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0047 | Data models | ProjectProduct | `prisma/schema.prisma:1662` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0048 | Data models | ProjectRequirement | `prisma/schema.prisma:1681` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0049 | Data models | WbsElement | `prisma/schema.prisma:1706` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0050 | Data models | Campaign | `prisma/schema.prisma:1756` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0051 | Data models | Saga | `prisma/schema.prisma:1796` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0052 | Data models | Requirement | `prisma/schema.prisma:1848` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0053 | Data models | RequirementTrace | `prisma/schema.prisma:1889` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0054 | Data models | EngTask | `prisma/schema.prisma:1908` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0055 | Data models | ProductionEngIssue | `prisma/schema.prisma:1976` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0056 | Data models | EngDependency | `prisma/schema.prisma:2019` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0057 | Data models | PlanningQuarter | `prisma/schema.prisma:2043` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0058 | Data models | EngSprint | `prisma/schema.prisma:2065` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0059 | Data models | BusinessPriority | `prisma/schema.prisma:2093` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0060 | Data models | Permission | `prisma/schema.prisma:2123` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0061 | Data models | PermissionGroup | `prisma/schema.prisma:2135` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0062 | Data models | PermissionGroupMember | `prisma/schema.prisma:2148` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0063 | Data models | UserPermissionGroup | `prisma/schema.prisma:2158` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0064 | Data models | UserPermission | `prisma/schema.prisma:2168` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0065 | Data models | PermissionRequest | `prisma/schema.prisma:2184` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0066 | Data models | EngSwimLane | `prisma/schema.prisma:2201` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0067 | Data models | EngAlert | `prisma/schema.prisma:2220` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0068 | Data models | WorkTimeScan | `prisma/schema.prisma:2240` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0069 | Data models | ProjectTask | `prisma/schema.prisma:2258` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0070 | Data models | Milestone | `prisma/schema.prisma:2289` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0071 | Data models | ProjectRisk | `prisma/schema.prisma:2307` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0072 | Data models | ProjectIssue | `prisma/schema.prisma:2331` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0073 | Data models | ProjectMember | `prisma/schema.prisma:2352` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0074 | Data models | ProjectRaciEntry | `prisma/schema.prisma:2362` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0075 | Data models | ProjectCommunication | `prisma/schema.prisma:2381` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0076 | Data models | ProjectWikiPage | `prisma/schema.prisma:2397` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0077 | Data models | PiIncrement | `prisma/schema.prisma:2419` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0078 | Data models | PiFeature | `prisma/schema.prisma:2443` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0079 | Data models | ProjectCostEntry | `prisma/schema.prisma:2459` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0080 | Data models | Inspection | `prisma/schema.prisma:2484` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0081 | Data models | InspectionResult | `prisma/schema.prisma:2520` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0082 | Data models | NonConformance | `prisma/schema.prisma:2531` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0083 | Data models | MrbCase | `prisma/schema.prisma:2560` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0084 | Data models | MrbDisposition | `prisma/schema.prisma:2598` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0085 | Data models | CarActivityLog | `prisma/schema.prisma:2628` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0086 | Data models | Warehouse | `prisma/schema.prisma:2651` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0087 | Data models | Location | `prisma/schema.prisma:2660` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0088 | Data models | InventoryItem | `prisma/schema.prisma:2679` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0089 | Data models | MaterialTransaction | `prisma/schema.prisma:2711` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0090 | Data models | Lot | `prisma/schema.prisma:2739` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0091 | Data models | SerialNumber | `prisma/schema.prisma:2752` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0092 | Data models | SerialInstall | `prisma/schema.prisma:2791` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0093 | Data models | WorkOrderUnit | `prisma/schema.prisma:2823` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0094 | Data models | KitSerialAssignment | `prisma/schema.prisma:2843` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0095 | Data models | Rma | `prisma/schema.prisma:2869` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0096 | Data models | RmaLine | `prisma/schema.prisma:2917` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0097 | Data models | Supplier | `prisma/schema.prisma:2935` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0098 | Data models | AslPolicy | `prisma/schema.prisma:2981` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0099 | Data models | SupplierCertification | `prisma/schema.prisma:2992` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0100 | Data models | SupplierScorecardHistory | `prisma/schema.prisma:3015` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0101 | Data models | PurchaseRequest | `prisma/schema.prisma:3030` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0102 | Data models | PurchaseRequestLine | `prisma/schema.prisma:3116` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0103 | Data models | PurchaseOrder | `prisma/schema.prisma:3128` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0104 | Data models | ReceivingTraveler | `prisma/schema.prisma:3173` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0105 | Data models | ReceivingTravelerLine | `prisma/schema.prisma:3220` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0106 | Data models | PurchaseOrderLine | `prisma/schema.prisma:3237` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0107 | Data models | Receipt | `prisma/schema.prisma:3252` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0108 | Data models | ReceiptLine | `prisma/schema.prisma:3270` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0109 | Data models | Rfq | `prisma/schema.prisma:3290` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0110 | Data models | Asset | `prisma/schema.prisma:3306` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0111 | Data models | AssetCheckout | `prisma/schema.prisma:3337` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0112 | Data models | BankAccount | `prisma/schema.prisma:3363` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0113 | Data models | BankTransaction | `prisma/schema.prisma:3388` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0114 | Data models | Account | `prisma/schema.prisma:3409` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0115 | Data models | JournalEntry | `prisma/schema.prisma:3443` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0116 | Data models | JournalLine | `prisma/schema.prisma:3488` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0117 | Data models | JournalAttachment | `prisma/schema.prisma:3519` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0118 | Data models | ScheduledReport | `prisma/schema.prisma:3535` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0119 | Data models | RecurringJournal | `prisma/schema.prisma:3554` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0120 | Data models | CycleCount | `prisma/schema.prisma:3574` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0121 | Data models | CycleCountLine | `prisma/schema.prisma:3588` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0122 | Data models | Customer | `prisma/schema.prisma:3607` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0123 | Data models | ArInvoice | `prisma/schema.prisma:3634` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0124 | Data models | ArInvoiceLine | `prisma/schema.prisma:3653` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0125 | Data models | ArPayment | `prisma/schema.prisma:3663` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0126 | Data models | ApInvoice | `prisma/schema.prisma:3673` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0127 | Data models | ApPayment | `prisma/schema.prisma:3695` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0128 | Data models | SalesOrder | `prisma/schema.prisma:3711` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0129 | Data models | Quote | `prisma/schema.prisma:3759` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0130 | Data models | QuoteLine | `prisma/schema.prisma:3798` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0131 | Data models | SalesOrderLine | `prisma/schema.prisma:3810` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0132 | Data models | Shipment | `prisma/schema.prisma:3827` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0133 | Data models | KitOrder | `prisma/schema.prisma:3859` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0134 | Data models | KitOrderLine | `prisma/schema.prisma:3879` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0135 | Data models | ReceivingPhoto | `prisma/schema.prisma:3897` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0136 | Data models | ReceivingDocument | `prisma/schema.prisma:3919` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0137 | Data models | TraceEvent | `prisma/schema.prisma:3946` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0138 | Data models | ShipmentLine | `prisma/schema.prisma:3980` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0139 | Data models | GovernmentProperty | `prisma/schema.prisma:3995` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0140 | Data models | ComplianceCheck | `prisma/schema.prisma:4039` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0141 | Data models | GfpDocument | `prisma/schema.prisma:4052` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0142 | Data models | GfpAuditRecord | `prisma/schema.prisma:4074` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0143 | Data models | GfpCheckout | `prisma/schema.prisma:4096` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0144 | Data models | GfpConsumption | `prisma/schema.prisma:4122` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0145 | Data models | VirtualAsset | `prisma/schema.prisma:4152` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0146 | Data models | VirtualAssetAssignment | `prisma/schema.prisma:4206` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0147 | Data models | TimeEntry | `prisma/schema.prisma:4225` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0148 | Data models | PtoRequest | `prisma/schema.prisma:4283` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0149 | Data models | ExpenseReport | `prisma/schema.prisma:4299` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0150 | Data models | ExpenseLine | `prisma/schema.prisma:4315` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0151 | Data models | PerformanceReview | `prisma/schema.prisma:4326` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0152 | Data models | EmployeeGoal | `prisma/schema.prisma:4352` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0153 | Data models | GoalCheckIn | `prisma/schema.prisma:4372` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0154 | Data models | FeedbackNote | `prisma/schema.prisma:4388` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0155 | Data models | TrainingRecord | `prisma/schema.prisma:4405` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0156 | Data models | AuthSession | `prisma/schema.prisma:4427` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0157 | Data models | UserInvite | `prisma/schema.prisma:4444` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0158 | Data models | EmailMessage | `prisma/schema.prisma:4465` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0159 | Data models | TrainingRequirement | `prisma/schema.prisma:4491` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0160 | Data models | PayrollPolicy | `prisma/schema.prisma:4510` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0161 | Data models | ReviewPolicy | `prisma/schema.prisma:4531` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0162 | Data models | CompanySettings | `prisma/schema.prisma:4542` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0163 | Data models | JobRequisition | `prisma/schema.prisma:4594` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0164 | Data models | Candidate | `prisma/schema.prisma:4622` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0165 | Data models | BackgroundCheck | `prisma/schema.prisma:4650` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0166 | Data models | EmployeeOnboarding | `prisma/schema.prisma:4677` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0167 | Data models | QualityProgram | `prisma/schema.prisma:4719` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0168 | Data models | QualityInspection | `prisma/schema.prisma:4751` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0169 | Data models | AuditFinding | `prisma/schema.prisma:4769` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0170 | Data models | HumidityReading | `prisma/schema.prisma:4792` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0171 | Data models | QualityItem | `prisma/schema.prisma:4808` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0172 | Data models | Toolbox | `prisma/schema.prisma:4855` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0173 | Data models | ToolboxInspection | `prisma/schema.prisma:4871` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0174 | Data models | ToolReport | `prisma/schema.prisma:4888` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0175 | Data models | QualityEvent | `prisma/schema.prisma:4920` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0176 | Data models | AccountingSettings | `prisma/schema.prisma:4948` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0177 | Data models | LegalEntity | `prisma/schema.prisma:4973` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0178 | Data models | AccountingPeriod | `prisma/schema.prisma:4985` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0179 | Data models | GlAccountMap | `prisma/schema.prisma:5002` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0180 | Data models | IndirectPool | `prisma/schema.prisma:5013` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0181 | Data models | ProgramClin | `prisma/schema.prisma:5025` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0182 | Data models | LaborCategory | `prisma/schema.prisma:5045` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0183 | Data models | TimeEntryChange | `prisma/schema.prisma:5062` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0184 | Data models | Timesheet | `prisma/schema.prisma:5080` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0185 | Data models | TimesheetApproval | `prisma/schema.prisma:5116` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0186 | Data models | EmployeeDocument | `prisma/schema.prisma:5134` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0187 | Data models | EngineeringTicket | `prisma/schema.prisma:5151` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0188 | Data models | Sprint | `prisma/schema.prisma:5189` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0189 | Data models | TicketComment | `prisma/schema.prisma:5200` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0190 | Data models | ValueStreamMetric | `prisma/schema.prisma:5213` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0191 | Data models | WorkCenter | `prisma/schema.prisma:5228` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0192 | Data models | WorkCenterStaff | `prisma/schema.prisma:5250` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0193 | Data models | SupportTicket | `prisma/schema.prisma:5271` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0194 | Data models | SupportMessage | `prisma/schema.prisma:5322` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0195 | Data models | SupportNote | `prisma/schema.prisma:5339` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0196 | Data models | Tenant | `prisma/schema.prisma:5358` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0197 | Data models | TenantLogin | `prisma/schema.prisma:5397` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0198 | Data models | InviteLookup | `prisma/schema.prisma:5411` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0199 | Data models | TelemetryEvent | `prisma/schema.prisma:5424` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0200 | Data models | InstalledAsset | `prisma/schema.prisma:5464` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0201 | Data models | ServiceTicket | `prisma/schema.prisma:5487` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0202 | Data models | ServiceVisit | `prisma/schema.prisma:5521` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0203 | Data models | ServiceLabor | `prisma/schema.prisma:5551` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0204 | Data models | ServicePartUsage | `prisma/schema.prisma:5568` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0205 | Data models | Vehicle | `prisma/schema.prisma:5587` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0206 | Data models | VehicleMaintenance | `prisma/schema.prisma:5625` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0207 | Data models | FuelLog | `prisma/schema.prisma:5652` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0208 | Data models | TelemetryIssue | `prisma/schema.prisma:5671` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0209 | Data models | TelemetryIssueEvent | `prisma/schema.prisma:5708` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0210 | Data models | Equipment | `prisma/schema.prisma:5732` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0211 | Data models | EquipmentMaintenance | `prisma/schema.prisma:5763` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0212 | Data models | MeterReading | `prisma/schema.prisma:5793` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0213 | Data models | DowntimeEvent | `prisma/schema.prisma:5808` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0214 | Data models | Lead | `prisma/schema.prisma:5831` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0215 | Data models | Contact | `prisma/schema.prisma:5853` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0216 | Data models | Opportunity | `prisma/schema.prisma:5871` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0217 | Data models | CrmActivity | `prisma/schema.prisma:5904` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0218 | Data models | Carrier | `prisma/schema.prisma:5932` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0219 | Data models | FreightCost | `prisma/schema.prisma:5955` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0220 | Data models | LandedCostCharge | `prisma/schema.prisma:5985` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0221 | Data models | MfaCredential | `prisma/schema.prisma:6010` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0222 | Data models | MfaRecoveryCode | `prisma/schema.prisma:6039` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0223 | Data models | MfaChallenge | `prisma/schema.prisma:6056` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0224 | Data models | DocSpace | `prisma/schema.prisma:6077` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0225 | Data models | DocPage | `prisma/schema.prisma:6087` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0226 | Data models | DocRevision | `prisma/schema.prisma:6113` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0227 | Data models | DocSignature | `prisma/schema.prisma:6132` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0228 | Data models | DocComment | `prisma/schema.prisma:6146` | UNTESTED | Schema exists; not CRUD acceptance coverage |
| MODEL-0229 | Data models | DocLink | `prisma/schema.prisma:6161` | UNTESTED | Schema exists; not CRUD acceptance coverage |

