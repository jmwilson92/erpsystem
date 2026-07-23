import Link from "next/link";
import {
  Factory,
  FlaskConical,
  Clock,
  Users2,
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
} from "lucide-react";
import { PLANS } from "@/lib/services/subscription";

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

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

export function LandingPage() {
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const enterprise = PLANS.find((p) => p.key === "ENTERPRISE");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500 text-slate-950">
              <Factory className="h-4 w-4" />
            </span>
            ForgeRP
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 sm:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <Link href="/demo" className="hover:text-white">Live demo</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-teal-500 px-3.5 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(20,184,166,0.15),transparent)]" />
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
            <Plug className="h-3.5 w-3.5" /> Plug-and-play manufacturing ERP
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">
            The ERP that runs your{" "}
            <span className="bg-gradient-to-r from-teal-300 to-sky-400 bg-clip-text text-transparent">
              whole shop
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300">
            Sales, engineering, purchasing, production, quality, and accounting in one
            connected system. No integrations to wire, no consultants to hire — enter data
            once and it follows the work everywhere.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-400"
            >
              Start your 45-day free trial <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-teal-500/50"
            >
              <Rocket className="h-4 w-4" /> Take the live demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Full access for 45 days. No charge until day 45 · 15-day money-back guarantee.
          </p>
        </div>
      </section>

      {/* Plug and play */}
      <section className="border-y border-slate-800/70 bg-slate-900/30">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3">
          {[
            { icon: Rocket, h: "Live in a day", b: "Import your item master, claim your instance, invite your team. The setup wizard handles the rest — no implementation project." },
            { icon: Plug, h: "One connected system", b: "Every module shares the same data. A receipt updates inventory, AP, and job cost at once — nothing to sync." },
            { icon: ShieldCheck, h: "Compliance built in", b: "AS9100-shaped quality, government property, configuration management, and audit trails come standard, not as add-ons." },
          ].map((c) => (
            <div key={c.h}>
              <c.icon className="h-6 w-6 text-teal-400" />
              <h3 className="mt-3 text-base font-semibold">{c.h}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{c.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">Everything a shop needs, in one place</h2>
          <p className="mt-3 text-slate-400">
            ForgeRP replaces the tangle of spreadsheets, point tools, and disconnected apps
            most manufacturers run on.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <f.icon className="h-6 w-6 text-teal-400" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-slate-800/70 bg-slate-900/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Simple, per-year pricing</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-400">
              Every plan is the full product — the tiers are just seat counts. Start with a
              45-day free trial; your card isn&rsquo;t charged until it ends, and you have 15
              days after that to request a full refund.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-4">
            {paid.map((p) => (
              <div
                key={p.key}
                className={`flex flex-col rounded-2xl border p-6 ${
                  p.key === "GROWTH"
                    ? "border-teal-500/60 bg-teal-500/[0.06] ring-1 ring-teal-500/30"
                    : "border-slate-800 bg-slate-950/40"
                }`}
              >
                {p.key === "GROWTH" && (
                  <span className="mb-3 w-fit rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-950">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{money(p.price)}</span>
                  <span className="text-sm text-slate-500">/year</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Up to {p.seats} users</p>
                <p className="mt-3 text-sm text-slate-400">{p.blurb}</p>
                <Link
                  href="/signup"
                  className={`mt-6 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold ${
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
                <p className="mt-1 text-sm text-slate-400">{enterprise.blurb}</p>
              </div>
              <Link
                href="/signup?plan=enterprise"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold hover:border-teal-500/50"
              >
                Contact sales <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
            {["Every module included", "Unlimited data", "Free guided onboarding", "Cancel anytime in trial", "Your data stays yours"].map((x) => (
              <li key={x} className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-teal-400" /> {x}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Run your shop on one system</h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-400">
          Take the live demo for a spin, or start your free trial and be running today.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-400">
            Start your 45-day free trial
          </Link>
          <Link href="/demo" className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold hover:border-teal-500/50">
            Take the live demo
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-teal-400" />
            <span>© {new Date().getFullYear()} ForgeRP</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/legal/terms-of-service" className="hover:text-slate-300">Terms</Link>
            <Link href="/legal/privacy-policy" className="hover:text-slate-300">Privacy</Link>
            <Link href="/legal/cookie-policy" className="hover:text-slate-300">Cookies</Link>
            <Link href="/legal/refund-policy" className="hover:text-slate-300">Refunds</Link>
            <Link href="/legal" className="hover:text-slate-300">All legal</Link>
            <Link href="/demo" className="hover:text-slate-300">Demo</Link>
            <Link href="/login" className="hover:text-slate-300">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
