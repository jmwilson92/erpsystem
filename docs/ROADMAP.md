# Protessera roadmap

*Living document. Last reviewed 2026-07-31.*

What we're building next, and why. Organised by track rather than by date — every item is tagged **Next**, **Then**, or **Later**, and tracks move independently.

---

## Where we are

Measured, not estimated:

| | |
|---|---|
| Modules | 15 (sales, manufacturing, engineering, supply chain, government, quality, serialization, accounting, HR, PMO, field service, CRM, CMMS, logistics, fleet) |
| Route areas | ~70 |
| Tables per tenant | 211 |
| Tenants | 2, one of which is our own dogfood instance |

Already built, and worth knowing before proposing anything: **AS9102 first articles, calibration control, certificates of conformance, approved vendor lists, CAPA, counterfeit-part controls, FAR/DFARS handling, government property tracking, configuration management, MRB, traceability.** Plus air-gapped on-premise mode with CI enforcement, append-only audit logs, session inactivity termination, TOTP MFA, a Customer Responsibility Matrix, a published self-host image, a one-command installer, and offline licensing.

**Breadth is not the gap.** A defense manufacturer's checklist is largely ticked already. A sixteenth module does not move anything. Everything below is depth in what exists, or an upgrade to how it works.

---

## Ship blockers

Not features. Just the things currently half-done, which cost nothing to finish and look bad if a prospect hits them:

- [ ] `bash scripts/build-demo-template.sh` — Fleet, Service, CRM, Maintenance and Logistics are still empty for anyone taking the demo
- [ ] Settings → Company → Name — still reads `ForgeRP` in the database
- [ ] Stripe webhook URL → `https://www.protessera.com/api/stripe/webhook`
- [ ] Resend: verify `protessera.com`, then move `EMAIL_FROM`
- [ ] Tag `v1.0.0` and make the GHCR package public (it defaults to private — self-host customers get a bare 401 otherwise)

---

## Track 1 — Mobile, warehouse and shop floor

**The biggest single upgrade available.** The floor is where ERP adoption succeeds or fails, "does it work on a phone?" comes up in every conversation, and unlike most items here it is *demonstrable* — it's the difference between a demo that looks like software and one that looks like their Tuesday.

Scope: warehousing end to end, plus scanning in and out of jobs. Not the whole ERP on a small screen — nobody approves a budget on a phone.

### Build it as an installable web app, not a native binary

This decision is easy to get wrong, so the reasoning:

- **Real warehouses run rugged Android scanners** (Zebra TC-series and equivalents), not personal phones. Those have hardware scan triggers that emit keystrokes — a web input box already receives them, with no camera and no SDK.
- **Distribution is the killer for native on-prem.** Our whole pitch is "runs entirely inside your boundary." A store binary that only talks to a customer's private server is friction at review time and at install time. A web app is just the local address they already use.
- **Many defense shops ban personal phones on the floor outright.** Build for company-issued devices, because that's what's actually allowed in the building.
- `src/app/manifest.ts` already declares `display: standalone`, so the site is installable today. The gap is screens, not packaging.

Revisit native only if a customer needs iOS camera scanning specifically, or a store listing is a procurement checkbox. Wrapping the same screens in a shell later is days of work; guessing wrong now costs months.

### What already exists

- **The warehouse model is complete** — `Warehouse`, `Location` (STORAGE / RECEIVING / QUARANTINE / SHIPPING / WIP / STAGING / GFP), `InventoryItem` with lot, serial, ownership and quarantine quantities, `Lot`, `CycleCount`. Kitting, receiving and shipping have working desktop flows.
- **Label printing works** — Code 39 in `src/lib/barcode.ts`, QR in `src/lib/qr.ts`, a print sheet at `/print/labels` covering bins, work orders and parts.
- **Labor tracking works** — `TimeEntry` already carries `workOrderId` and a `type` discriminator, with timesheets and approvals on top. `clockOutAllActiveWork` exists.

### The real gaps, from reading the code

- **No ID convention on labels.** `/print/labels` encodes bare values — `WH-LOC` for bins, the raw WO number, the raw part number (`src/app/print/labels/page.tsx:31,48,64`). One scan box cannot tell a part number from a bin code. A type prefix has to land *first*: reprinting every label in a warehouse afterwards is not a small ask.
- **No scan primitive.** One component that takes a scan — hardware wedge, or camera as fallback — resolves it to a part, lot, serial, bin, work order or badge, and routes to the right action. Keystone; everything else hangs off it.
- **Job scanning is bound to the wrong model.** `WorkTimeScan` (open/closed, hours filled on scan-out) is exactly the right shape but relates to `EngTask` — engineering tasks, not floor work. Floor scanning needs the same pattern against a work order and operation, landing in `TimeEntry`.
- **Station scanning records no labor.** `actionScanWorkOrderToStation` moves a work order between stations but never records *who* worked, or for how long.

