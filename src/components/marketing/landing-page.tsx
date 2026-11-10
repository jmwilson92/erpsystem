import Link from "next/link";
import Image from "next/image";
import {
  Boxes,
  Check,
  ArrowRight,
  CircleHelp,
  ClipboardCheck,
  Factory,
  GitBranch,
  Landmark,
  MonitorSmartphone,
  Plug,
  Rocket,
  ScanLine,
} from "lucide-react";
import {
  PLANS,
  TRIAL_DAYS,
  SHOP_FREE_SEATS,
  SHOP_PAID_MIN_SEATS,
  planSeatsLabel,
  formatPlanMoney,
  getPlan,
  firstYearOfferSummary,
  firstYearPeriodPriceForPlan,
  planPriceView,
  pricingSectionLead,
  type PlanDef,
} from "@/lib/services/subscription-plans";
import { PlanPriceBlock } from "./plan-price";
import { FoundingMemberOffer } from "./founding-member-offer";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { CircleLink } from "./circle-link";
import { HomeIndustries } from "./home-industries";
import { HomeAi } from "./home-ai";
import { actionStartPublicCheckout } from "@/app/pricing/actions";
import { COMPARE_PAGES } from "@/lib/compare/pages";
import {
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_LEGAL,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";

const CAPABILITIES = [
  {
    id: "traceability",
    icon: ScanLine,
    title: "Traceability and audit-ready records",
    body: "Lot and serial trace, revision history, and an audit trail on the transactions that move material and money.",
    href: "/demo",
  },
  {
    id: "quality",
    icon: ClipboardCheck,
    title: "Quality: NCR, MRB, and CAR",
    body: "Nonconformances, MRB dispositions that open returns, replacement buys, or rework, and corrective actions on the same record.",
    href: "/demo",
  },
  {
    id: "plm",
    icon: GitBranch,
    title: "PLM and the bill of materials",
    body: "Requirements, BOMs, work instructions, and test procedures stay revision-controlled through one ECR/ECO path.",
    href: "/demo",
  },
  {
    id: "production",
    icon: Factory,
    title: "Production and the shop floor",
    body: "Work orders, travelers with PIN sign-off, workcenters, kitting, and a floor board of what is running and what is held.",
    href: "/demo",
  },
  {
    id: "purchasing",
    icon: Boxes,
    title: "Purchasing and receiving",
    body: "Purchase requests route to the charge owner, buyers cut POs, and receiving lands stock — including a DD-1149 gate for furnished property.",
    href: "/demo",
  },
  {
    id: "accounting",
    icon: Landmark,
    title: "Accounting, GovCon, and program cost",
    body: "GL, AR, AP, and payroll post from the work. Government property is tracked beside the books, and PMO rolls project cost up to the product.",
    href: "/demo",
  },
  {
    id: "mobile",
    icon: MonitorSmartphone,
    title: "Shop floor in the browser",
    body: "The floor board, travelers, and PIN sign-off run in the browser, including on a station screen. QR labels open the web traveler.",
    href: "/demo",
  },
  {
    id: "integrations",
    icon: Plug,
    title: "Integrations that are actually wired",
    body: "Optional Plaid bank feeds, OFX, QFX, and CSV statement import, plus CSV in and out for people, items, and financial reports.",
    href: "/demo",
  },
  {
    id: "onboarding",
    icon: Rocket,
    title: "Onboarding without a project plan",
    body: "Import the item master, run the setup wizard, and invite the team. In-app tours walk the work. No consultant engagement is required.",
    href: "/signup",
  },
] as const;

const FAQS = [
  {
    q: "What is Protessera?",
    a: "Protessera is cloud manufacturing ERP software for shops that build real hardware. It connects sales, engineering, purchasing, production, quality, HR, and accounting so one transaction flows through the whole company.",
  },
  {
    q: "Who is manufacturing ERP software for?",
    a: "Small and mid-size manufacturers — especially aerospace, defense, electronics, precision assembly, and high-mix job shops — that have outgrown spreadsheets and disconnected point tools but don't want a multi-year enterprise rollout.",
  },
  {
    q: "How long is the free trial?",
    a: `You get full product access for ${TRIAL_DAYS} days. No credit card is required to start. Nothing is billed until you choose to subscribe. When you subscribe, the first 12 months bill at the first-year price, then standard prices apply outside the founding-member offer. Founding members who purchase by March 9, 2027 lock in the current first-year prices for life. You have 15 days after the first charge to request a full refund under our refund policy.`,
  },
  {
    q: "Do I need consultants or an implementation project?",
    a: "No. Protessera is designed as plug-and-play manufacturing ERP: import your data, run the setup wizard, and start working. Interactive in-app tours replace the usual army of consultants.",
  },
  {
    q: "Is Protessera suitable for AS9100 and government contract work?",
    a: "For the workflow and the records, yes — quality is AS9100-shaped (NCR, MRB, CAPA, calibration, audits), configuration management is revision-controlled, and government property (GFP/CAP), UID, and DFARS-style accountability are first-class rather than bolted on. What the hosted service is not is an enclave for controlled data: see the next question before you put CUI or export-controlled technical data anywhere near it.",
  },
  {
    q: "Can I store CUI, ITAR, or export-controlled technical data in Protessera?",
    a: "Not in the standard hosted service, and we would rather tell you plainly than let you find out during an assessment. DFARS 252.204-7012 requires a cloud provider handling CUI to meet FedRAMP Moderate equivalency; our hosted stack runs on commercial infrastructure that does not. ITAR technical data is stricter still — the encrypted-data carve-out in 22 CFR 120.54 requires genuine end-to-end encryption, which no ERP that queries, reports on, or searches your data can offer. If you handle CUI or ITAR, the answer is a self-hosted deployment inside your own accredited boundary, where you own the assessment and we supply the software and a shared-responsibility matrix. Talk to us and we will scope it honestly.",
  },
  {
    q: "What's included in every plan?",
    a: "Every paid plan is the full product. Tiers differ by seat count, not by locking features behind higher SKUs. Unlimited data, every module, free guided onboarding, and your data stays yours.",
  },
  {
    q: "Can I try the product before I buy?",
    a: `Yes — take the live demo (a sandboxed test drive with sample data) or start a ${TRIAL_DAYS}-day free trial on your own instance. No credit card required.`,
  },
  {
    q: "How is pricing structured?",
    a: `${firstYearOfferSummary()} Founding members who purchase by March 9, 2027 lock in the current first-year prices for life. Every paid plan is the full product — no per-module nickel-and-diming.`,
  },
];

/** Schema.org price: the first-year amount a new customer pays (Shop ≤5 users = free). */
function offerPrice(p: PlanDef): string {
  return String(
    firstYearPeriodPriceForPlan(p.key, p.pricing === "per_seat" ? 1 : null)
  );
}

function offerDescription(p: PlanDef): string {
  const view = planPriceView(p.key);
  return [p.blurb, view.note, view.afterYearOne].filter(Boolean).join(" ");
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
  factory: "/marketing/product-inventory.png",
  product: "/marketing/product-work-orders.png",
  operator: "/marketing/product-value-stream.png",
  isometric: "/marketing/product-test-center.png",
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
      description: offerDescription(p),
      url: `${base}/signup?plan=${p.key.toLowerCase()}`,
      availability: "https://schema.org/InStock",
      priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
    })),
    featureList: CAPABILITIES.map((f) => f.title),
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

