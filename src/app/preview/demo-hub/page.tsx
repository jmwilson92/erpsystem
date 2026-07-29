import Link from "next/link";
import { PreviewHeader, PreviewFooter } from "@/components/marketing/preview-chrome";

export default function PreviewDemoHubPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PreviewHeader />
      <main className="flex-1">
        <section
          id="demo"
          className="relative overflow-hidden px-6 pb-12 pt-16 text-center"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              background: `
                radial-gradient(55% 50% at 50% 0%, rgba(20,184,166,0.22), transparent 70%),
                url(/marketing-preview/A-factory-command-center.jpg) center/cover
              `,
            }}
            aria-hidden
          />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
              Your ERP experience is ready
            </p>
            <h1 className="mx-auto mt-3 max-w-xl text-4xl font-bold tracking-tight sm:text-5xl">
              Run the{" "}
              <span className="bg-gradient-to-r from-teal-300 to-sky-400 bg-clip-text text-transparent">
                whole shop
              </span>{" "}
              in one sandbox
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">
              You&apos;re past the splash. Explore a live plant — or jump to
              pricing and FAQ without losing the header/footer.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/demo"
                className="rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-900/30 hover:bg-teal-400"
              >
                Start free test drive
              </Link>
              <Link
                href="#pricing"
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold hover:border-teal-500/50"
              >
                See pricing
              </Link>
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-2xl font-bold tracking-tight">What you&apos;ll click through</h2>
          <p className="mt-1 text-slate-400">Same modules customers run after they buy seats.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Shop floor → cash", "Quote, sales order, work order, ship. AR and COGS post themselves."],
              ["Quality that acts", "NCR / MRB dispositions open rework, RMA, or return shipments."],
              ["Purchasing & inventory", "Catalog PRs, receipts, bins, availability you can trust."],
              ["Carina voice AI", "Ask plant questions and walk modules — included for paid seats."],
            ].map(([t, b]) => (
              <div
                key={t}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
              >
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-slate-400">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-2xl font-bold tracking-tight">Pricing</h2>
          <p className="mt-1 text-slate-400">
            Shop is $30/user/mo (1–10 seats). Larger plants pick flat annual bands.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Shop", "$30", "/user/mo", "1–10 seats · pay for quantity"],
              ["Starter", "$3,600", "/yr", "Up to 30 users · full product"],
              ["Growth", "$8,400", "/yr", "Up to 100 users"],
              ["Business", "$18,000", "/yr", "Up to 250 users"],
            ].map(([name, amt, unit, blurb], i) => (
              <div
                key={name}
                className={`rounded-2xl border p-5 ${
                  i === 1
                    ? "border-teal-500/50 bg-teal-500/[0.06]"
                    : "border-slate-800 bg-slate-900/40"
                }`}
              >
                <h3 className="font-semibold">{name}</h3>
                <p className="mt-2 text-2xl font-bold">
                  {amt}{" "}
                  <span className="text-sm font-normal text-slate-500">{unit}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">{blurb}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="text-2xl font-bold tracking-tight">FAQ</h2>
          <p className="mt-1 text-slate-400">
            Visible inside the demo experience — not only on the splash.
          </p>
          <div className="mt-6 space-y-3">
            {[
              [
                "Do customers see “Starting your ERP experience” every time?",
                "No. That splash is only for the public apex site (protessera.com). Paying customers use company.protessera.com and go straight to login.",
              ],
              [
                "What’s included in every plan?",
                "Full product. Tiers differ by seats, not locked modules. Unlimited data, guided onboarding, your data stays yours.",
              ],
              [
                "How do I get back to pricing from the demo?",
                "Header and footer stay on every public page — Pricing and FAQ are always one click away.",
              ],
              [
                "How does the company URL work?",
                "At checkout we assign a slug (e.g. acme) → acme.protessera.com. That host maps to their tenant and skips marketing.",
              ],
            ].map(([q, a]) => (
              <details
                key={q}
                className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
              >
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-2 text-sm text-slate-400">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <PreviewFooter />
    </div>
  );
}