**Next** — label ID prefixes, the scan primitive, and mobile screens for the high-frequency transactions: receive against a PO, putaway, pick/issue to a work order, bin-to-bin move, cycle count. Plus job scan in/out writing real `TimeEntry` rows.

**Then** — offline queue. The genuinely hard part, and it should not be hand-waved: inventory transactions are not idempotent, so replaying a queue after a dead zone needs client-generated idempotency keys and a server that honours them. Get it wrong and you double-count stock, which is worse than being offline.

**Then** — shared-device auth. A floor scanner gets passed between people. Badge scan for identity rather than a password per transaction, with a session policy of its own: the 15-minute air-gap idle timeout is right for a desk and wrong for a scanner in a picker's hand. Narrow mobile roles too — a warehouse clerk should not reach financials through a scan gun.

### RFID badges — later, but cheaper than it sounds

**Badge readers need no RFID integration at all.** A USB badge reader is a keyboard wedge: tap a card, it types the credential ID and Enter. It arrives through the same scan primitive as a barcode gun. That collapses "RFID support" into two pieces of ordinary work — a revocable badge-to-user mapping, and the shared-device identity flow above. Most shops already issue these cards for door access, so the hardware is on the employee's belt today.

Two things to get right when it happens:

- **Store a keyed hash of the credential, never the raw ID.** 125 kHz prox and MIFARE Classic cards clone in seconds with hardware that costs less than dinner, so a leak of raw card IDs is a leak of working keys to the building. Same reasoning already applied to MFA secrets.
- **A badge tap is identification, not authentication.** Alone it's buddy-punching with extra steps — and a shop billing labor to government contracts has DCAA expecting each employee to record their own time. Pair it with a PIN. `User.pinCode` already exists for work-instruction sign-off, so the second factor is largely built, and badge-plus-PIN is genuinely two factors rather than compliance theatre.

**Passive UHF portal reads — walk through a doorway, get clocked in — are a no.** Long-range tags read through pockets, bags and walls, and a portal cannot establish direction or intent. It produces exactly the kind of time record nobody can defend in an audit. Clock-in stays a deliberate act.

**Where UHF earns its keep is assets, not people**: tool cribs, calibrated equipment, government-furnished property, and cycle counting a room by waving a handheld instead of counting shelves. Calibration control and GFP tracking already exist to hang it on. That path needs a real reader SDK and is the one part genuinely expensive — customer demand only.

---

## Track 2 — Planning and scheduling

More built than it looks. `src/lib/services/schedule.ts` already does back-scheduling, forward-scheduling, working calendars with holidays, work-order estimates from routing steps, and lead-time resolution. `src/lib/services/capacity.ts` (570 lines) computes capacity against workload, and `WorkCenter` carries `capacityHoursPerDay` and `efficiency` with `WorkCenterStaff` behind it.

**The gap is that scheduling is infinite-capacity.** It schedules each work order against a calendar and *reports* whether a work center is overloaded, but it never sequences jobs against constrained capacity. Nothing in the codebase does finite-capacity sequencing.

That matters because "when will this actually ship?" is the question small manufacturers most often say their ERP can't answer, and a promise date that ignores the queue in front of it is a promise date that's wrong.

- **Next** — finite-capacity sequencing at the work-center level: jobs queue, dates fall out of the queue, and the promise date reflects the shop's real load. Feeds directly into the floor board that already exists.
- **Then** — what-if scheduling. Drop a hot job in, see what slips, before committing. This is where DPAS (Track 3) plugs in, since a rated order is exactly "this job jumps the queue and here's what it costs."
- **Later** — constraint awareness beyond work centers: tooling, certified operators, calibrated equipment. All three are already modelled, so it's a question of the scheduler consuming them.

---

## Track 3 — Quality and compliance depth

The strongest existing surface, and the one that differentiates against horizontal ERPs.

- **Next — DPAS rated orders.** The one defense-specific gap not found anywhere in the codebase. Priority-rated orders (DO/DX) carry statutory scheduling obligations, primes ask about it, and it pairs naturally with what-if scheduling above.
- **Then — finish electronic signatures.** `TestProcedureSignOff` and `WorkInstructionSignOff` exist with PIN-based sign-off. What's missing is the manifest around them — signature meaning, printed name, timestamp binding, and a tamper-evident record — which is what turns "we log sign-offs" into something an auditor accepts.
- **Then — mandatory MFA enforcement.** The mechanism exists; nothing requires enrolment. A CMMC-conscious buyer will ask, and 800-171 3.5.3 expects it.
- **Then — password reuse history (800-171 3.5.8).** Currently unenforced and documented as a known limitation in the Customer Responsibility Matrix.
- **Later — audit evidence packaging.** Everything an assessor asks for is already recorded in append-only audit logs. Turning that into an exportable evidence package is mostly presentation, and it's the kind of thing that shortens a C3PAO engagement measurably.

