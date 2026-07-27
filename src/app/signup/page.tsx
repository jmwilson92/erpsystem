import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SignupPlanForm } from "@/components/marketing/signup-plan-form";
import {
  PLANS,
  TRIAL_DAYS,
  periodPriceForPlan,
  planSeatsLabel,
} from "@/lib/services/subscription";
import { launchPromoActive, stripeEnabled } from "@/lib/services/stripe";
import { actionStartTrial } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: `Start a ${TRIAL_DAYS}-day free trial of ForgeRP manufacturing ERP. Full product access, secure Stripe checkout, no charge until the trial ends.`,
  alternates: { canonical: "/signup" },
  openGraph: {
    title: "Start your ForgeRP free trial",
    description: `${TRIAL_DAYS}-day free trial of plug-and-play manufacturing ERP. Every module included.`,
    url: "/signup",
  },
  robots: {
    index: true,
    follow: true,
  },
};

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

const ERRORS: Record<string, string> = {
  plan: "Please choose a plan to continue.",
  email: "That email doesn't look right — please check and try again.",
  unavailable:
    "Self-serve checkout isn't switched on yet. Please reach out and we'll set you up.",
  stripe: "We couldn't start checkout just now. Please try again in a moment.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const planParam = (Array.isArray(sp.plan) ? sp.plan[0] : sp.plan) || "";
  const selected = PLANS.find(
    (p) => p.key.toLowerCase() === planParam.toLowerCase()
  );
  const errorKey = (Array.isArray(sp.error) ? sp.error[0] : sp.error) || "";
  const errorMsg = ERRORS[errorKey];
  const cancelled =
    (Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout) === "cancel";
  const canCheckout = stripeEnabled();
  const promoOn = launchPromoActive();
  const paidPlans = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const defaultPlan =
    selected && selected.key !== "ENTERPRISE" ? selected.key : "SHOP";

  const selectedSummary = selected
    ? selected.pricing === "per_seat"
      ? `You're starting on ${selected.name} (${money(selected.pricePerSeatMonthly ?? 30)}/user/mo, ${planSeatsLabel(selected)}). Set quantity for the seats you need.`
      : selected.pricing === "custom"
        ? `You're interested in ${selected.name} — contact sales after trial setup, or pick a self-serve plan below.`
        : `You're starting on the ${selected.name} plan (${money(selected.price)}/year, ${planSeatsLabel(selected)}).`
    : "Pick a plan and get the full product for 45 days, free. Small shops start at $30/user/mo.";

  return (
    <MarketingShell>
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">
          Start your free trial
        </h1>
        <p className="mt-3 text-slate-400">{selectedSummary}</p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            How the trial works
          </h2>
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
            {errorMsg ||
              "Checkout was cancelled — no card was charged. Pick up where you left off below."}
          </div>
        )}

        {canCheckout ? (
          <SignupPlanForm
            plans={[...paidPlans]}
            defaultPlan={defaultPlan}
            defaultSeats={3}
            action={actionStartTrial}
            trialDays={TRIAL_DAYS}
            promoOn={promoOn}
          />
        ) : (
          /* Stripe not configured yet — stay honest and route to a human. */
          <div className="mt-8 rounded-2xl border border-teal-500/30 bg-teal-500/[0.06] p-6 text-center">
            <p className="text-sm text-slate-200">
              Self-serve checkout opens at launch. Want in early, or have
              questions about a plan? Shop starts at{" "}
              {money(periodPriceForPlan("SHOP", 1))}/month for one user.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <a
                href="mailto:hello@forge-rp.live?subject=ForgeRP%20trial"
                className="rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
              >
                Request early access
              </a>
              <Link
                href="/demo"
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold hover:border-teal-500/50"
              >
                Take the demo instead
              </Link>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-600">
          By starting a trial you agree to our{" "}
          <Link
            href="/legal/terms-of-service"
            className="text-slate-400 hover:underline"
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy-policy"
            className="text-slate-400 hover:underline"
          >
            Privacy Policy
          </Link>
          . Free for {TRIAL_DAYS} days.
        </p>
      </div>
    </MarketingShell>
  );
}
