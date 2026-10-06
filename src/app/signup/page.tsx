import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SignupPlanForm } from "@/components/marketing/signup-plan-form";
import {
  PLANS,
  TRIAL_DAYS,
  firstYearOfferSummary,
  planPriceView,
  planSeatsLabel,
} from "@/lib/services/subscription";
import { actionStartTrial } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: `Start a ${TRIAL_DAYS}-day free trial of Protessera manufacturing ERP. No credit card. ${firstYearOfferSummary()}`,
  alternates: { canonical: "/signup" },
  openGraph: {
    title: "Start your Protessera free trial",
    description: `${TRIAL_DAYS}-day free trial, no card. ${firstYearOfferSummary()}`,
    url: "/signup",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const ERRORS: Record<string, string> = {
  plan: "Please choose a plan to continue.",
  email: "That email doesn't look right — please check and try again.",
  unavailable:
    "Self-serve checkout isn't switched on yet. Please reach out and we'll set you up.",
  stripe: "We couldn't start checkout just now. Please try again in a moment.",
  provision: "We couldn't open your plant just now. Please try again.",
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
  const paidPlans = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const defaultPlan =
    selected && selected.key !== "ENTERPRISE" ? selected.key : "SHOP";
  const selectedView = selected ? planPriceView(selected.key) : null;

  const selectedSummary = selected
    ? selected.pricing === "custom"
      ? `You're interested in ${selected.name}. Enterprise is quoted. Pick a self-serve plan below, or contact sales after you open the plant.`
      : `You're starting on ${selected.name} (${planSeatsLabel(selected)}). ${selectedView?.primaryAmount}${selectedView?.primarySuffix}. ${selectedView?.note ? `${selectedView.note} ` : ""}${selectedView?.afterYearOne}`
    : `Pick a plan and get the full product for ${TRIAL_DAYS} days, free. No card. ${firstYearOfferSummary()}`;

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
              `Full access to every module for ${TRIAL_DAYS} days — no feature locked.`,
              "No credit card to start. Set a password and walk into your plant.",
              `On day ${TRIAL_DAYS} we ask you to subscribe. Until then, nothing is billed.`,
              "If you do not subscribe, the plant stays but the floor locks until you add a card.",
              firstYearOfferSummary(),
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

        <SignupPlanForm
          plans={[...paidPlans]}
          defaultPlan={defaultPlan}
          defaultSeats={3}
          action={actionStartTrial}
          trialDays={TRIAL_DAYS}
        />

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
          . Free for {TRIAL_DAYS} days. No card required.
        </p>
      </div>
    </MarketingShell>
  );
}
