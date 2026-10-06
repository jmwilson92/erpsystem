/**
 * Approved comparison-page copy.
 * Dollar amounts and the trial length are tokens. Fill them from
 * subscription-plans.ts at render time so the page cannot drift from the catalog.
 * Do not publish SOURCES-AND-FLAGS or the draft banner that came with the source files.
 */
export const PROSHOP_BODY = `# Protessera vs. ProShop ERP: which one fits your AS9100 job shop?

If you run a small precision or aerospace-defense shop and you're looking at ERP options, ProShop ERP is probably on your list. It's a mature, paperless ERP/QMS built by people who ran a CNC machine shop. Protessera is a newer manufacturing ERP built around the same kind of floor: travelers, controlled work instructions, NCR/MRB, and lot-to-serial traceability.

This page covers where each one fits, how the traveler and quality workflow compares, what setup and pricing look like, and when ProShop is the better choice. We describe ProShop only from its own public pages and link to them, so you can check our work.

## Who each tool fits

**ProShop ERP fits shops that want a proven, all-in paperless system with a long history in machine shops.** ProShop says it was "originally built in-house to run a CNC machine shop" and is "purpose-built for job shops, machine shops, fabrication shops." It combines ERP, MES, and QMS in one browser-based system, and ProShop expects nearly every employee to have a login. Its QMS covers document control, training, NCRs, and audits, and ProShop also sells QMS consulting for ISO 9001, AS9100, and ISO 13485 certification. ([get.proshoperp.com](https://get.proshoperp.com/), [ProShop QMS](https://proshoperp.com/product/quality-management-system/))

**Protessera fits small precision and aerospace-defense shops that want one connected system they can try on their own first.** It covers sales, engineering/BOM, purchasing and receiving, production, quality, and accounting in one data model. The quality records follow how AS9100 shops already work: NCR, MRB, CAPA, calibration, and audits. Protessera is an early public product. You can open a sandbox demo plant or start a self-serve trial without talking to sales first.

## Side-by-side comparison

| | **Protessera** | **ProShop ERP** |
|---|---|---|
| **Built for** | Small precision and aerospace-defense shops, electronics/assembly, high-mix manufacturers | Job shops, machine shops, and fab shops in aerospace, defense, medical, and space ([source](https://get.proshoperp.com/)) |
| **Track record** | Early public product, new in market | Built in-house at a CNC machine shop and sold as an established product ([source](https://get.proshoperp.com/)) |
| **Digital traveler** | Work-order traveler with per-step sign-off. Each person signs with their own PIN. Test steps take a measured value and need a Pass or Fail | 100% paperless. Every employee gets a login, with workstations or tablets placed around the floor. ProShop describes itself as a "system of execution" that enforces your workflows ([source](https://get.proshoperp.com/), [home](https://proshoperp.com/)) |
| **Work instructions** | Production work orders pull the latest released work-instruction revision. Only released WIs can be linked to a BOM | Setup sheets, tool lists, inspection plans, and drawings are stored with the job ([source](https://get.proshoperp.com/)) |
| **BOM control** | Production work orders accept only a certified BOM revision. Certifying for production needs a completed prototype build and a released WI | Not covered on the ProShop pages we reviewed. Ask ProShop |
| **Nonconformance** | A failed receiving inspection opens an NCR and an MRB case and moves the stock to quarantine. A failed test step on the traveler opens an NCR. Rework and repair dispositions create rework work orders | Integrated QMS with NCRs, corrective actions, and audits ([source](https://proshoperp.com/product/quality-management-system/)) |
| **Traceability** | Material genealogy on each work order (every kitted lot back to the PO and receipt it came in on), plus per-unit serial as-built genealogy | Markets "FDA-grade traceability built into every operation" and an audit trail of every sign-off and change ([source](https://proshoperp.com/)) |
| **Quality docs and certification help** | Quality records are built in. No certification consulting offered | FAIR and cert-package generation, plus QMS consulting toward AS9100/ISO certification ([source](https://proshoperp.com/product/quality-management-system/)) |
| **Accounting** | General ledger, AR/AP, payroll, and banking are built in | Estimating, inventory, job costing, and labor tracking data are kept in the system ([source](https://get.proshoperp.com/)) |
| **Deployment** | Hosted service. Self-hosted deployment is scoped through the Enterprise plan | Cloud on ProShop's servers or on-premises on your own servers ([source](https://get.proshoperp.com/)) |
| **Pricing** | {{PRICING_TABLE}} | Quote-based, by user type (shop, office, executive/admin) ([source](https://proshoperp.com/pricing/), [FAQ](https://get.proshoperp.com/)) |
| **Try before you buy** | Sandbox demo plant with sample data, no card. {{TRIAL_DAYS}}-day free trial, no card to start | Request a demo and pricing proposal ([source](https://proshoperp.com/pricing/)) |
| **On the roadmap / not offered today (Protessera)** | SSO, barcode/RFID shop-floor scanning, 21 CFR Part 11-style e-signatures, DCMA export packages | — |

## The traveler and quality workflow

The traveler and the quality loop are where these systems get judged. Here's how Protessera does it, step by step.

**1. The job starts from controlled data.** A production work order accepts only a *certified* BOM revision. If the revision is still draft or prototype, the system blocks it and points you to a prototype work order. Getting a BOM certified for production takes a completed prototype build and a *released* work instruction for that part. When the work order is created, it picks up the latest released work-instruction revision.

**2. Operators sign steps with their own PIN.** Each traveler step that needs sign-off takes a PIN, and the PIN must belong to the person signing. An account with no PIN can't sign. Test steps record the measured value and need an explicit Pass or Fail.

**3. Failures open records.** If a test step fails, the system opens an NCR against the work order. If a receipt fails inspection at the receiving dock, the system opens an NCR and an MRB case and moves the stock to a quarantine location, where it no longer counts as available.

**4. MRB decides, and the floor follows.** Rework and repair dispositions create rework work orders.

**5. Genealogy builds itself.** Each work order shows its material genealogy: every kitted lot, back to the PO and receipt it arrived on. Serialized assemblies get a per-unit as-built record.

**See it in the demo.** The demo plant comes with sample data. Open work order WO-00001 and sign the remaining traveler steps. Then go to Receiving, fail a waiting dock receipt, and watch it land in MRB with the stock quarantined.

**How ProShop handles this:** ProShop's QMS lives inside the ERP, with document control, training, NCRs, and audits, and it generates FAIRs and cert packages ([ProShop QMS](https://proshoperp.com/product/quality-management-system/)). Its MES side stores setup sheets, tool lists, inspection plans, and drawings with the job ([get.proshoperp.com](https://get.proshoperp.com/)). If paperless depth across the whole shop is what matters most, ProShop has years of work behind it.

## Setup and pricing

**Protessera**

- **Pricing is published, with lower first-year launch pricing.** {{PRICING_SETUP}}
- **Trial:** a **{{TRIAL_DAYS}}-day free trial with no card to start**. It opens an empty company of your own. You're asked to pay on day {{TRIAL_DAYS}}, and until then nothing is billed.
- **Demo:** a sandbox demo plant with sample data. No card, and it's deleted when you leave.
- **Setup:** onboarding is self-serve. There's a setup wizard, paste-from-Excel import for parts, customers, suppliers, and people, and email invites for your team. How long a live cutover takes depends on your data and your shop, so we won't promise you a go-live date.

**ProShop ERP**

- **Pricing is not published.** ProShop says pricing is customized and based on users, with three seat types (shop users, office users, executive/admin users) and a choice of "standard vs Government." Request a proposal at [proshoperp.com/pricing](https://proshoperp.com/pricing/). ([FAQ](https://get.proshoperp.com/))
- **Modules:** ProShop sells the system as one connected suite, not module by module ([FAQ](https://get.proshoperp.com/)).
- **Implementation:** ProShop says "most shops are up and running in a few weeks," and its team works with you through the process. Support includes ProShop Academy, a customer portal, and in-app chat. ([FAQ](https://get.proshoperp.com/))

## When ProShop is the better choice

We'd point you to ProShop if:

- **You want a long track record.** ProShop grew out of a working machine shop and is an established product. Protessera is early. If buying from an established vendor matters to your owners or your primes, that counts for a lot.
- **You need on-premises today.** ProShop offers both cloud and on-premises deployment ([FAQ](https://get.proshoperp.com/)). Protessera's standard service is hosted. Self-hosting is scoped case by case through Enterprise.
- **You handle CUI or ITAR technical data and need a hosted answer now.** Protessera's standard hosted service isn't the place for that data (see the FAQ below). ProShop markets ITAR workflows and a dedicated CMMC Level 2 path ([proshoperp.com](https://proshoperp.com/)). Check those claims against your own requirements.
- **You want help getting certified.** ProShop sells QMS consulting and a QMS Assurance Plan toward AS9100, ISO 9001, and ISO 13485 ([ProShop QMS](https://proshoperp.com/product/quality-management-system/)). Protessera gives you the records, not a consulting service.
- **You need SSO, barcode/RFID scanning on the floor, or Part 11-style e-signatures today.** Those are on Protessera's roadmap, not shipping. If you need them on day one, pick a system that has them now, and confirm with ProShop which of these it covers.

Protessera is the better fit if you want published per-seat pricing, want to try the full product yourself before talking to sales, and want travelers, MRB, and genealogy in the same system as purchasing and accounting.

## FAQ

**Is Protessera AS9100 certified, or will it make my shop compliant?**
No. Software doesn't get AS9100 certified, and your shop's certification comes from your QMS and your registrar. What Protessera offers is records built around how AS9100 shops already work: NCR, MRB, CAPA, calibration, audits, and revision-controlled configuration management.

**Can I store CUI, ITAR, or export-controlled technical data in Protessera?**
"Not in the standard hosted service, and we would rather tell you plainly than let you find out during an assessment. DFARS 252.204-7012 requires a cloud provider handling CUI to meet FedRAMP Moderate equivalency; our hosted stack runs on commercial infrastructure that does not. ITAR technical data is stricter still — the encrypted-data carve-out in 22 CFR 120.54 requires genuine end-to-end encryption, which no ERP that queries, reports on, or searches your data can offer. If you handle CUI or ITAR, the answer is a self-hosted deployment inside your own accredited boundary, where you own the assessment and we supply the software and a shared-responsibility matrix. Talk to us and we will scope it honestly."

**How much does Protessera cost compared to ProShop?**
Protessera publishes its prices. {{PRICING_FAQ}} ProShop doesn't publish prices. Its pricing is quote-based by user type, so request a proposal at [proshoperp.com/pricing](https://proshoperp.com/pricing/) to compare on the same headcount.

**How does traveler sign-off work in Protessera?**
Each step that needs sign-off takes the signer's own PIN. Test steps record a measured value and need a Pass or Fail. A failed test step opens an NCR.

**What happens when material fails receiving inspection?**
Failing the receipt at the receiving dock opens an NCR and an MRB case and moves the stock to quarantine. Rework and repair dispositions then create rework work orders.

**Does Protessera have barcode scanning, SSO, or Part 11 e-signatures?**
Not today. Barcode/RFID scanning, SSO, and 21 CFR Part 11-style e-signatures are on the roadmap. If you need them now, ask ProShop (or any vendor you're evaluating) to show them to you live.

**Can I try Protessera without a card?**
Yes. The sandbox demo plant needs no card. The {{TRIAL_DAYS}}-day free trial needs no card to start, and you're asked to pay on day {{TRIAL_DAYS}} if you keep it.

---

## See it on your own terms

Open the demo plant, sign a traveler step, fail a receipt into MRB, and decide for yourself.

**[Take the live demo →](https://www.protessera.com/demo)**
`;

