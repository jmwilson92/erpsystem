# How it hits the books

Plain-language map of what Protessera posts to the general ledger, what it did before this change, and what a government-contract worksheet does and does not claim.

Nothing in the product certifies DCAA, FAR Part 31, CAS, or DFARS business-system compliance. The screens say the same thing. A CPA, a contracts specialist, or a DCAA auditor still has to review rates, unallowable costs, and any billing to the government.

The **program in PMO is the contract**. CLINs, funding, ceiling, contract type, and cost rollups hang off that record. There is no second contract file.

## Before

The company already had a chart of accounts, balanced journals, a month-end lock (`closed through` date), bank feeds, payroll accruals, and automatic invoices:

| What happened | Debit | Credit |
| --- | --- | --- |
| Receive against a purchase order | 1200 Raw materials | 2000 Accounts payable |
| Ship a sales order | 1100 Accounts receivable | 4000 Sales revenue |
| Ship a sales order (cost) | 5000 Cost of goods sold, at the part's standard cost | 1220 Finished goods |
| Customer payment | 1000 Cash | 1100 Accounts receivable |
| Supplier payment | 2000 Accounts payable | 1000 Cash |
| Vendor bill with no receipt | Expense (6000 if you don't pick one) | 2000 Accounts payable |
| Payroll (approved timesheet) | 6000 Wages and 6010 Employer payroll tax | Tax withholdings and 2110 Wages payable |
| Expense or card entry | The expense you pick | Cash, card, or payable |
| Bank feed category | The account you pick | The bank's ledger account |
| Recurring or manual journal | Whatever you enter | Whatever you enter |
| Reversal | The mirror of a posted journal | The mirror of a posted journal |

What did **not** hit the books:

- Issuing material to a job
- Labor charged to a job (it all stayed in wage expense)
- Shop overhead or fringe loaded onto a job
- Finishing a job (quantity moved to stock; the ledger did not)
- Scrap
- Cycle-count differences (quantity only)
- A program, CLIN, or contract (planning numbers on the project, not the ledger)

Other limits that were in the code:

- Posted journal lines could be edited in place (reclassify changed the account on the line).
- Voiding a posted journal wiped it off the books instead of posting a reversal.
- Cost of goods sold uses the part's **standard cost**. Inventory rows also store a unit cost from the receipt. There was no switch for average or FIFO, and work-in-process account 1210 was never posted by the shop.
- The close is one date. Anything on or before that date cannot be posted.
- No QuickBooks or Xero sync. Financial statements export to CSV. A bank connection (Plaid) pulls transactions; it does not replace the ledger.
- One company. No second legal entity.
- Job cost lived on the work order (`standard` vs `actual`) and on project cost entries. Those numbers were not the ledger.
- Government property, a free-text CLIN on a purchase order, and charge codes existed. There was no unallowable flag, no indirect-rate pool, and no funding ceiling on the program.

## After

Shop events now post a balanced journal and stamp the **program** (from the job's project), the project, and the work order. The same event will not post twice.

| What happened | Debit | Credit | Cost stamped on the job |
| --- | --- | --- | --- |
| Material issued to a job (company-owned) | 1210 Work in process | 1200 Raw materials | Material |
| Direct labor applied when payroll is processed | 1210 Work in process | 6050 Applied direct labor | Labor |
| Fringe loaded on that labor (provisional rate) | 1210 Work in process | 6070 Applied fringe | Fringe |
| Shop overhead loaded on that labor (provisional rate) | 1210 Work in process | 6060 Applied shop overhead | Overhead |
| Outside processing billed to a job | 1210 Work in process | 2000 Accounts payable | Outside processing |
| Job finished | 1220 Finished goods at standard, and 6200 Variance if the job's WIP differs | 1210 Work in process | None — this only moves cost, so it is not counted again |
| Ship (unchanged) | 5000 Cost of goods sold at standard | 1220 Finished goods | None |
| Scrap of company stock | 6210 Scrap | 1200 Raw materials, or 1210 if the stock was on a job | Material, only when it comes off a job |
| Count difference | 6200 Variance if short; raw materials if you found more | The other side | None |
| Unallowable account | That account | Wherever the entry credits | Marked unallowable and left out of billings and rates |
| Receipt, invoice, payment, payroll accrual | Same as before | Same as before | Receipts are tagged to the program but are **not** job cost until the material is issued |

Government-owned material issued to a job does not hit the company ledger.

Payroll still records the full wage in 6000. Applying direct labor credits 6050, so the profit and loss keeps indirect labor in wages and the job holds the direct labor. G&A is **not** loaded into inventory. It is a pool used on the billing worksheet only.

Account numbers can be changed under Accounting → the map is `GlAccountMap` (material issue, labor, fringe, overhead, completion, scrap, count, outside processing). If a code is missing, the books create it.

Posted journals are not edited. Reclassifying posts a new journal. Voiding a posted journal posts a reversal. Drafts can still be voided. The month-end date still locks the books, and a named month (`2026-01`) that has been closed locks too.

Every journal is tagged with a company. Today that company is "Main" / the seeded company. A second company can be split out later because the tag is already on the entry. That is readiness, not multi-company reporting.

Opening balances on the demo chart are stored on the accounts. They are not the same thing as the demo journals. Program reports read the journals.

## Program rollup (one source of truth)

| Question | Where the number comes from |
| --- | --- |
| What contract, CLIN, funding, ceiling, fee, and type? | The PMO program and its CLINs |
| What did this program cost on the books? | Posted journal lines stamped with that program and a cost element (material, labor, fringe, overhead, outside processing). Transfers between inventory accounts are not counted again. |
| What was billed? | Revenue lines stamped with that program |
| What is still in WIP? | Account 1210 lines for that program's jobs |
| What is the project budget, earned value, or the old "actual"? | Numbers entered on the project. The program page labels these as the performance log, not the ledger. |
| Government property contract match when kitting | The program's contract number, as well as the project and sales order |

Estimate at completion on the program page is allowable cost on the books divided by the projects' percent complete (or the budget, if the job is barely started). Burn is allowable cost divided by funding.

## Reports

Existing: income statement, balance sheet, cash flow, trial balance, AR aging, AP aging, inventory valuation, open work orders, budgets.

Added (CSV at `/reports/export?key=…`, print/PDF at `/print/report?key=…`):

- `gl-detail` — general ledger detail
- `program-pl` — funded, billed, allowable, unallowable, WIP, estimate at completion, by program
- `job-profit` — estimate vs shop log vs books, by job
- `wip-books` — WIP from the ledger
- `labor-dist` — hours by person, job or indirect charge, and program
- `indirect-rates` — provisional vs actual
- `unallowables` — accounts and lines flagged unallowable
- `ice` — incurred-cost worksheet shaped like an ICE package. **Not a submission.**

## Government-contract worksheet

| Capability | Status | What it is |
| --- | --- | --- |
| Program is the contract (number, type, customer, agency, prime/sub, funding, ceiling, fee) | Done | PMO program fields |
| CLIN / task order with its own funding and ceiling | Done | Child of the program |
| FFP, T&M, cost-plus, commercial, IDIQ | Done | Type on the program or CLIN |
| T&M hours × labor-category rate | Partial | Worksheet on the program. It does not create the invoice. Shipping still raises the sales invoice. |
| Cost-plus provisional billing (allowable cost + fee) | Partial | Same worksheet. Unallowable cost is left out. Not a public voucher (SF 1034). |
| Firm-price margin (funded vs cost) | Done | Shown as billed vs allowable, and funding left |
| Unallowable flag (FAR note) on accounts and on posted lines | Done | Excluded from allowable cost, rate pools, and the billing worksheet |
| Indirect pools: fringe, shop overhead, G&A | Done | Provisional rate you set; actual = allowable pool balance ÷ base |
| Fringe and overhead bases | Done | Direct labor dollars |
| G&A base | Done | Total cost input (material, labor, fringe, overhead, outside processing), excluding unallowable and the G&A pool itself |
| G&A into inventory | Not done | On purpose. G&A stays a period cost. |
| Allocation of an actual rate back to programs | Done | On the rate worksheet, by each program's direct labor |
| Time charged to a job, project, or indirect code | Done | Timecard already required a charge. A manual entry of worked time now must name a job, project, or indirect code. |
| No future work time | Done | Already in the timecard |
| Supervisor approval before payroll | Done | Already in timesheets |
| Change log with a reason | Partial | Edits to a saved timecard are logged. A reason is requested. Requiring the reason is a controller switch, off by default. |
| Total-time accounting (every weekday has a full day) | Partial | Controller switch, off by default, so a short demo week can still be submitted. |
| Daily time entry | Partial | Time is entered by day. The product does not force a clock-in. |
| Labor distribution report | Done | |
| Incurred-cost (ICE-style) export | Partial | Worksheet only |
| Contract brief on the program page | Done | Funded, billed, incurred, WIP, burn, CLINs |
| Link from a material issue to a lot | Partial | The journal memo carries the lot, and the material transaction id is the source. Quality and serial records are still the lot and serial screens, not a new trace system. |
| QuickBooks / Xero | Not done | CSV and print only |
| Average or FIFO costing | Not done | `costingMethod` is stored. Shipping still relieves finished goods at standard cost. |
| Multi-company books | Partial | One default company on every journal |
| DCAA or DFARS business-system approval | Not done | Not claimed |
| Forward pricing rate agreement, incurred-cost submission filing, or public voucher | Not done | |

## Permissions

| Role | Can |
| --- | --- |
| Accounting | Post journals, approve journals, close a period, edit rates and unallowable flags, read reports |
| Executive | Read reports and approve a journal |
| Controller (`accounting.controller`) | Override separation of duties, and turn on total-time and timecard-reason checks. Not given to the accounting role by default. |
| Admin | Everything |

When separation of duties is on, the person who wrote a manual journal cannot approve it unless they are a controller. The switch is off until a controller turns it on, so a one-person accounting desk is not blocked.

## Demo

The Avionics program (`PRG-AERO`, contract `FA8621-24-C-0001`) is the sample government contract. It has two CLINs, labor categories, and posted journals for material, labor, fringe, overhead, an unallowable entertainment cost, the indirect pools, and a progress billing. Work order `WO-00001` is the job. Open **PMO → Avionics** or **Accounting → Contracts & rates**.
