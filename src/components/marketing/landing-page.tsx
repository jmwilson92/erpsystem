import Link from "next/link";
import {
  Factory,
  FlaskConical,
  Clock,
  Shield,
  FileBarChart,
  GitBranch,
  ShieldCheck,
  Boxes,
  Rocket,
  Plug,
  Check,
  ArrowRight,
  Compass,
  Landmark,
  Plane,
  Wrench,
  Cpu,
  Layers,
  CircleHelp,
  Sparkles,
  Timer,
  Database,
  Users,
} from "lucide-react";
import { PLANS, TRIAL_DAYS } from "@/lib/services/subscription";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import {
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_LEGAL,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";

const FEATURES = [
  {
    icon: Factory,
    title: "Shop floor to cash",
    body: "Quote → sales order → work order → ship. Shipping auto-raises the AR invoice and posts revenue + COGS; receiving auto-vouchers AP with a 3-way match.",
  },
  {
    icon: FlaskConical,
    title: "Quality that closes the loop",
    body: "NCRs and MRB dispositions that actually do things — return shipments, replacement PRs, rework orders — plus the full QMS suite: calibration, tool control, ESD, FOD, HAZMAT, audits, counterfeit.",
  },
  {
    icon: GitBranch,
    title: "Engineering & configuration management",
    body: "Requirements → BOM → work instructions → test procedures, all revision-controlled through one ECR/ECO change process. Nothing on the floor references an uncontrolled copy.",
  },
  {
    icon: Boxes,
    title: "Supply chain, connected",
    body: "Purchase requests route to the charge owner, buyers package them into POs, receiving lands stock in inventory, and Kanban raises replenishment before you run out.",
  },
  {
    icon: Clock,
    title: "Timecards your people will fill out",
    body: "Auto-created per pay period, grid entry by charge code, OT rules, PTO auto-fill, routed approvals — straight into payroll and job cost from one entry.",
  },
  {
    icon: Landmark,
    title: "Real accounting, not a bolt-on",
    body: "GL on your basis and fiscal calendar, AR/AP, month-end close that locks the period, bank feeds via Plaid, and payroll — all posting automatically from the work.",
  },
  {
    icon: Shield,
    title: "Government property & compliance",
    body: "GFP/CAP tracking, DD-1149 gates at receiving, UID, DFARS accountability, and AS9100-shaped quality records.",
  },
  {
    icon: FileBarChart,
    title: "Reports for everything",
    body: "P&L, balance sheet, agings, WIP, inventory valuation, OTD, NCR log, timecards — on screen or CSV, zero setup.",
  },
  {
    icon: Compass,
    title: "Guided, not gatekept",
    body: "Interactive tours walk every process — so new hires get productive without a consultant, and you never wonder where a feature lives.",
  },
];

const INDUSTRIES = [
  {
    icon: Plane,
    title: "Aerospace & defense",
    body: "AS9100-shaped quality, government property, configuration control, and full traceability from lot to serial.",
  },
  {
    icon: Cpu,
    title: "Electronics & assemblies",
    body: "Multi-level BOMs, work instructions, test procedures, ESD/FOD programs, and serial-tracked builds.",
  },
  {
    icon: Wrench,
    title: "Precision job shops",
    body: "Work orders, travelers, inventory, purchasing, and job cost without enterprise bloat or six-month implementations.",
  },
  {
    icon: Layers,
    title: "High-mix manufacturers",
    body: "Quotes to cash, engineering change, MRB, and accounting in one system — not a stack of tools that never talk.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Claim your instance",
    body: "Pick a plan, check out securely, and land in your own isolated company. No shared multi-tenant soup.",
  },
  {
    n: "02",
    title: "Import & invite",
    body: "Load your item master, set pay periods, and invite the team. The setup wizard walks the rest.",
  },
  {
    n: "03",
    title: "Run the work",
    body: "Quotes, POs, work orders, quality, and payroll post into the same ledger. Enter data once.",
  },
  {
    n: "04",
    title: "Close the books",
    body: "Ship raises AR. Receive raises AP. Month-end locks the period. Your shop floor finally feeds finance.",
  },
];

const FAQS = [
  {
    q: "What is ForgeRP?",
    a: "ForgeRP is cloud manufacturing ERP software for shops that build real hardware. It connects sales, engineering, purchasing, production, quality, HR, and accounting so one transaction flows through the whole company.",
  },
  {
    q: "Who is manufacturing ERP software for?",
    a: "Small and mid-size manufacturers — especially aerospace, defense, electronics, precision assembly, and high-mix job shops — that have outgrown spreadsheets and disconnected point tools but don't want a multi-year enterprise rollout.",
  },
  {
    q: "How long is the free trial?",
    a: `You get full product access for ${TRIAL_DAYS} days. Your card is not charged until the trial ends, and you have 15 days after the first charge to request a full refund under our refund policy.`,
  },
  {
    q: "Do I need consultants or an implementation project?",
    a: "No. ForgeRP is designed as plug-and-play manufacturing ERP: import your data, run the setup wizard, and start working. Interactive in-app tours replace the usual army of consultants.",
  },
  {
    q: "Is ForgeRP suitable for AS9100 and government contracts?",
    a: "Yes. Quality is AS9100-shaped (NCR, MRB, CAPA, calibration, audits), configuration management is revision-controlled, and government property (GFP/CAP), UID, and DFARS-style accountability are first-class — not bolted-on modules.",
  },
  {
    q: "What's included in every plan?",
    a: "Every paid plan is the full product. Tiers differ by seat count, not by locking features behind higher SKUs. Unlimited data, every module, free guided onboarding, and your data stays yours.",
  },
  {
    q: "Can I try the product before I buy?",
    a: "Yes — take the live demo (a sandboxed test drive with sample data) or start a 45-day free trial on your own instance with Stripe checkout.",
  },
  {
    q: "How is pricing structured?",
    a: "Simple annual plans by seat band (Starter, Growth, Business) plus Enterprise for larger teams that need SSO, self-host, or custom modules. No per-module nickel-and-diming.",
  },
];

const TRUST = [
  { icon: Timer, label: `${TRIAL_DAYS}-day free trial` },
  { icon: ShieldCheck, label: "AS9100-shaped QMS" },
  { icon: Database, label: "Isolated company data" },
  { icon: Users, label: "No consultants required" },
  { icon: Sparkles, label: "15-day money-back" },
];

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

function JsonLd() {
  const base = getSiteUrl();
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE" && p.price > 0);

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    legalName: SITE_LEGAL,
    url: base,
    description: SITE_DESCRIPTION,
    email: "legal@forge-rp.live",
    foundingLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
    sameAs: [] as string[],
  };

  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Manufacturing ERP",
    operatingSystem: "Web",
    url: base,
    description: SITE_DESCRIPTION,
    offers: paid.map((p) => ({
      "@type": "Offer",
      name: `${p.name} plan`,
      price: String(p.price),
      priceCurrency: "USD",
      description: p.blurb,
      url: `${base}/signup?plan=${p.key.toLowerCase()}`,
      availability: "https://schema.org/InStock",
      priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
    })),
    featureList: FEATURES.map((f) => f.title),
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: base,
    description: SITE_DESCRIPTION,
    publisher: { "@type": "Organization", name: SITE_NAME },
    inLanguage: "en-US",
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  const payloads = [organization, software, website, faq];

  return (
    <>
      {payloads.map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}
    </>
  );
}