export const JOBBOSS_BODY = `# Protessera vs. JobBOSS²: which one fits your precision job shop?

JobBOSS² from ECI Software Solutions is one of the best-known job shop ERPs. It's strong on quoting, scheduling, and job costing, and it connects to QuickBooks. Protessera is a newer manufacturing ERP for small precision and aerospace-defense shops. It's built around the traveler and the quality loop: PIN step sign-off, controlled work instructions, NCR/MRB with quarantine, and lot-to-serial genealogy.

This page covers who each one fits, how the traveler and quality workflow compares, setup and pricing, and when JobBOSS² is the better choice. Everything about JobBOSS² comes from ECI's own public pages, linked so you can check.

## Who each tool fits

**JobBOSS² fits make-to-order job shops whose biggest problems are quoting, scheduling, and knowing what each job really cost.** ECI describes it as "a purpose-built job-shop ERP that centralizes quoting, job costing, shop-floor scheduling and inventory control," for small and mid-sized manufacturers ([JobBOSS²](https://www.ecisolutions.com/products/jobboss2/)). Quotes run from preset burden rates, labor rates, quantity breaks, setup and run times, and outside services, and they convert to jobs ([quoting](https://www.ecisolutions.com/products/jobboss2/features/quotes/)). Scheduling has two tools: a drag-and-drop Planning Board and a Whiteboard Scheduler, with finite or infinite capacity ([scheduling](https://www.ecisolutions.com/products/jobboss2/features/scheduling/)).

**Protessera fits small precision and aerospace-defense shops whose biggest problem is the traveler-to-quality paper trail.** It's one connected system: sales, engineering/BOM, purchasing and receiving, production, quality, and accounting. The quality records follow how AS9100 shops already work (NCR, MRB, CAPA, calibration, audits), and they sit in the same system as the work order and the PO. Protessera is an early public product. You can open a sandbox demo plant or start a self-serve trial before you talk to anyone.

## Side-by-side comparison

| | **Protessera** | **JobBOSS²** |
|---|---|---|
| **Built for** | Small precision and aerospace-defense shops, electronics/assembly, high-mix manufacturers | Job shops and make-to-order manufacturers: machine, fab, screw, stamping, and spring shops ([source](https://www.ecisolutions.com/products/jobboss2/)) |
| **Track record** | Early public product, new in market | ECI says JobBOSS has been sold "for decades." JobBOSS² was formerly E2 Shop ([source](https://www.ecisolutions.com/products/jobboss/), [features](https://www.ecisolutions.com/products/jobboss2/features/), [FAQ](https://www.ecisolutions.com/products/jobboss2/)) |
| **Quoting and estimating** | Quotes, sales orders, and customers are in the system | Preset-rate estimating, quantity breaks, capacity-aware lead times, and quote-to-order conversion ([source](https://www.ecisolutions.com/products/jobboss2/features/quotes/)) |
| **Scheduling** | Planning/MRP and a value-stream view in the system | Planning Board plus Whiteboard Scheduler, finite or infinite capacity, what-if scenarios ([source](https://www.ecisolutions.com/products/jobboss2/features/scheduling/)) |
| **Job costing** | Receiving creates the AP voucher at PO price × received quantity (3-way match). WIP and inventory valuation reports are built in. Not as deep as JobBOSS² on estimated-vs-actual job costing | Real-time job costing, estimated vs. actual ([source](https://www.ecisolutions.com/products/jobboss2/)) |
| **Digital traveler** | Work-order traveler with per-step sign-off. Each person signs with their own PIN. Test steps take a measured value and need a Pass or Fail | Shop-floor data collection and mobile time tracking ([source](https://www.ecisolutions.com/products/jobboss2/features/), [overview](https://www.ecisolutions.com/products/jobboss2/)) |
| **Work instructions and BOM** | Production work orders accept only a certified BOM and pull the latest released work-instruction revision | BOM creation, including drafts generated from PDFs/Excel/CSV ([source](https://www.ecisolutions.com/products/jobboss2/)) |
| **Nonconformance** | A failed receiving inspection opens an NCR and an MRB case and moves the stock to quarantine. A failed test step opens an NCR. Rework and repair dispositions create rework work orders | Integrated quality module tied to orders: non-conformances, CAPA, document control, calibration tracking, optional auto-generated ISO documentation, uniPoint integration ([source](https://www.ecisolutions.com/products/jobboss2/features/), [overview](https://www.ecisolutions.com/products/jobboss2/)) |
| **Traceability** | Material genealogy per work order (every kitted lot back to the PO and receipt), plus per-unit serial as-built genealogy | Serial control for produced parts and purchased materials ([source](https://www.ecisolutions.com/products/jobboss/)) |
| **Accounting** | Built-in general ledger, AR/AP, payroll, and banking | Built-in GAAP accounting (GL, AR, AP, payroll) or sync to QuickBooks Desktop or Online. Public API and third-party integrations ([source](https://www.ecisolutions.com/products/jobboss2/features/)) |
| **Deployment** | Hosted service. Self-hosted deployment is scoped through the Enterprise plan | Multi-tenant SaaS, private hosted cloud, or on-premises ([source](https://www.ecisolutions.com/products/jobboss2/)) |
| **Pricing** | {{PRICING_TABLE}} | Not published. Tailored to your shop's scale and the functions you need ([source](https://www.ecisolutions.com/products/jobboss2/job-shop-software-pricing/)) |
| **Try before you buy** | Sandbox demo plant with sample data, no card. {{TRIAL_DAYS}}-day free trial, no card to start | Request a demo or a quote ([source](https://www.ecisolutions.com/products/jobboss2/request-a-quote/)) |
| **On the roadmap / not offered today (Protessera)** | SSO, barcode/RFID shop-floor scanning, 21 CFR Part 11-style e-signatures, DCMA export packages, QuickBooks sync | — |

## The traveler and quality workflow

JobBOSS² is built around quoting and scheduling. Protessera is built around the traveler and what happens when a part doesn't pass. Here's that workflow in Protessera:

**1. Controlled data in.** A production work order accepts only a *certified* BOM revision. Draft and prototype revisions are blocked and pointed to a prototype work order. Getting a BOM certified for production takes a completed prototype build and a *released* work instruction. A new work order picks up the latest released work-instruction revision for the part.

**2. Each person signs their own steps.** Traveler steps that need sign-off take the signer's own PIN. An account with no PIN can't sign. Test steps record the measured value and need an explicit Pass or Fail.

**3. Failures open records automatically.** A failed test step opens an NCR against the work order. A receipt that fails inspection at the receiving dock opens an NCR and an MRB case and moves the stock to quarantine, where it no longer counts as available.

**4. MRB dispositions drive the next step.** Rework and repair dispositions create rework work orders.

**5. Genealogy without extra typing.** Each work order shows every kitted lot back to the PO and receipt it came in on. Serialized assemblies get a per-unit as-built record.

**See it in the demo.** The demo plant comes with sample data. Open WO-00001 and sign the remaining traveler steps. Then fail a waiting receipt at the receiving dock and find it in MRB with the stock quarantined.

**How JobBOSS² handles this:** ECI describes JobBOSS² quality as "a fully integrated quality system" tied to orders, covering non-conformances, CAPA, document control, and maintenance, with optional auto-generated ISO documentation and a quality dashboard. It also lists calibration tracking, a uniPoint integration, serial control, and a shop-floor Data Collection Module ([features](https://www.ecisolutions.com/products/jobboss2/features/), [JobBOSS²](https://www.ecisolutions.com/products/jobboss2/), [JobBOSS](https://www.ecisolutions.com/products/jobboss/)). For many job shops that's plenty. The difference is in what's built into the traveler itself: the release and certification gates, per-person PIN sign-off, and dock fail straight to MRB and quarantine.

## Setup and pricing

**Protessera**

- **Pricing is published, with lower first-year launch pricing.** {{PRICING_SETUP}}
- **Trial:** a **{{TRIAL_DAYS}}-day free trial with no card to start**, in an empty company of your own. You're asked to pay on day {{TRIAL_DAYS}}, and until then nothing is billed.
- **Demo:** a sandbox demo plant with sample data. No card, and it's deleted when you leave.
- **Setup:** onboarding is self-serve. There's a setup wizard, paste-from-Excel import for parts, customers, suppliers, and people, and email invites for your team. How long a live cutover takes depends on your data and your shop, so we won't promise you a go-live date.

**JobBOSS²**

- **Pricing is not published.** ECI says pricing "is tailored to the specific scale of your manufacturing operations and the depth of functionality required." Request a quote at [ecisolutions.com](https://www.ecisolutions.com/products/jobboss2/job-shop-software-pricing/).
- **Implementation:** ECI says implementation "takes around 3-6 months to complete," led by its team of job shop experts. It also offers a Business Process Assessment. ([FAQ](https://www.ecisolutions.com/products/jobboss2/), [JobBOSS](https://www.ecisolutions.com/products/jobboss/))
- **Support:** ECI says its customer support is based in the United States ([FAQ](https://www.ecisolutions.com/products/jobboss2/)).

## When JobBOSS² is the better choice

We'd point you to JobBOSS² if:

- **Quoting, scheduling, and job costing are your main problems.** Preset-rate estimating, quantity breaks, two scheduling tools, what-if lead times, and estimated-vs-actual job costing are JobBOSS²'s home turf, and they've been refined over a long time.
- **You want to keep QuickBooks.** JobBOSS² syncs with QuickBooks Desktop and Online. Protessera has its own built-in accounting and doesn't offer a QuickBooks sync.
- **You want a long-established vendor.** ECI has offered JobBOSS for decades. Protessera is early.
- **You handle CUI or ITAR technical data and need a hosted answer now.** Protessera's standard hosted service isn't the place for that data (see the FAQ). ECI says JobBOSS² "complies with ITAR standards" and offers private hosted cloud and on-premises options ([FAQ](https://www.ecisolutions.com/products/jobboss2/)). Check those claims against your own requirements.
- **You need on-premises or a private hosted cloud today.** ECI offers both, plus multi-tenant SaaS ([FAQ](https://www.ecisolutions.com/products/jobboss2/)). Protessera's standard service is hosted. Self-hosting is scoped case by case through Enterprise.
- **You need SSO, barcode/RFID scanning on the floor, or Part 11-style e-signatures today.** Those are on Protessera's roadmap, not shipping. If you need them on day one, pick a system that has them now, and confirm with ECI which of these JobBOSS² covers.

Protessera is the better fit if your pain is the traveler-to-NCR-to-MRB trail, you want work instructions and BOMs gated by release and certification, and you want published per-seat pricing with a trial you can run yourself.

## FAQ

**Is Protessera AS9100 certified, or will it make my shop compliant?**
No. Software doesn't get AS9100 certified, and your shop's certification comes from your QMS and your registrar. Protessera's records are built around how AS9100 shops already work: NCR, MRB, CAPA, calibration, audits, and revision-controlled configuration management.

**Can I store CUI, ITAR, or export-controlled technical data in Protessera?**
"Not in the standard hosted service, and we would rather tell you plainly than let you find out during an assessment. DFARS 252.204-7012 requires a cloud provider handling CUI to meet FedRAMP Moderate equivalency; our hosted stack runs on commercial infrastructure that does not. ITAR technical data is stricter still — the encrypted-data carve-out in 22 CFR 120.54 requires genuine end-to-end encryption, which no ERP that queries, reports on, or searches your data can offer. If you handle CUI or ITAR, the answer is a self-hosted deployment inside your own accredited boundary, where you own the assessment and we supply the software and a shared-responsibility matrix. Talk to us and we will scope it honestly."

**How does Protessera's pricing compare with JobBOSS²?**
Protessera publishes its prices. {{PRICING_FAQ}} ECI doesn't publish JobBOSS² prices and quotes each shop by scale and functionality, so [request a quote](https://www.ecisolutions.com/products/jobboss2/job-shop-software-pricing/) to compare on the same headcount.

**Does Protessera integrate with QuickBooks?**
No. Protessera has its own general ledger, AR/AP, payroll, and banking. If staying on QuickBooks is a requirement, JobBOSS² syncs with QuickBooks Desktop and Online.

**How does traveler sign-off work in Protessera?**
Each step that needs sign-off takes the signer's own PIN. Test steps record a measured value and need a Pass or Fail. A failed test step opens an NCR.

**What happens when material fails receiving inspection?**
Failing the receipt at the receiving dock opens an NCR and an MRB case and moves the stock to quarantine. Rework and repair dispositions then create rework work orders.

**Can I try Protessera without a card?**
Yes. The sandbox demo plant needs no card. The {{TRIAL_DAYS}}-day free trial needs no card to start, and you're asked to pay on day {{TRIAL_DAYS}} if you keep it.

---

## Try the traveler yourself

Open the demo plant, sign a traveler step, fail a receipt into MRB, and see whether it fits your floor.

**[Take the live demo →](https://www.protessera.com/demo)**
`;
