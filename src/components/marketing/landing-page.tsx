import Link from "next/link";
import Image from "next/image";
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
import {
  PLANS,
  TRIAL_DAYS,
  planSeatsLabel,
  type PlanDef,
} from "@/lib/services/subscription";
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
    a: "Shop is $30 per user per month for 1–10 seats (you set the quantity). Larger teams pick a flat annual seat band — Starter (30), Growth (100), or Business (250). Enterprise covers 251+, SSO, self-host, and custom modules. Every paid plan is the full product — no per-module nickel-and-diming.",
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

/** Schema.org / list price: per-seat plans quote 1-seat annual. */
function offerPrice(p: PlanDef): string {
  return String(p.price);
}

function PlanPriceDisplay({ p }: { p: PlanDef }) {
  if (p.pricing === "per_seat") {
    return (
      <div className="mt-2">
        <span className="text-3xl font-bold">{money(p.pricePerSeatMonthly ?? 30)}</span>
        <span className="muted text-sm font-medium">/user/mo</span>
        <p className="muted mt-1 text-xs">
          billed monthly · quantity = seats (max {p.maxSeats})
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <span className="text-3xl font-bold">{money(p.price)}</span>
      <span className="muted text-sm font-medium">/year</span>
    </div>
  );
}

/**
 * Full-bleed cinematic section — no fog on the photo. Text contrast comes from
 * solid local panels (SectionIntro / cards), not a wash over the image.
 */
function CinematicSection({
  id,
  image,
  children,
  className = "",
  priority = false,
}: {
  id?: string;
  image: string;
  children: import("react").ReactNode;
  className?: string;
  /** Set on the first section so its art isn't lazy-loaded (LCP). */
  priority?: boolean;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 overflow-hidden ${className}`}
    >
      {/* next/image (not a CSS background) so these are served as AVIF/WebP at
          a size matched to the device. Full-resolution source art can then be
          dropped in without shipping multi-MB JPEGs to phones. `fill` needs a
          positioned parent, which the wrapper provides. */}
      <div className="absolute inset-0 scale-105" aria-hidden>
        <Image
          src={image}
          alt=""
          fill
          priority={priority}
          quality={82}
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>
      <div className="relative z-10">{children}</div>
    </section>
  );
}

/**
 * Light plaque on photo sections. Forced black type via .marketing-story CSS
 * (beats html.light slate inversion that washes text out).
 */
function SectionIntro({
  eyebrow,
  title,
  titleId,
  children,
  center = false,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  children?: import("react").ReactNode;
  center?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`tile rounded-2xl px-6 py-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] sm:px-8 sm:py-6 ${
        center ? "mx-auto text-center" : ""
      } ${wide ? "max-w-3xl" : "max-w-2xl"}`}
    >
      <p className="eyebrow text-xs font-semibold uppercase tracking-wider">
        {eyebrow}
      </p>
      <h2 id={titleId} className="mt-2 text-3xl font-bold tracking-tight">
        {title}
      </h2>
      {children ? (
        <div className="muted mt-3 text-base leading-relaxed">{children}</div>
      ) : null}
    </div>
  );
}

const cardClass = "tile rounded-2xl p-5 shadow-[0_12px_40px_rgba(0,0,0,0.4)]";

/** Outline CTA: black on white. */
const secondaryBtnClass =
  "btn-outline-black inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors";

/** Solid green CTA — only place white text is allowed. */
const primaryBtnClass =
  "btn-green inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg shadow-teal-900/25 transition-colors";

const ART = {
  factory: "/marketing/A-factory-command-center.jpg",
  product: "/marketing/B-floating-product-ui.jpg",
  operator: "/marketing/C-operator-hologram-wall.jpg",
  isometric: "/marketing/D-isometric-whole-company.jpg",
} as const;

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
      price: offerPrice(p),
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

export function LandingPage({
  /** Include SiteHeader / SiteFooter (default). Off when nested under Opening the Forge. */
  showChrome = true,
  /** Classic plug-and-play hero block. Off when Opening the Forge is already the hero. */
  showClassicHero = true,
}: {
  showChrome?: boolean;
  showClassicHero?: boolean;
} = {}) {
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const enterprise = PLANS.find((p) => p.key === "ENTERPRISE");

  return (
    <div
      className={`marketing-story ${showChrome ? "min-h-screen" : ""} bg-slate-950`}
    >
      <JsonLd />
      {showChrome && (
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-teal-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
        >
          Skip to content
        </a>
      )}
      {showChrome && <SiteHeader />}

      <main id={showChrome ? "main" : "story"}>
        {/* Hero */}
        {showClassicHero && (
        <section
          className="relative overflow-hidden bg-slate-100"
          aria-labelledby="hero-heading"
        >
          <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
            <div className="tile mx-auto max-w-3xl rounded-2xl px-6 py-8 shadow-[0_12px_40px_rgba(0,0,0,0.12)] sm:px-10">
              <p className="eyebrow inline-flex items-center gap-1.5 rounded-full border border-teal-700/30 bg-teal-50 px-3 py-1 text-xs font-semibold">
                <Plug className="h-3.5 w-3.5" aria-hidden />
                Plug-and-play manufacturing ERP
              </p>
              <h1
                id="hero-heading"
                className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
              >
                The manufacturing ERP that runs your{" "}
                <span className="eyebrow">whole shop</span>
              </h1>
              <p className="muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
                {SITE_TAGLINE}. Sales, engineering, purchasing, production,
                quality, and accounting in one connected system — no integration
                project, no consultants to hire. Enter data once; it follows the
                work everywhere.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup" className={`${primaryBtnClass} px-5 py-3`}>
                  Start your 45-day free trial{" "}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/" className={`${secondaryBtnClass} px-5 py-3`}>
                  <Rocket className="h-4 w-4" aria-hidden /> Take the live demo
                </Link>
              </div>
              <p className="muted mt-4 text-xs font-medium">
                Full access for {TRIAL_DAYS} days. No charge until day {TRIAL_DAYS}{" "}
                · 15-day money-back guarantee.
              </p>
            </div>
          </div>
        </section>
        )}

        {/* Trust bar */}
        <section
          aria-label="Why manufacturers choose ForgeRP"
          className="border-y border-slate-300 bg-white"
        >
          <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-5">
            {TRUST.map((t) => (
              <li
                key={t.label}
                className="tile inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm"
              >
                <t.icon className="eyebrow h-4 w-4" aria-hidden />
                {t.label}
              </li>
            ))}
          </ul>
        </section>

        {/* Plug and play */}
        <section
          aria-labelledby="value-heading"
          className="border-b border-slate-300 bg-white"
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
                <div key={c.h} className={cardClass}>
                  <c.icon className="eyebrow h-6 w-6" aria-hidden />
                  <h3 className="mt-3 text-base font-semibold">{c.h}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">{c.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who it's for — operator hologram wall */}
        <CinematicSection id="who" image={ART.operator} priority>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <SectionIntro
              eyebrow="Built for manufacturers"
              title="Manufacturing ERP for shops that can't afford chaos"
              titleId="who-heading"
            >
              If your floor still runs on spreadsheets, shared drives, and three
              systems that never agree, {SITE_NAME} is the single system of
              record that replaces the tangle.
            </SectionIntro>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {INDUSTRIES.map((ind) => (
                <div key={ind.title} className={cardClass}>
                  <ind.icon className="eyebrow h-6 w-6" aria-hidden />
                  <h3 className="mt-3 font-semibold">{ind.title}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">{ind.body}</p>
                </div>
              ))}
            </div>
          </div>
        </CinematicSection>

        {/* How it works — isometric whole company */}
        <CinematicSection id="how" image={ART.isometric}>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <SectionIntro
              eyebrow="How it works"
              title="From signup to shipping without a project plan"
              titleId="how-heading"
            />
            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className={cardClass}>
                  <span className="eyebrow font-mono text-xs font-semibold">
                    {s.n}
                  </span>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </CinematicSection>

        {/* Features — factory command center */}
        <CinematicSection id="features" image={ART.factory}>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <SectionIntro
              eyebrow="Modules"
              title="Everything a shop needs, in one manufacturing ERP"
              titleId="features-heading"
            >
              {SITE_NAME} replaces the tangle of spreadsheets, point tools, and
              disconnected apps most manufacturers run on — shop floor execution,
              quality, supply chain, configuration management, and the books.
            </SectionIntro>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <article
                  key={f.title}
                  className={`${cardClass} transition-colors hover:border-teal-600`}
                >
                  <f.icon className="eyebrow h-6 w-6" aria-hidden />
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </CinematicSection>

        {/* Pricing — floating product UI */}
        <CinematicSection id="pricing" image={ART.product}>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <SectionIntro
              eyebrow="Pricing"
              title="Fair pricing from the smallest shop to the largest plant"
              titleId="pricing-heading"
              center
              wide
            >
              Shop is $30 per user per month (1–10 seats). Larger teams get flat
              annual bands. Every plan is the full product. Start with a{" "}
              {TRIAL_DAYS}-day free trial; your card isn&rsquo;t charged until it
              ends, and you have 15 days after that to request a full refund.
            </SectionIntro>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {paid.map((p) => {
                const featured = p.key === "GROWTH";
                const shopBadge = p.key === "SHOP";
                return (
                  <div
                    key={p.key}
                    className={`relative flex flex-col border p-6 ${cardClass} ${
                      featured
                        ? "border-teal-600 ring-2 ring-teal-600/30"
                        : shopBadge
                          ? "border-cyan-600"
                          : ""
                    }`}
                  >
                    {featured && (
                      <span className="badge-green absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                        Most popular
                      </span>
                    )}
                    {shopBadge && (
                      <span className="badge-green absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                        Small teams
                      </span>
                    )}
                    <h3 className="pr-24 text-lg font-semibold">{p.name}</h3>
                    <PlanPriceDisplay p={p} />
                    <p className="muted mt-1 text-xs">{planSeatsLabel(p)}</p>
                    <p className="muted mt-3 flex-1 text-sm">{p.blurb}</p>
                    <Link
                      href={`/signup?plan=${p.key.toLowerCase()}`}
                      className={`mt-5 ${
                        featured ? primaryBtnClass : secondaryBtnClass
                      }`}
                    >
                      Start free trial
                    </Link>
                  </div>
                );
              })}
            </div>

            {enterprise && (
              <div
                className={`mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row ${cardClass} p-6`}
              >
                <div>
                  <h3 className="text-lg font-semibold">{enterprise.name}</h3>
                  <p className="muted mt-1 text-sm">{enterprise.blurb}</p>
                </div>
                <Link href="/signup?plan=enterprise" className={secondaryBtnClass}>
                  Contact sales <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            )}

            <ul
              className={`mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 ${cardClass} px-5 py-3 text-sm`}
            >
              {[
                "Every module included",
                "Unlimited data",
                "Free guided onboarding",
                "Cancel anytime in trial",
                "Your data stays yours",
              ].map((x) => (
                <li key={x} className="inline-flex items-center gap-1.5">
                  <Check className="eyebrow h-4 w-4 shrink-0" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
        </CinematicSection>

        {/* FAQ — product UI backdrop */}
        <CinematicSection id="faq" image={ART.product}>
          <div className="mx-auto max-w-3xl px-6 py-20">
            <SectionIntro
              eyebrow="FAQ"
              title="Manufacturing ERP questions, answered"
              titleId="faq-heading"
              center
              wide
            >
              Straight answers before you start a trial or demo.
            </SectionIntro>
            <div className="mt-10 space-y-3">
              {FAQS.map((item) => (
                <details
                  key={item.q}
                  className={`group open:border-teal-600 ${cardClass} px-5 py-1`}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-left font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-start gap-2">
                      <CircleHelp
                        className="eyebrow mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden
                      />
                      {item.q}
                    </span>
                    <span
                      className="shrink-0 transition-transform group-open:rotate-45"
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <p className="muted border-t border-slate-200 pb-4 pt-3 text-sm leading-relaxed">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </CinematicSection>

        {/* Final CTA — factory floor */}
        <CinematicSection image={ART.factory}>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className={`${cardClass} mx-auto max-w-2xl px-8 py-8 text-center`}>
              <h2 id="cta-heading" className="text-3xl font-bold tracking-tight">
                Run your shop on one manufacturing system
              </h2>
              <p className="muted mx-auto mt-3 max-w-xl">
                Take the live demo for a spin, or start your free trial and be
                running today — full ERP, zero implementation theater.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup" className={`${primaryBtnClass} px-5 py-3`}>
                  Start your 45-day free trial
                </Link>
                <Link href="/" className={`${secondaryBtnClass} px-5 py-3`}>
                  Take the live demo
                </Link>
              </div>
            </div>
          </div>
        </CinematicSection>
      </main>

      {showChrome && <SiteFooter />}
    </div>
  );
}