export function LandingPage() {
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const enterprise = PLANS.find((p) => p.key === "ENTERPRISE");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <JsonLd />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-teal-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
      >
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* Hero */}
        <section
          className="relative overflow-hidden"
          aria-labelledby="hero-heading"
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(20,184,166,0.18),transparent)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(2,6,23,0.4))]"
            aria-hidden
          />
          <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
              <Plug className="h-3.5 w-3.5" aria-hidden />
              Plug-and-play manufacturing ERP
            </p>
            <h1
              id="hero-heading"
              className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
            >
              The manufacturing ERP that runs your{" "}
              <span className="bg-gradient-to-r from-teal-300 to-sky-400 bg-clip-text text-transparent">
                whole shop
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">
              {SITE_TAGLINE}. Sales, engineering, purchasing, production,
              quality, and accounting in one connected system — no integration
              project, no consultants to hire. Enter data once; it follows the
              work everywhere.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-900/30 transition-colors hover:bg-teal-400"
              >
                Start your 45-day free trial{" "}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-teal-500/50"
              >
                <Rocket className="h-4 w-4" aria-hidden /> Take the live demo
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Full access for {TRIAL_DAYS} days. No charge until day {TRIAL_DAYS}{" "}
              · 15-day money-back guarantee.
            </p>
          </div>
        </section>

        {/* Trust bar */}
        <section
          aria-label="Why manufacturers choose ForgeRP"
          className="border-y border-slate-800/70 bg-slate-900/40"
        >
          <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-5">
            {TRUST.map((t) => (
              <li
                key={t.label}
                className="inline-flex items-center gap-2 text-sm text-slate-300"
              >
                <t.icon className="h-4 w-4 text-teal-400" aria-hidden />
                {t.label}
              </li>
            ))}
          </ul>
        </section>

        {/* Plug and play */}
        <section
          aria-labelledby="value-heading"
          className="border-b border-slate-800/70"
        >
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 id="value-heading" className="sr-only">
              Why plug-and-play manufacturing ERP
            </h2>
            <div className="grid gap-8 sm:grid-cols-3">
              {[
                {
                  icon: Rocket,
                  h: "Live in a day",
                  b: "Import your item master, claim your instance, invite your team. The setup wizard handles the rest — no implementation project.",
                },
                {
                  icon: Plug,
                  h: "One connected system",
                  b: "Every module shares the same data. A receipt updates inventory, AP, and job cost at once — nothing to sync.",
                },
                {
                  icon: ShieldCheck,
                  h: "Compliance built in",
                  b: "AS9100-shaped quality, government property, configuration management, and audit trails come standard, not as add-ons.",
                },
              ].map((c) => (
                <div key={c.h}>
                  <c.icon className="h-6 w-6 text-teal-400" aria-hidden />
                  <h3 className="mt-3 text-base font-semibold">{c.h}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                    {c.b}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section
          id="who"
          className="scroll-mt-20 mx-auto max-w-6xl px-6 py-20"
          aria-labelledby="who-heading"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
              Built for manufacturers
            </p>
            <h2
              id="who-heading"
              className="mt-2 text-3xl font-bold tracking-tight"
            >
              Manufacturing ERP for shops that can&rsquo;t afford chaos
            </h2>
            <p className="mt-3 text-slate-400">
              If your floor still runs on spreadsheets, shared drives, and three
              systems that never agree, {SITE_NAME} is the single system of
              record that replaces the tangle.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {INDUSTRIES.map((ind) => (
              <div
                key={ind.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
              >
                <ind.icon className="h-6 w-6 text-teal-400" aria-hidden />
                <h3 className="mt-3 font-semibold">{ind.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {ind.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section
          id="how"
          className="scroll-mt-20 border-y border-slate-800/70 bg-slate-900/30"
          aria-labelledby="how-heading"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
                How it works
              </p>
              <h2
                id="how-heading"
                className="mt-2 text-3xl font-bold tracking-tight"
              >
                From signup to shipping without a project plan
              </h2>
            </div>
            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5"
                >
                  <span className="font-mono text-xs font-semibold text-teal-400">
                    {s.n}
                  </span>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="scroll-mt-20 mx-auto max-w-6xl px-6 py-20"
          aria-labelledby="features-heading"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
              Modules
            </p>
            <h2
              id="features-heading"
              className="mt-2 text-3xl font-bold tracking-tight"
            >
              Everything a shop needs, in one manufacturing ERP
            </h2>
            <p className="mt-3 text-slate-400">
              {SITE_NAME} replaces the tangle of spreadsheets, point tools, and
              disconnected apps most manufacturers run on — shop floor execution,
              quality, supply chain, configuration management, and the books.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition-colors hover:border-slate-700"
              >
                <f.icon className="h-6 w-6 text-teal-400" aria-hidden />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="scroll-mt-20 border-t border-slate-800/70 bg-slate-900/30"
          aria-labelledby="pricing-heading"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
                Pricing
              </p>
              <h2
                id="pricing-heading"
                className="mt-2 text-3xl font-bold tracking-tight"
              >
                Simple, per-year manufacturing ERP pricing
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-slate-400">
                Every plan is the full product — the tiers are just seat counts.
                Start with a {TRIAL_DAYS}-day free trial; your card isn&rsquo;t
                charged until it ends, and you have 15 days after that to request
                a full refund.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-4">
              {paid.map((p) => (
                <div
                  key={p.key}
                  className={`relative flex flex-col rounded-2xl border p-6 ${
                    p.key === "GROWTH"
                      ? "border-teal-500/60 bg-teal-500/[0.06] ring-1 ring-teal-500/30"
                      : "border-slate-800 bg-slate-950/40"
                  }`}
                >
                  {p.key === "GROWTH" && (
                    <span className="absolute right-4 top-4 rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-950">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{money(p.price)}</span>
                    <span className="text-sm text-slate-500">/year</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Up to {p.seats} users
                  </p>
                  <p className="mt-3 text-sm text-slate-400">{p.blurb}</p>
                  <Link
                    href={`/signup?plan=${p.key.toLowerCase()}`}
                    className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                      p.key === "GROWTH"
                        ? "bg-teal-500 text-slate-950 hover:bg-teal-400"
                        : "border border-slate-700 text-slate-100 hover:border-teal-500/50"
                    }`}
                  >
                    Start free trial
                  </Link>
                </div>
              ))}
            </div>

            {enterprise && (
              <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-6 sm:flex-row">
                <div>
                  <h3 className="text-lg font-semibold">{enterprise.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {enterprise.blurb}
                  </p>
                </div>
                <Link
                  href="/signup?plan=enterprise"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold transition-colors hover:border-teal-500/50"
                >
                  Contact sales <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            )}

            <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
              {[
                "Every module included",
                "Unlimited data",
                "Free guided onboarding",
                "Cancel anytime in trial",
                "Your data stays yours",
              ].map((x) => (
                <li key={x} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-teal-400" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ — rich content + FAQPage schema */}
        <section
          id="faq"
          className="scroll-mt-20 mx-auto max-w-3xl px-6 py-20"
          aria-labelledby="faq-heading"
        >
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
              FAQ
            </p>
            <h2
              id="faq-heading"
              className="mt-2 text-3xl font-bold tracking-tight"
            >
              Manufacturing ERP questions, answered
            </h2>
            <p className="mt-3 text-slate-400">
              Straight answers before you start a trial or demo.
            </p>
          </div>
          <div className="mt-10 space-y-3">
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-1 open:border-teal-500/30"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-left font-medium text-slate-100 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-start gap-2">
                    <CircleHelp
                      className="mt-0.5 h-4 w-4 shrink-0 text-teal-400"
                      aria-hidden
                    />
                    {item.q}
                  </span>
                  <span
                    className="shrink-0 text-slate-500 transition-transform group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="border-t border-slate-800/80 pb-4 pt-3 text-sm leading-relaxed text-slate-400">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section
          className="border-t border-slate-800/70 bg-gradient-to-b from-slate-900/50 to-slate-950"
          aria-labelledby="cta-heading"
        >
          <div className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2
              id="cta-heading"
              className="text-3xl font-bold tracking-tight"
            >
              Run your shop on one manufacturing system
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-400">
              Take the live demo for a spin, or start your free trial and be
              running today — full ERP, zero implementation theater.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-900/30 transition-colors hover:bg-teal-400"
              >
                Start your 45-day free trial
              </Link>
              <Link
                href="/demo"
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold transition-colors hover:border-teal-500/50"
              >
                Take the live demo
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Questions?{" "}
              <a
                href="mailto:legal@forge-rp.live"
                className="text-teal-400 hover:underline"
              >
                legal@forge-rp.live
              </a>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
