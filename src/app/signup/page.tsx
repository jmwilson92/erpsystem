import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PLANS, TRIAL_DAYS } from "@/lib/services/subscription";
import { launchPromoActive, stripeEnabled } from "@/lib/services/stripe";
import { actionStartTrial } from "./actions";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

const ERRORS: Record<string, string> = {
  plan: "Please choose a plan to continue.",
  email: "That email doesn't look right — please check and try again.",
  unavailable: "Self-serve checkout isn't switched on yet. Please reach out and we'll set you up.",
  stripe: "We couldn't start checkout just now. Please try again in a moment.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const planParam = (Array.isArray(sp.plan) ? sp.plan[0] : sp.plan) || "";
  const selected = PLANS.find((p) => p.key.toLowerCase() === planParam.toLowerCase());
  const errorKey = (Array.isArray(sp.error) ? sp.error[0] : sp.error) || "";
  const errorMsg = ERRORS[errorKey];
  const cancelled = (Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout) === "cancel";
  const canCheckout = stripeEnabled();
  const promoOn = launchPromoActive();
  const paidPlans = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const defaultPlan = selected && selected.key !== "ENTERPRISE" ? selected.key : "STARTER";

  return (
    <MarketingShell>
      <div className="mx-auto max-w-2xl px-6 py-16">
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

        {(errorMsg || cancelled) && (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {errorMsg || "Checkout was cancelled — no card was charged. Pick up where you left off below."}
          </div>
        )}

        {canCheckout ? (
          <form action={actionStartTrial} className="mt-6">
            <fieldset>
              <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Choose your plan
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {paidPlans.map((p) => (
                  <label
                    key={p.key}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 transition-colors has-[:checked]:border-teal-500/60 has-[:checked]:bg-teal-500/[0.06]"
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={p.key}
                      defaultChecked={p.key === defaultPlan}
                      className="mt-1 accent-teal-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-sm text-slate-400">{money(p.price)}/yr</span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">Up to {p.seats} users</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Work email</span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Company name</span>
                <input
                  type="text"
                  name="company"
                  autoComplete="organization"
                  placeholder="Acme Manufacturing"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
                />
              </label>
            </div>

            <button
              type="submit"
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-teal-500/20 transition-transform hover:scale-[1.01]"
            >
              Continue to secure checkout →
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              You&apos;ll add a card on Stripe&apos;s secure page. No charge for {TRIAL_DAYS} days
              {promoOn ? " — the 50%-off-first-year launch offer is applied automatically." : "."}
            </p>
          </form>
        ) : (
          /* Stripe not configured yet — stay honest and route to a human. */
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
        )}

        <p className="mt-6 text-center text-xs text-slate-600">
          By starting a trial you agree to our{" "}
          <Link href="/legal/terms-of-service" className="text-slate-400 hover:underline">Terms</Link> and{" "}
          <Link href="/legal/privacy-policy" className="text-slate-400 hover:underline">Privacy Policy</Link>.
          Free for {TRIAL_DAYS} days.
        </p>
      </div>
    </MarketingShell>
  );
}
