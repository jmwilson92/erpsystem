# Manufacturing inventory and accounting audit

**Date:** 2026-11-22 (PT)  
**Scope:** Trace every inventory-moving and cost-moving transaction on `origin/main` (`d51f766`, after #192) and record what it posts today, what it misses, and what this change will fix.  
**Related:** [How it hits the books](./accounting/how-it-hits-the-books.md) (the #139 GovCon/PMO ledger map). This audit is the shop-floor and subledger companion to that document.

Nothing here certifies GAAP, DCAA, or a CPA review. It is a plain-language map of the code.

## How to read this

Each section is one business event. **Today** is what the code does now. **Gap** is what is wrong, missing, or risky for an accountant. **Decision** is the rule this work will implement (flagged where the owner should confirm).

Default account codes below are the seeded chart. Companies can remap shop events in `GlAccountMap`. Per-part inventory / COGS / expense accounts exist on the item card but are labeled in the schema as “choice only — not posted yet.”

**Costing method today:** `AccountingSettings.costingMethod` defaults to `STANDARD` and is stored, but almost every relief still uses the part’s **standard cost**. Inventory rows also carry a receipt `unitCost`, and the part has `averageCost` / `lastBuyCost`, but shipping and finished-goods putaway do not use them. There is no FIFO layer.

---

## 1. Purchase-order receipt

**Today.** Receiving against a PO creates on-hand inventory at the receiving location (`MaterialTransaction` type `RECEIPT`, `unitCost` from the receipt line) and, unless the dock inspection is a hard fail, immediately raises an AP voucher by evaluated receipt settlement (ERS): PO price × received quantity. The journal is:

| Debit | Credit |
| --- | --- |
| 1200 Raw materials | 2000 Accounts payable |

The receipt is tagged to the PO’s project/program so it is traceable. It is **not** charged to a job until the material is issued. Putaway later only moves the bin (`PUTAWAY`); no second journal.

**Gaps**

- There is no Goods Receipt / Invoice Receipt (GR/IR) clearing account. The payable is booked the moment material hits the dock, even if the supplier invoice never arrives or arrives at a different price.
- There is no purchase-price variance (PPV). The voucher is always PO price, so a real supplier invoice cannot be matched and cannot book PPV.
- `raiseApInvoiceForReceipt` has no idempotency key. A retried receipt can create a second voucher and a second capitalization journal.
- Government-property receipts still post to the company books, with only a memo asking the user to confirm. GFP should stay off the company ledger.
- Failed-inspection receipts skip the voucher (good), but if quantity later is released from MRB as use-as-is, capitalization is not automatically caught up.
- Per-part inventory accounts are ignored; everything hits 1200.

**Decision.** New receipts debit the item’s inventory account (else 1200 Raw materials, or 1220 if the item is a finished/buyable end item) and **credit 2010 GR/IR**. If evaluated receipt settlement stays on (default, so today’s “voucher at receipt” still happens), the system immediately matches at PO price: Dr 2010 / Cr 2000, PPV zero. A later (or manual) supplier invoice at a different price books PPV. Government-owned receipts do not hit the company ledger. Receipt journals are idempotent on the receipt number.

---

## 2. AP invoice match and PPV

**Today.** There is no invoice-to-receipt match. The only inventory-related payable is the ERS voucher above. A manual vendor bill (`createVendorApInvoice`) debits an expense (or WIP for outside processing) and credits AP. It does not clear GR/IR and does not compute PPV.

**Gaps.** Accountants cannot enter the supplier’s invoice, clear the receipt, or see price variance. Three-way match is documented as “PO price × received qty,” which is two-way at best.

**Decision.** Add a match step: invoice quantity and price against open GR/IR for that PO. Journal: Dr GR/IR at receipt value, Dr or Cr PPV (invoice vs receipt), Cr AP at invoice value. Balanced, idempotent, tied to the AP voucher. Keep ERS as a company switch so a one-person shop can still auto-voucher at PO price.

---

## 3. Material issue / consumption (pick vs backflush)

**Today.** Consumption happens when a **kit is picked** (`completeKitOrder`). Company-owned stock is decremented in the source bin, a new inventory row is created at the kit staging / WIP location (on-hand, not available, tagged to the work order), and a `KIT` material transaction posts:

| Debit | Credit | Amount |
| --- | --- | --- |
| 1210 WIP | 1200 Raw materials | bin `unitCost` × qty |

Government-owned material moves in inventory but does not hit the company ledger (correct).

When the job is finished, `consumeWorkOrderWip` writes `ISSUE` transactions and **hard-deletes** the staging inventory rows. That second step does **not** post a journal, so there is no double GL consumption on the happy path.

**Gaps**

- There is no company or item setting for consumption timing. Everything is at pick. There is no backflush at operation or at completion.
- If a future hook posted a journal on every `ISSUE` transaction, completion would double-consume. The two events are easy to confuse.
- GL posting sits *outside* the inventory transaction and is swallowed with `console.error`. Inventory can move while the books stay unchanged.
- There is no unissue / return-to-stock path that reverses the journal. Unused kitted material stays in WIP on the books.
- Staging rows are hard-deleted at completion (and sometimes on WIP location merges). The request is reversals only, no hard-deletes of accounting evidence. Zeroing quantity is safer than deleting the row.
- Per-part inventory accounts are ignored.

**Decision.** Company default `consumptionTiming = AT_PICK`, overridable on the item (`AT_PICK` or `BACKFLUSH`). At pick, `AT_PICK` items post Dr WIP / Cr inventory exactly once, keyed to the material transaction. `BACKFLUSH` items still stage physically at pick but do **not** post; they post once when finished goods are received (BOM quantity × output quantity, at the bin’s unit cost). If a line was already issued at pick, backflush skips it. Both paths are idempotent. Unissue reverses the original journal and moves the quantity back to stores. Do not swallow a failed post.

---

## 4. Labor and overhead absorption into WIP

**Today.** Clocked time on a job is operational (#185 stores hours, rates, and allocated hours on the work order). The ledger is touched only when payroll **processes** an approved timesheet:

1. Payroll journal: Dr 6000 Wages and 6010 Employer tax / Cr withholdings and 2110 Wages payable (whole paycheck, not by job).
2. For each time line with a work order or project: Dr 1210 WIP / Cr 6050 Applied direct labor at `costAmount` or hours × labor rate, then provisional fringe (default 30%) and shop overhead (default 40%) to 6070 / 6060. G&A is not loaded into inventory (intentional). Idempotent per time-entry id.

**Gaps**

- Absorption waits for payroll processing. Hours can sit on a job for days (or forever, if the sheet is approved but not processed) while WIP on the books is understated.
- A failure in labor distribution is swallowed with `console.error` after the payroll journal has already posted.
- There is no labor-rate or labor-efficiency variance until (and unless) the job is finished as a lump “materials variance.”
- Indirect time (no job, no project) correctly stays in wages and is not absorbed.

**Decision.** Absorb direct labor, fringe, and overhead when the timesheet is **approved**, still idempotent per time entry, using the same #185 hours × rate (or `costAmount`). Payroll processing posts the wage accrual as it does today and will no-op absorption that already happened. Do not swallow the absorption error. Keep G&A out of inventory.

---

## 5. Partial and final output of finished goods

**Today.** The only path to finished goods is `completeWorkOrderToStock`. It requires every traveler step signed, the job at Receiving putaway (`READY_FOR_PUTAWAY` at RCV-01), and then it:

- Creates one inventory row for the **full work-order quantity** at `standardCost / quantity`.
- Posts `WO_COMPLETE`.
- Consumes **all** remaining WIP staging rows.
- Posts one journal, idempotent as `wo-complete:{workOrderId}`: Dr 1220 FG at **full-job standard cost**, Cr 1210 for the **entire** WIP balance, difference to 6200 Variance.
- Sets the work order to `COMPLETED` with `quantityCompleted = quantity`.

Task-only and some MRB recovery jobs skip stock.

**Gaps**

- You cannot receive any finished quantity while the job stays open. That is the feature request.
- The completion journal can only post once per work order, so even a later partial-output attempt could not book a second receipt.
- The first receipt would (today) consume all staged material and relieve all WIP, which is wrong for a partial.
- If standard cost is zero, `completionEntry` books FG at the full WIP balance (actual), which is inconsistent with “standard costing.”
- GL failure is swallowed; stock can appear without a journal.
- Lot/serial is handled for a single full completion, not for multiple receipts.

**Decision.** Add “Receive finished goods” on an open work order. Each receipt (quantity ≤ remaining) creates lot/serial-tracked FG, updates on-hand value, and posts Dr FG / Cr WIP at standard (or, if the company costing method is AVERAGE, at the current job unit cost). The job stays open. Staged material and backflush issues are consumed only for that output quantity. Final close relieves any residual WIP to variance accounts (material usage, labor rate, labor efficiency, overhead, and a residual rounding bucket). The existing “complete and put away” action receives the remaining quantity and then closes, so current floor habit still works.

---

## 6. Scrap and yield loss

**Today.** MRB disposition `SCRAP` reduces on-hand (and quarantine) and posts Dr 6210 Scrap / Cr 1200, or Cr 1210 if the row is tagged to a job. Government-owned scrap stays off the books. Amount is quantity × `unitCost`. Idempotent per scrap transaction.

**Gaps**

- Yield loss on the job that is not an MRB scrap (short output vs start quantity) has no automatic journal. It only shows up as leftover WIP at close, dumped into 6200.
- GL scrap is best-effort and swallowed.
- There is no distinct “yield loss” versus “scrapped component” account unless the company remaps 6210.

**Decision.** Keep MRB scrap as Dr Scrap / Cr inventory or WIP, and fail the disposition if the journal cannot post. At close, leftover WIP that corresponds to unfinished or lost quantity is relieved to scrap/yield or the usage variance accounts (see §7), not left sitting in 1210.

---

## 7. Work-order close: variances, WIP relief, residual WIP

**Today.** Close *is* finished-goods putaway (§5). One journal relieves all WIP and books a single 6200 “materials variance,” regardless of whether the difference came from material usage, price already in the issue amount, labor rate, labor hours, or overhead.

**Gaps.** No separate material-usage, labor-rate, labor-efficiency, or overhead variances. No close distinct from the last output. Residual WIP can remain if the completion journal is skipped or standard/WIP both round to zero. `actualCost` on the work order is not the ledger.

**Decision.** Output only relieves standard (or current) cost of the quantity received. Close (when the user closes, or when the existing complete-to-stock path finishes the last unit) computes:

| Variance | Meaning | Default account |
| --- | --- | --- |
| Material usage | Material issued to the job (minus unissue and scrap already relieved) versus standard material in the quantity completed | 6230 |
| Labor rate | Actual labor dollars versus clocked hours × standard/loaded rate | 6240 |
| Labor efficiency | Clocked hours versus allocated/#185 standard hours, at the standard rate | 6250 |
| Overhead | Absorbed overhead versus standard overhead on completed quantity | 6260 |
| Residual | Any leftover 1210 balance after the above | 6200 |

All close journals are balanced, idempotent, and tied to the work order. Period locks are respected.

---

## 8. Returns to stock / unissue

**Today.** There is no shop “unissue” or “return kit to stores.” MRB `USE_AS_IS` and `RETURN_TO_SUPPLIER` move held quantity (`RELEASE` / `TRANSFER` material transactions) and do not post a journal (use-as-is is a location/status change of already-capitalized stock; return-to-supplier does not automatically reverse the original receipt or AP).

**Gaps.** Kitted material cannot be returned without leaving WIP overstated. Supplier returns do not credit inventory or AP/GR/IR.

**Decision.** Add unissue: reverse the original issue journal (Dr inventory / Cr WIP) and move the quantity back to stores; no journal hard-delete. Supplier returns from MRB will credit the inventory account and debit AP or GR/IR (and PPV if needed) when the quantity leaves company stock, idempotent on the return transaction. (Customer returns are §12.)

---

## 9. Inventory adjustments and cycle counts

**Today.** Completing a cycle count applies quantity deltas to bins and, when `variance × unitCost` is non-zero, posts Dr 6200 / Cr 1200 for a shortage, or the reverse for a surplus. Idempotent per count line.

**Gaps**

- GL is swallowed on failure; quantity still changes.
- Surplus and shortage both use the materials-variance account, not a dedicated inventory-adjustment account (the map *label* says “count difference” but the default credit/debit codes are 6200/1200). We will give adjustments their own default (6220 Inventory adjustment) so 6200 can stay a production-variance account.
- There is no standalone “adjust this bin” journal outside cycle count (quantity-only tools, if any, would not hit the books).
- Adjustments always assume the raw-material account, even for finished goods.

**Decision.** Post adjustments in the same unit of work as the quantity change, to 6220 vs the item’s inventory account. Keep cycle count as the official quantity-adjustment path.

---

## 10. Transfers

**Today.** Moving a job between staging and work-center locations writes `TRANSFER` material transactions and may merge/delete inventory rows. No journal — correct for a move that stays in WIP.

**Gaps.** There is no general warehouse-to-warehouse transfer that would detect a change of inventory class (raw materials vs finished goods). Hard-delete on merge loses the source row.

**Decision.** Same-class, same-company transfers do not post (quantity and location only). A transfer that changes inventory account (for example raw materials bin to a finished-goods account) posts Dr destination inventory / Cr source inventory at the row’s unit cost. Prefer zeroing a merged source row instead of deleting it.

---

## 11. Shipment / sales-order invoice, COGS, and revenue

**Today.** Packing decrements inventory and writes `SHIP` transactions (often without `unitCost`). Revenue and COGS post only when the **entire** sales order has shipped:

| Debit | Credit | Amount |
| --- | --- | --- |
| 1100 AR | 4000 Sales revenue | full SO price |
| 5000 COGS | 1220 Finished goods | full SO qty × **part standard cost** |

The AR invoice is one per sales order. COGS is not stamped with the program. `costingMethod` is ignored. Per-part COGS / inventory accounts are ignored.

**Gaps**

- A partial shipment moves stock but does not book revenue or COGS until the last line ships. The subledger and the GL diverge until then.
- COGS does not use the cost of the bins that actually shipped.
- Revenue/COGS journals have no idempotency key (the invoice row is the only guard, and it is per sales order).
- Shipping a make-to-order job that was never received to finished goods can still decrement stock if bins exist, but COGS always credits 1220 even if the cost is still sitting in 1210.

**Decision.** Each shipment raises its own invoice for the shipped quantity and posts revenue and COGS for that shipment, idempotent on the shipment id. COGS uses standard cost when the company method is STANDARD, otherwise the shipped bin’s unit cost (average/actual). Credit the item’s inventory account (FG by default). Honor period lock. Do not wait for the sales order to close.

---

## 12. Customer returns, RMA, and NCR dispositions

**Today.** RMA issues, repair quotes, and repair work orders update quality records and may create a job. They do **not** post revenue reversals, inventory returns, or COGS reversals. NCR/MRB scrap and use-as-is/return-to-supplier are covered in §6 and §8. Rework/repair leave quantity in quarantine until the recovery job completes.

**Gaps.** A customer return can put metal back on the shelf (or into MRB) without restoring inventory value or reducing COGS/revenue. Accountants have to journal it by hand.

**Decision.** When an RMA receipt is accepted back into company stock, post Dr inventory / Cr COGS (or a returns-inward account if mapped) at the original unit cost or standard, with lot/serial, idempotent on the receipt. A credit memo (when issued) posts Dr revenue / Cr AR. Scrap and supplier-return dispositions follow §6 and §8. Repair jobs use the same WIP/output rules as any other job.

---

## 13. Subcontract / outside processing

**Today.** A manual vendor bill flagged to a work order posts Dr 1210 WIP / Cr 2000 AP (`OSP` event, cost element OSP), prepared before the AP voucher transaction so the two stay together. Idempotent on the voucher id.

**Gaps.** There is no “send out / receive back” inventory state with a GR/IR for the subcontract PO, and no PPV on the subcontract invoice. A subcontract PO received through normal receiving would today debit raw materials and AP (ERS), *and* a later job-coded vendor bill could debit WIP again — a possible double charge if both paths are used.

**Decision.** A subcontract / outside-processing receipt against a job should debit WIP (not raw materials) and credit GR/IR; the invoice clears GR/IR with PPV as in §2. A manual job-coded bill remains available, but the match will no-op if the same receipt was already expensed to the job. Guidance in the UI: do not also ERS-capitalize OSP as raw materials.

---

## Cross-cutting issues

| Issue | Today | Fix |
| --- | --- | --- |
| Swallowed GL errors | Kit issue, WO complete, scrap, cycle count, and labor distribution `console.error` and continue | Posting is part of the same unit of work; failure rolls back or rejects the business action |
| Hard-deletes | Posted journals are reversed (good). WIP inventory rows are deleted on consume/merge. Void of a *draft* still deletes nothing posted | Inventory consume/merge zeros quantity. Posted journals remain reversal-only |
| Period lock | `postJournal` already respects `closedThroughDate` and named closed months | Keep that for every new shop journal |
| Idempotency | Shop events that go through `gl-posting.ts` have keys; AR/AP auto journals mostly do not | Key every new/changed auto journal |
| Subledger vs GL | Inventory valuation report is qty × bin `unitCost`. It is never compared to 1200/1210/1220 balances | Inventory valuation reconciliation report, differences highlighted |
| WIP report | `wip-books` is the current ledger balance by job, not a movement statement | WIP by WO: beginning, material/labor/OH in, relieved to FG, variance, ending |
| Drill-down | Account register and journal list exist; no journal-to-source page, and material transactions are not linked to the journal | Journal detail with source document; `journalEntryId` on the material transaction; links both ways |
| Period-close checklist | Bank uncategorized, unreconciled, draft/pending journals | Add: open jobs with WIP, unmatched GR/IR, and unfinished count batches |
| Accountant language | Event keys and account names are already fairly plain; some reports still say “wip-books” | Plain labels, CSV/Excel export on the new reports |

---

## What already works (do not break)

- Balanced journals, month-end lock, reversals instead of editing posted lines, SoD switch for manual journals.
- Payroll wage accrual, AR/AP payments, expenses, bank categorization, recurring journals.
- Program/project/work-order stamps on shop journals; GFP issue off the company books; G&A not loaded into inventory.
- Kit-at-pick posting of company-owned material (the default we will keep).
- Evaluated receipt settlement as an option, so a small shop can still get a payable at receipt.

---

## Decisions the owner should confirm

1. **Costing method default stays STANDARD.** Finished-goods receipts and COGS relieve at standard cost. If the company switch is set to AVERAGE, those events use the bin or current job unit cost instead. FIFO is not built in this pass.
2. **Consumption default stays AT_PICK** (today’s kit behavior). Backflush is opt-in per item or by changing the company default.
3. **Receipts will credit GR/IR (2010), not AP directly.** ERS remains on by default and immediately clears GR/IR at PO price (PPV zero) so the payable still appears at receipt. Turn ERS off to wait for a supplier invoice and book PPV.
4. **Labor hits WIP when the timesheet is approved**, not only when payroll is processed.
5. **Revenue and COGS post on each shipment**, not only when the whole sales order is finished.
6. **G&A stays out of inventory.**

