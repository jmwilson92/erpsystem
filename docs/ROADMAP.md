# Protessera roadmap

*Living document. Last reviewed 2026-07-30.*

---

## Where we actually are

Measured, not estimated:

| | |
|---|---|
| Modules | 15 (sales, manufacturing, engineering, supply chain, government, quality, serialization, accounting, HR, PMO, field service, CRM, CMMS, logistics, fleet) |
| Route areas | ~70 |
| Tables per tenant | 211 |
| Paying customers | **0** |
| Tenants | 2, one of which is our own dogfood instance |

Already built, and worth knowing before planning anything: **AS9102 first articles, calibration control, certificates of conformance, approved vendor lists, CAPA, counterfeit-part controls, FAR/DFARS handling, government property tracking, configuration management, MRB, traceability.**

Plus, from the last stretch of work: air-gapped on-premise mode with CI enforcement, append-only audit logs, session inactivity termination, TOTP MFA, a Customer Responsibility Matrix, a published self-host image, a one-command installer, and offline licensing.

## The honest read

**Breadth is not the gap.** A defense manufacturer's checklist is largely already ticked. Adding a sixteenth module does not move revenue.

**Distribution is the gap.** Everything built recently is infrastructure for customers who do not exist yet. That was the right order — you cannot sell an ITAR story you cannot back — but the balance now has to swing hard the other way.

**The moat is the on-premise compliance story.** NetSuite, Odoo, and Fishbowl cannot easily say "runs entirely inside your boundary, here is a control-by-control matrix, here is a signed offline licence." A small shop chasing CMMC Level 2 has a genuine problem and very few credible vendors. SAM.gov hands you a list of exactly those buyers, filtered by NAICS.

**The risk is building instead of selling.** It is more comfortable to add a feature than to make ten calls. This roadmap is structured to make that discomfort explicit.

---

## Phase 0 — Prove someone will pay

**Goal: 3 paying customers. Nothing else counts.**

This is deliberately not a feature phase. The only engineering here is what stops a prospect from saying yes.

**Clear the decks first** — outstanding right now:

- [ ] `bash scripts/build-demo-template.sh` — Fleet, Service, CRM, Maintenance, and Logistics are still empty for anyone taking the demo
- [ ] Settings → Company → Name — still reads `ForgeRP` in the database
- [ ] Stripe webhook URL → `https://www.protessera.com/api/stripe/webhook`
- [ ] Resend: verify `protessera.com`, then move `EMAIL_FROM`
- [ ] Tag `v1.0.0` and make the GHCR package public (it defaults to private — customers get a bare 401 otherwise)

**Then sell:**

- [ ] Run the SAM.gov list. Ten conversations a week, phone first — a 20-person shop answers the phone and ignores email
- [ ] Watch the demo funnel in Insights: started → converted. If people start and vanish, the demo is the problem, not the product
- [ ] Write down every objection verbatim. Three prospects naming the same gap is a roadmap item; one is an anecdote

**Exit criteria:** 3 customers paying real money. Until then, resist every item below.

---

## Phase 1 — Make the first customers succeed

Retention beats acquisition at this size: one reference customer in defense manufacturing is worth more than any feature.

- **Onboarding and data import.** The gap between signup and "our real parts are in here" is where trials die. Import quality matters more than any module.
- **Whatever they actually ask for.** Build from Phase 0 notes, not from this document.
- **Backup automation for the hosted side.** `scripts/backup-db.sh` covers self-host. Hosted relies on Supabase's own backups — fine now, not fine at ten customers.
- **Mandatory MFA enforcement.** The mechanism exists but nothing requires enrolment; a CMMC-conscious customer will ask.
- **Password reuse (800-171 3.5.8).** Currently unenforced and documented as a known limitation in the matrix.

---

## Phase 2 — Scale what works

Only once volume justifies it. Every item has a trigger.

| Item | Trigger | Why |
|---|---|---|
| Demo architecture rework | Demo concurrency regularly above ~15 | Schema-per-tenant costs ~23 MB and 211 tables per sandbox. One shared schema with row-level isolation removes the catalog ceiling. Significant change — do not pre-empt it. |
| Localization (currency, language) | A serious non-US prospect | Nothing is externalised today. Real work, and defense/ITAR customers are US-only by definition — so this signals a deliberate market change. |
| Distributed rate limiting | More than one app replica | Failed-logon limiting is in-process; correct for one container, weaker across several. |
| Integrations | Three prospects naming the same one | Likely order: QuickBooks/Xero, shipping carriers, CAD/PLM. Build the one people ask for, not a platform. |

---

## Phase 3 — Defensible depth

Widening the moat once the base is real.

- **DPAS rated orders** — the one defense-specific gap I could not find in the codebase. Priority-rated orders (DO/DX) change scheduling obligations, and primes ask about it.
- **Supplier portal** — suppliers acknowledging POs and uploading certs directly. Turns the ERP into something the customer's *suppliers* touch, which is very sticky.
- **Shop floor on a tablet** — the floor is where adoption succeeds or fails, and a desk-shaped UI on a shop tablet is a real objection.
- **Tauri desktop client** — a native window pointed at their on-prem server. Small, and a good answer to "can we have an app?"

---

## Explicitly not doing

Written down so it stays decided:

- **More modules.** Fifteen is already more than a 20-person shop uses. Depth in what exists beats breadth.
- **A native bundled `.exe`.** Weeks of work, fragile, and wrong-shaped: a multi-user shop's ERP cannot live on one person's laptop. The Docker on-prem stack plus a thin client covers the real need.
- **Chasing NetSuite feature parity.** Losing game. Win on "inside your boundary, provable, no consultants."
- **Anything before a customer asks.** The last stretch built genuinely necessary infrastructure. The next stretch must be earned by demand.

---

## Known debt

Carrying costs to keep visible.

**Compliance** — documented in the Customer Responsibility Matrix rather than hidden: password reuse unenforced, MFA not mandatory, per-process logon limiting, FIPS mode unverified by the app, and audit triggers defeatable by a database superuser.

**Architecture** — schema-per-tenant is right for real customers (genuine isolation, a selling point) and wrong for throwaway demos. Only demos need rethinking.

**Operational** — Vercel Hobby caps cron at daily, so demo reaping leans on visitor traffic; that stops being adequate with real volume. Supabase free tier is 500 MB, which the demo pool sizing already assumes.

---

## How to use this

Review monthly. For every proposed feature ask, in order:

1. **Has a paying customer asked for it?** No → Phase 0.
2. **Does it unblock a sale in progress?** Yes → do it now, regardless of phase.
3. **Does it widen the on-premise compliance moat?** Yes → strong candidate.
4. **Is it here because it is fun to build?** Be honest. Sometimes the answer is fine — just know that is the reason.