/** Shared by /welcome and the public /pricing page. Trial and pay-now both stay. */
export function PricingSection() {
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const enterprise = PLANS.find((p) => p.key === "ENTERPRISE");
  return (
    <CinematicSection id="pricing" image={ART.product}>
      <div className="mx-auto max-w-6xl px-6 py-20">
        <SectionIntro
          eyebrow="Pricing"
          title="Fair pricing from the smallest shop to the largest plant"
          titleId="pricing-heading"
          center
          wide
        >
          {pricingSectionLead()} If you subscribe, you have 15 days after the
          first charge to request a full refund.
        </SectionIntro>

        <FoundingMemberOffer className="mx-auto mt-8 max-w-3xl" />
        <p className="tile mx-auto mt-3 max-w-3xl rounded-xl px-4 py-2 text-center text-xs">Standard renewal prices shown below apply outside the founding-member offer.</p>

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
                <PlanPriceBlock
                  planKey={p.key}
                  className="mt-2"
                  suffixClassName="muted text-sm font-medium"
                  detailClassName="muted mt-1 text-xs"
                />
                <p className="muted mt-1 text-xs">{planSeatsLabel(p)}</p>
                <p className="muted mt-3 flex-1 text-sm">{p.blurb}</p>
                <Link
                  href={`/signup?plan=${p.key.toLowerCase()}`}
                  className={`mt-5 w-full ${
                    featured ? primaryBtnClass : secondaryBtnClass
                  }`}
                >
                  {p.pricing === "per_seat" ? "Start free" : "Start free trial"}
                </Link>
                <form action={actionStartPublicCheckout} className="mt-2">
                  <input type="hidden" name="plan" value={p.key} />
                  {p.pricing === "per_seat" ? (
                    <input type="hidden" name="seats" value="6" />
                  ) : null}
                  <button
                    type="submit"
                    className={`${secondaryBtnClass} w-full`}
                  >
                    {p.pricing === "per_seat" ? "Pay for 6–10 users" : "Pay now"}
                  </button>
                </form>
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
  );
}