---

## Track 4 — Connectivity

Turning the ERP into something the customer's *partners* touch, which is where stickiness comes from.

- **Then — supplier portal.** Suppliers acknowledging POs, confirming dates, and uploading certs directly. Removes the email-and-spreadsheet layer around purchasing, and every cert that arrives already attached is one nobody chases at audit time.
- **Later — EDI.** Verified absent: no X12, no 850, no ASN/856 anywhere in the codebase. Primes push this onto their suppliers, so it will eventually come up. The supplier portal is the cheaper answer to the same problem — build EDI when a prospect names a specific trading partner, not before.
- **Later — public API and webhooks.** No token-authed API exists today; everything is cookie sessions and server actions. This also blocks any native client, so it's the shared prerequisite between Track 1's native option and any customer integration.
- **Later — accounting and carrier integrations.** Likely order: QuickBooks/Xero, then shipping carriers, then CAD/PLM. Build the one people ask for, not a platform.

---

## Track 5 — Getting data in and out

- **Next — onboarding and data import.** The gap between signup and "our real parts are in here" is where trials die. Import quality matters more than any module, and it's the most direct lever on conversion.
- **Then — reporting depth.** `ScheduledReport` already exists. What's missing is customer-authored reports rather than the fixed set.
- **Then — hosted backup automation.** `scripts/backup-db.sh` covers self-host. The hosted side leans on Supabase's own backups — fine now, not fine at ten customers.

---

## Track 6 — Platform and scale

Mostly trigger-gated. Every item here should wait for the condition that justifies it.

| Item | Trigger | Note |
|---|---|---|
| SSO (SAML / OIDC) | First buyer with an identity provider | Verified absent. Common enterprise procurement checkbox; not needed for a 20-person shop. |
| Demo architecture rework | Demo concurrency regularly above ~15 | Schema-per-tenant costs ~23 MB and 211 tables per sandbox. One shared schema with row-level isolation removes the catalog ceiling. Significant change — do not pre-empt it. |
| Distributed rate limiting | More than one app replica | Failed-logon limiting is in-process: correct for one container, weaker across several. |
| Localization (currency, language) | A serious non-US prospect | Nothing is externalised today. Real work — and since ITAR customers are US-only by definition, this signals a deliberate market change. |
| Tauri desktop client | Ad-hoc | A native window pointed at an on-prem server. Small, and a good answer to "can we have an app?" |

---

## Explicitly not doing

Written down so it stays decided:

- **More modules.** Fifteen is already more than a 20-person shop uses. Depth beats breadth.
- **A native bundled `.exe`.** Weeks of work, fragile, and wrong-shaped: a multi-user shop's ERP cannot live on one person's laptop. The Docker on-prem stack plus a thin client covers the real need.
- **A native phone binary, for now.** The phone app is on — see Track 1. Shipping it through an app store is what's deferred.
- **Passive UHF clock-in.** Reasoning in Track 1. Assets yes, people no.
- **Chasing NetSuite feature parity.** Losing game. Win on "inside your boundary, provable, no consultants."

---

## Known debt

Carrying costs, kept visible.

**Compliance** — documented in the Customer Responsibility Matrix rather than hidden: password reuse unenforced, MFA not mandatory, per-process logon limiting, FIPS mode unverified by the app, and audit triggers defeatable by a database superuser.

**Architecture** — schema-per-tenant is right for real customers (genuine isolation, and a selling point) and wrong for throwaway demos. Only the demo side needs rethinking.

**Operational** — Vercel Hobby caps cron at daily, so demo reaping leans on visitor traffic; that stops being adequate with real volume. Supabase free tier is 500 MB, which the demo pool sizing already assumes.

---

## How to prioritise

Review monthly. For anything proposed, in order:

1. **Has a customer asked for it?** That outranks everything below.
2. **Does it unblock a sale in progress?** Do it now, whatever track it's in.
3. **Is it demonstrable?** Features a prospect can *see* working are worth more than features they have to be told about. This is why Track 1 leads.
4. **Does it widen the on-premise compliance moat?** Strong candidate — it's the thing horizontals can't copy quickly.
5. **Is it here because it's fun to build?** Sometimes fine. Just know that's the reason.

One standing caution: the last stretch built a lot of infrastructure for customers who don't exist yet. That was the right order — you can't sell an ITAR story you can't back — but feature work is easier than selling, and it's worth noticing when one is being used to avoid the other.
