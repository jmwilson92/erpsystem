# Protessera — 100 features and upgrades

*Candidate list, 2026-07-31. Not a commitment and not in priority order — see `ROADMAP.md` for what's actually next.*

Checked against the schema (~200 models) and ~70 route areas so nothing here duplicates what exists. Where a foundation is already in place, it says so — those are the cheap ones.

---

## If you only do ten

The ones with the best ratio of effort to differentiation, given the defense-manufacturing niche:

**#2 CLIN/SLIN structure · #3 CDRL tracking · #5 ECCN/USML classification · #7 Deviations and waivers · #10 Indirect rate pools · #13 SPC · #27 Finite-capacity scheduling · #37 Mobile warehouse · #61 Estimating engine · #93 Supplier portal**

The contract-structure items (#2, #3) are the biggest surprise from the audit: there is no contract model at all. `Program` and `Project` exist, but a defense shop lives in CLINs, and every deliverable, invoice and mod hangs off them. That's a foundational gap in exactly the market being sold to.

---

## Government and defense (1–12)

1. **DPAS rated orders (DO/DX)** — statutory priority obligations; the only defense feature not found anywhere in the codebase.
2. **CLIN / SLIN contract structure** — no `Contract` or `Clin` model exists. Everything downstream (deliverables, invoicing, mods, funding) should hang off this.
3. **CDRL deliverables tracking** — DD 1423 data items with due dates and submission history.
4. **Contract modifications log** — mod history with funding and scope deltas.
5. **ECCN / USML export classification per part** — no export-control field exists on `Part`. Directly relevant to the ITAR story already being sold.
6. **Export licence tracking** — DSP-5 / TAA / agreements with expiry and scope alerts.
7. **Deviations and waivers** — request, approve, and bound by serial/lot. Standard defense quality; no model today.
8. **DD 1662 annual GFP report** — the GFP models exist, the report doesn't.
9. **Progress payments / SF 1443** — cost-based billing for long-lead contracts.
10. **Indirect rate pools and DCAA cost accounting** — no `CostCenter` or rate-pool model. `TimeEntry` already carries charge codes and budgets, so the foundation is there.
11. **Incurred cost submission (ICE) support** — annual DCAA submission from existing cost data.
12. **CPARS-facing performance metrics** — on-time delivery and quality trends framed the way primes rate you.

## Quality (13–26)

13. **SPC / control charts** — no SPC model. `Inspection` and `InspectionResult` already capture the measurements; this is analysis on top.
14. **Gage R&R / MSA studies** — measurement system analysis against existing calibration data.
15. **Sampling plans (ANSI/ASQ Z1.4)** — skip-lot and AQL-driven inspection sizing.
16. **PFMEA and control plans** — risk analysis linked to routing operations.
17. **Supplier corrective actions (SCAR)** — CAPA exists; supplier-directed corrective action as a first-class flow doesn't.
18. **8D report generation** — from existing CAPA records.
19. **Cost of quality reporting** — scrap, rework, warranty and appraisal cost rollup.
20. **Recall / stop-ship containment** — trace forward from a bad lot to every affected shipment.
21. **Auto-generated certificates of conformance** — built from lot, serial and inspection data rather than typed.
22. **Material compliance declarations** — RoHS, REACH, conflict minerals at part level.
23. **Calibration recall forecasting** — plus out-of-tolerance impact analysis: what shipped on a gauge later found bad.
24. **Skip-lot inspection driven by supplier performance** — `SupplierScorecardHistory` already exists to drive it.
25. **Quality alert / andon board** — floor-visible escalation.
26. **Audit checklist templates** — AS9100 clause-mapped, feeding the existing `AuditFinding` model.

## Planning and scheduling (27–36)

27. **Finite-capacity scheduling** — the big one. Today's scheduler is infinite-capacity: it reports overload but never sequences against it.
28. **What-if / simulation scheduling** — drop a hot job in, see what slips, before committing.
29. **Multi-constraint scheduling** — tooling, certified operators and calibrated equipment are all modelled already; the scheduler just doesn't consume them.
30. **Reorder point / min-max / safety stock** — no reorder-point field on inventory today.
31. **MRP with pegging and exception messages** — trace demand to source and surface reschedule-in/out actions.
32. **Master production schedule** — the layer above work orders.
33. **Rough-cut capacity planning** — feasibility check before releasing a plan.
34. **Shift patterns and crew calendars** — no `Shift` model; `schedule.ts` calendars are company-wide.
35. **Sequence-dependent setup optimisation** — group jobs to cut changeover time.
36. **Available-to-promise / capable-to-promise** — a real date on the quote, not a guess.

## Shop floor and mobile (37–48)

37. **Mobile warehouse app** — see Track 1 in the roadmap.
38. **Scan primitive and label ID prefixes** — prerequisite for everything scan-driven.
39. **Job scan in/out** — writing real `TimeEntry` rows; `WorkTimeScan` has the right shape but is bound to `EngTask`.
40. **Offline transaction queue** — with client-generated idempotency keys, or inventory double-counts on replay.
41. **Badge + PIN shared-device auth** — `User.pinCode` already exists.
42. **OEE dashboards** — `DowntimeEvent` and `MeterReading` exist, so availability/performance/quality is computable today.
43. **Andon and escalation alerts** — operator raises a flag, the right person's phone buzzes.
44. **Rich work-instruction media** — video and 3D views at the station.
45. **Operator certification gating at station** — `User.skills` is a JSON string today; needs a real model to enforce anything.
46. **Tool crib checkout by scan** — `Toolbox` and `AssetCheckout` exist.
47. **Scrap and rework capture at operation** — with reason codes feeding cost of quality (#19).
48. **Floor TV dashboards** — the `radiators` route exists; upgrade to real-time.

## Warehouse (49–58)

49. **License plate / pallet (LPN) handling** — move a hundred parts with one scan.
50. **Wave and batch picking** — pick lists that group work instead of one order at a time.
51. **Directed putaway rules** — the system tells you where it goes.
52. **Bin replenishment** — min/max at location level, not just part level.
53. **Dock scheduling and appointments** — no dock or appointment model today.
54. **Cross-docking** — receipt straight to shipping without putaway.
55. **Consignment and vendor-managed inventory** — `InventoryItem.ownership` already distinguishes COMPANY / CUSTOMER / GOVERNMENT.
56. **Cartonization and pack-out** — what fits in which box, and the packing list that follows.
57. **Carrier rate shopping and label printing** — `Carrier` and `FreightCost` exist; live rating doesn't.
58. **Serial and lot genealogy tree** — `SerialInstall` captures the data; there's no visualisation of it.

## Sales and CRM (59–68)

59. **Price lists and volume breaks** — no `PriceList` model; pricing is per-line today.
60. **CPQ for configurable products** — `ProductVariant` exists as a foundation.
61. **Estimating engine** — cost roll from BOM plus routing into a quote. Quoting from actual cost is a genuine differentiator against shops that guess.
62. **Bid / no-bid and proposal management** — pipeline for RFP responses.
63. **SAM.gov opportunity ingestion** — pulling solicitations straight into the CRM pipeline.
64. **Commission tracking** — no model today.
65. **Sales territories and quotas** — `Lead`, `Opportunity` and `CrmActivity` exist to hang them on.
66. **Customer portal** — order status, documents, RMA submission.
67. **Warranty and contract renewals** — no warranty model; `ServiceTicket` and `InstalledAsset` exist.
68. **Win/loss analysis** — why quotes are lost, tracked rather than remembered.

## Finance (69–80)

69. **Multi-currency and exchange rates** — no currency model; everything is implicitly USD.
70. **Sales tax / VAT engine** — no `TaxRate` model.
71. **Standard costing and variance analysis** — purchase price, labor rate and efficiency variances.
72. **WIP accounting and percentage-of-completion revenue** — long-running contracts need it.
73. **Fixed assets and depreciation** — `Asset` exists for checkout only, with no depreciation schedule.
74. **Cost centers and departmental P&L** — also the foundation for #10.
75. **AR collections and dunning** — aging-driven follow-up.
76. **Credit limits and order holds** — stop the order before it ships.
77. **Cash flow forecasting** — from AR, AP and PO commitments already in the system.
78. **Budget vs actual with drill-down** — `Budget` and `BudgetCharge` exist; the variance view doesn't.
79. **1099 and vendor tax reporting** — year-end vendor reporting.
80. **Bank reconciliation automation** — `BankTransaction` exists; matching is manual.

## HR (81–86)

81. **Skills matrix as a real model** — `User.skills` and `User.certifications` are JSON strings today, so nothing can be queried, enforced, or expired against them. Blocks #45.
82. **Training LMS** — assessments and completion tracking on top of `TrainingRecord` / `TrainingRequirement`.
83. **EHS incident reporting and OSHA 300 log** — no incident model.
84. **Shift scheduling and attendance** — pairs with #34 and the badge clock-in.
85. **Succession planning** — depth on the existing org chart.
86. **Applicant tracking upgrades** — `JobRequisition`, `Candidate` and `BackgroundCheck` exist; pipeline stages and scheduling don't.

## Integrations and platform (87–94)

87. **Public REST API with API keys** — none exists; everything is cookie sessions and server actions. Shared prerequisite for any integration *and* any native client.
88. **Outbound webhooks** — let customers react to events instead of polling.
89. **SSO (SAML / OIDC)** — verified absent. Enterprise procurement checkbox.
90. **QuickBooks / Xero sync** — the most-requested small-manufacturer integration.
91. **EDI (850 / 855 / 856 / 810)** — verified absent. Primes push this onto suppliers.
92. **CAD / PLM connector** — SolidWorks and similar, for BOM and drawing sync.
93. **Supplier portal** — PO acknowledgement, date confirmation, cert upload. Sticky, because it puts the customer's suppliers in the product.
94. **Label template designer** — Code 39 and QR generation exist; layouts are hard-coded.

## Platform UX and data (95–100)

95. **Customisable dashboards** — per-user widgets instead of fixed pages.
96. **Saved views and personal filters** — across the ~70 route areas.
97. **Customer-authored report builder** — `ScheduledReport` exists but the report set is fixed.
98. **Global search upgrade** — the `search` route exists; ranking and cross-entity coverage can go much further.
99. **Notification center and digests** — one place for approvals, alerts and escalations.
100. **Data import wizard** — column mapping, validation and dry-run. The gap between signup and "our real parts are in here" is where trials die.

---

## How to read this list

Roughly a third of these are *analysis or presentation on data already captured* (#13, #14, #19, #23, #42, #58, #77, #78) — those are the cheap wins. Another third need a new model but slot into existing structure. The expensive ones are #27–29 (scheduling engine), #40 (offline correctness), #69–72 (finance core) and #87 (API surface), because they change how existing things work rather than adding alongside them.

Nothing here should jump the queue over something a paying customer asks for.