const homeCanvas = {
  backgroundColor: "#f4f7fb",
  backgroundImage: [
    "radial-gradient(ellipse 72% 48% at 6% -8%, rgba(253, 224, 71, 0.55), transparent 58%)",
    "radial-gradient(ellipse 58% 42% at 100% 0%, rgba(45, 212, 191, 0.32), transparent 52%)",
    "radial-gradient(ellipse 48% 36% at 78% 42%, rgba(147, 197, 253, 0.38), transparent 56%)",
    "radial-gradient(ellipse 46% 34% at 0% 72%, rgba(254, 240, 138, 0.32), transparent 52%)",
  ].join(","),
} as const;

function shopPaidLine(): string {
  const shop = getPlan("SHOP");
  const base = formatPlanMoney(shop?.firstYearPrice ?? 0);
  const extra = formatPlanMoney(shop?.firstYearAdditionalPerSeat ?? 0);
  const max = shop?.maxSeats ?? 10;
  return `Paid Shop, first year: ${base}/mo for the first user + ${extra}/mo for each additional user (${SHOP_PAID_MIN_SEATS}–${max} users).`;
}

/** Homepage pricing. Full pay-now checkout stays on /pricing via PricingSection. */
function HomePricing() {
  const paid = PLANS.filter((plan) => plan.key !== "ENTERPRISE");
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-28">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">
            Pricing
          </p>
          <h2
            id="pricing-heading"
            className="mt-3 text-4xl font-semibold tracking-tight text-[#10203f] sm:text-5xl"
          >
            Simple, straightforward pricing
          </h2>
          <Link
            href="/pricing"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-[#10203f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
          >
            See pricing details
          </Link>
        </div>

        <FoundingMemberOffer className="mx-auto mt-8 max-w-3xl" />
        <p className="tile mx-auto mt-3 max-w-3xl rounded-xl px-4 py-2 text-center text-xs">Standard renewal prices shown below apply outside the founding-member offer.</p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {paid.map((plan) => {
            const featured = plan.key === "GROWTH";
            const shop = plan.key === "SHOP";
            const view = planPriceView(plan.key);
            return (
              <article
                key={plan.key}
                className={`relative flex flex-col rounded-[24px] bg-white p-6 shadow-[0_14px_40px_rgba(16,32,63,0.08)] ring-1 ring-[#10203f]/5 ${
                  featured ? "ring-2 ring-[#10203f]" : ""
                }`}
              >
                {featured ? (
                  <span className="absolute right-4 top-4 rounded-full bg-[#10203f] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                ) : null}
                {shop ? (
                  <span className="absolute right-4 top-4 rounded-full bg-[#e7f7f4] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0f766e]">
                    Small teams
                  </span>
                ) : null}
                <h3 className="pr-24 text-lg font-semibold text-[#10203f]">{plan.name}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[#3d4d66]">{plan.blurb}</p>
                <p className="mt-5 text-[#10203f]">
                  <span className="block text-4xl font-semibold tracking-tight">{view.primaryAmount}</span>
                  {view.primarySuffix ? (
                    <span className="mt-1 block text-sm font-medium text-[#3d4d66]">
                      {view.primarySuffix.replace(/^\s+/, "")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[#3d4d66]">
                  {shop ? shopPaidLine() : view.afterYearOne}
                </p>
                {shop && view.afterYearOne ? (
                  <p className="mt-1 text-xs leading-relaxed text-[#3d4d66]">{view.afterYearOne}</p>
                ) : null}
                <Link
                  href={`/signup?plan=${plan.key.toLowerCase()}`}
                  className="mt-5 inline-flex items-center justify-center rounded-full bg-[#10203f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
                >
                  {plan.pricing === "per_seat" ? "Start free" : "Start free trial"}
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-[#3d4d66]">
          Every plan is the full product. Enterprise, for 251 or more users, is quoted on the{" "}
          <Link href="/pricing" className="font-semibold text-[#10203f] underline">
            pricing page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

const PROOF = [
  {
    value: String(TRIAL_DAYS),
    unit: "days",
    title: "Free trial",
    body: "Full product access. No credit card to start. Nothing is billed until you subscribe.",
    className: "lg:col-span-2 lg:row-span-2",
    background: "linear-gradient(160deg, #fff3bf 0%, #ffffff 68%)",
    valueClass: "text-7xl sm:text-8xl",
  },
  {
    value: String(SHOP_FREE_SEATS),
    unit: "users",
    title: "Shop stays free",
    body: `Shop is free for up to ${SHOP_FREE_SEATS} users. A sixth user moves that shop onto paid Shop.`,
    className: "lg:col-span-2",
    background: "linear-gradient(160deg, #d9f6f1 0%, #ffffff 72%)",
    valueClass: "text-6xl",
  },
  {
    value: "All",
    unit: "modules",
    title: "Full product on every plan",
    body: "Tiers change the seat count. They do not lock modules behind a higher plan.",
    className: "",
    background: "linear-gradient(160deg, #dbeafe 0%, #ffffff 72%)",
    valueClass: "text-6xl",
  },
  {
    value: "15",
    unit: "days",
    title: "Refund on the first charge",
    body: "After you subscribe, you have 15 days from the first charge to request a full refund.",
    className: "",
    background: "linear-gradient(160deg, #fef3c7 0%, #e0f2fe 100%)",
    valueClass: "text-6xl",
  },
] as const;

export function LandingPage({
  /** Include SiteHeader / SiteFooter (default). Off when nested under Spinning up the Shop. */
  showChrome = true,
  /** Overview hero. Off when the ended-demo splash is already the hero. */
  showClassicHero = true,
}: {
  showChrome?: boolean;
  showClassicHero?: boolean;
} = {}) {
  return (
    <div
      className={`marketing-story marketing-home ${showChrome ? "min-h-screen" : ""}`}
      style={homeCanvas}
    >
      <JsonLd />
      {showChrome ? (
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#10203f] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
      ) : null}
      {showChrome ? <SiteHeader /> : null}

      <main id={showChrome ? "main" : "story"}>
        {showClassicHero ? (
          <section
            id="overview"
            aria-labelledby="hero-heading"
            className="scroll-mt-28"
          >
            <div className="mx-auto max-w-6xl px-6 pb-8 pt-10 text-center sm:pt-16">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">
                Manufacturing ERP
              </p>
              <h1
                id="hero-heading"
                className="mx-auto mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-[#10203f] sm:text-6xl"
              >
                The record of the job, from quote to the books
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#3d4d66]">
                {SITE_TAGLINE}. {SITE_NAME} connects sales, engineering, purchasing,
                production, quality, and accounting so a high-reliability shop enters
                the work once. Built for aerospace, defense, medical devices, and
                precision job shops.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-[#10203f] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
                >
                  Start your {TRIAL_DAYS}-day free trial
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#10203f] ring-1 ring-[#c5d0de] hover:bg-[#f7f9fc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
                >
                  Take the live demo
                </Link>
              </div>
              <FoundingMemberOffer className="mx-auto mt-5 max-w-2xl" />
              <p className="mt-4 text-sm text-[#3d4d66]">
                <Link href="/demo" className="font-semibold text-[#10203f] underline">
                  www.protessera.com/demo
                </Link>
                <span className="mx-2 text-[#94a3b8]" aria-hidden>
                  ·
                </span>
                {TRIAL_DAYS} days free, no card. 15-day refund after the first charge.
              </p>
            </div>
            <div className="mx-auto max-w-6xl px-6 pb-16">
              <div className="overflow-hidden rounded-[28px] bg-[#0f172a] shadow-[0_24px_70px_rgba(16,32,63,0.16)] ring-1 ring-[#10203f]/10">
                <Image
                  src="/marketing/product-value-stream.png"
                  alt="Protessera value stream map from suppliers through receiving, inspection, inventory, production, and shipping"
                  width={1600}
                  height={900}
                  priority
                  className="h-auto w-full"
                />
              </div>
            </div>
          </section>
        ) : null}

        <section id="industries" aria-labelledby="industries-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">
                Industries
              </p>
              <h2
                id="industries-heading"
                className="mt-3 text-4xl font-semibold tracking-tight text-[#10203f] sm:text-5xl"
              >
                Workflows arranged around the way your shop already builds
              </h2>
            </div>
            <div className="mt-10">
              <HomeIndustries />
            </div>
          </div>
        </section>

        <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">AI</p>
            <h2
              id="ai-heading"
              className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-[#10203f] sm:text-5xl"
            >
              Carina answers from the plant, and can file the work when you confirm
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#3d4d66]">
              The assistant is in the product help bubble. Agents run the same services
              as the screens — work orders, purchase requests, parts, customers, and
              time off — and they ask before they change a record.
            </p>
            <div className="mt-8">
              <HomeAi />
            </div>
          </div>
        </section>

        <section id="proof" aria-labelledby="proof-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-6xl px-6 py-16 text-center sm:py-20">
            <h2
              id="proof-heading"
              className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-[#10203f] sm:text-5xl"
            >
              The numbers we will put on the offer
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[#3d4d66]">
              Trial length, the free Shop tier, what every plan includes, and the refund
              window. These are the commercial terms — not a customer study.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center justify-center rounded-full bg-[#10203f] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
            >
              Start your {TRIAL_DAYS}-day free trial
            </Link>
            <div className="mt-12 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
              {PROOF.map((card) => (
                <article
                  key={card.title}
                  className={`rounded-[28px] p-6 shadow-[0_12px_40px_rgba(16,32,63,0.06)] ring-1 ring-white/80 sm:p-8 ${card.className}`}
                  style={{ background: card.background }}
                >
                  <p className={`font-semibold tracking-tight text-[#10203f] ${card.valueClass}`}>
                    {card.value}
                    <span className="ml-2 align-middle text-lg font-medium text-[#3d4d66]">
                      {card.unit}
                    </span>
                  </p>
                  <h3 className="mt-4 text-lg font-semibold text-[#10203f]">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#3d4d66]">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <h2
              id="features-heading"
              className="max-w-3xl text-4xl font-semibold tracking-tight text-[#10203f] sm:text-5xl"
            >
              Experience the Protessera difference
            </h2>
            <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <article key={item.id} id={item.id} className="scroll-mt-28">
                  <item.icon className="h-6 w-6 text-[#10203f]" strokeWidth={1.75} aria-hidden />
                  <h3 className="mt-3 text-base font-semibold text-[#10203f]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#3d4d66]">{item.body}</p>
                  <div className="mt-4">
                    <CircleLink href={item.href}>Learn more</CircleLink>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <HomePricing />

        <section id="stories" aria-labelledby="stories-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">
              Customer stories
            </p>
            <h2
              id="stories-heading"
              className="mt-3 text-3xl font-semibold tracking-tight text-[#10203f] sm:text-4xl"
            >
              See the product, not a borrowed quote
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#3d4d66]">
              Protessera does not publish customer counts, ROI, or payback figures.
              The way to judge the system is to run it. Comparisons with other job-shop
              systems are linked under Resources.
            </p>
            <Link
              href="/demo"
              className="mt-6 inline-flex items-center justify-center rounded-full bg-[#10203f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
            >
              www.protessera.com/demo
            </Link>
          </div>
        </section>

        <section id="resources" aria-labelledby="resources-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-6xl px-6 pb-8">
            <h2 id="resources-heading" className="text-2xl font-semibold tracking-tight text-[#10203f]">
              Resources
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {COMPARE_PAGES.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={page.slug}
                    className="block rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#10203f] shadow-sm ring-1 ring-[#10203f]/5 hover:ring-[#10203f]/20"
                  >
                    {page.navLabel}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/pricing"
                  className="block rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#10203f] shadow-sm ring-1 ring-[#10203f]/5 hover:ring-[#10203f]/20"
                >
                  Pricing details
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/refund-policy"
                  className="block rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#10203f] shadow-sm ring-1 ring-[#10203f]/5 hover:ring-[#10203f]/20"
                >
                  Refund policy
                </Link>
              </li>
            </ul>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-28">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0f766e]">FAQ</p>
              <h2
                id="faq-heading"
                className="mt-3 text-4xl font-semibold tracking-tight text-[#10203f]"
              >
                Manufacturing ERP questions, answered
              </h2>
              <p className="mt-3 text-base text-[#3d4d66]">
                Straight answers before you start a trial or demo.
              </p>
            </div>
            <div className="mt-10 space-y-3">
              {FAQS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl bg-white px-5 shadow-[0_10px_30px_rgba(16,32,63,0.06)] ring-1 ring-[#10203f]/5 open:ring-[#10203f]/15"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-left font-medium text-[#10203f] marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-start gap-2">
                      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-[#0f766e]" aria-hidden />
                      {item.q}
                    </span>
                    <span className="shrink-0 text-[#10203f] transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="border-t border-[#e6edf5] pb-4 pt-3 text-sm leading-relaxed text-[#3d4d66]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {showChrome ? <SiteFooter /> : null}
    </div>
  );
}

