import Link from "next/link";
import { Factory, Check, ArrowLeft } from "lucide-react";
import { PLANS, TRIAL_DAYS } from "@/lib/services/subscription";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const planParam = (Array.isArray(sp.plan) ? sp.plan[0] : sp.plan) || "";
  const selected = PLANS.find((p) => p.key.toLowerCase() === planParam.toLowerCase());

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500 text-slate-950">
              <Factory className="h-4 w-4" />
            </span>
            ForgeRP
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Start your free trial</h1>
        <p className="mt-3 text-slate-400">
          {selected
            ? `You're starting on the ${selected.name} plan (${money(selected.price)}/year, up to ${selected.seats} users).`
            : "Pick a plan and get the full product for 45 days, free."}
        </p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">How the trial works</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {[
              "Full access to every module for 45 days — no feature locked.",
              "A card is required to start, but you're not charged until day 45.",
              "Cancel anytime during the trial and you're never billed.",
              "After the charge, you have 15 days to request a full refund.",
              "Launch offer: 50% off your first year for a limited time.",
            ].map((x) => (
              <li key={x} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
                {x}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {PLANS.filter((p) => p.key !== "ENTERPRISE").map((p) => (
            <div
              key={p.key}
              className={`rounded-xl border p-4 ${
                selected?.key === p.key ? "border-teal-500/60 bg-teal-500/[0.06]" : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-slate-400">{money(p.price)}/yr</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Up to {p.seats} users</p>
            </div>
          ))}
        </div>

        {/* Phase 3 replaces this with Stripe checkout. Kept honest pre-launch. */}
        <div className="mt-8 rounded-2xl border border-teal-500/30 bg-teal-500/[0.06] p-6 text-center">
          <p className="text-sm text-slate-200">
            Self-serve checkout opens at launch. Want in early, or have questions about a plan?
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a
              href="mailto:hello@forge-rp.live?subject=ForgeRP%20trial"
              className="rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
            >
              Request early access
            </a>
            <Link href="/demo" className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold hover:border-teal-500/50">
              Take the demo instead
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          By starting a trial you agree to our{" "}
          <Link href="/legal/terms-of-service" className="text-slate-400 hover:underline">Terms</Link> and{" "}
          <Link href="/legal/privacy-policy" className="text-slate-400 hover:underline">Privacy Policy</Link>.
          Free for {TRIAL_DAYS} days.
        </p>
      </main>
    </div>
  );
}
