import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PayNowForm } from "@/components/marketing/pay-now-form";
import { PlanPriceBlock } from "@/components/marketing/plan-price";
import {
  PLANS,
  TRIAL_DAYS,
  planSeatsLabel,
  pricingSectionLead,
} from "@/lib/services/subscription-plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description: pricingSectionLead(),
  alternates: { canonical: "/pricing" },
  robots: { index: true, follow: true },
};

const ERRORS: Record<string, string> = {
  plan: "Choose Shop, Starter, Growth, or Business to pay now.",
  email: "That email doesn't look right — leave it blank and Stripe will ask, or try again.",
  unavailable:
    "Self-serve checkout isn't switched on yet. You can still start a free trial.",
  stripe: "We couldn't start checkout just now. Please try again in a moment.",
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const errorKey = (Array.isArray(sp.error) ? sp.error[0] : sp.error) || "";
  const errorMsg = ERRORS[errorKey];
  const cancelled =
    (Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout) === "cancel";
  const paid = PLANS.filter((p) => p.key !== "ENTERPRISE");
  const enterprise = PLANS.find((p) => p.key === "ENTERPRISE");

  return (
    <MarketingShell>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Pricing
        </h1>
        <p className="mt-3 max-w-3xl text-slate-400">
          {pricingSectionLead()} Pay now opens Stripe Checkout with no account
          required. Or start a {TRIAL_DAYS}-day trial with no card.
        </p>

        {(errorMsg || cancelled) && (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {errorMsg ||
              "Checkout was cancelled — no card was charged. You can pay now or start a free trial."}
          </div>
        )}

        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {paid.map((plan) => {
            const isShop = plan.pricing === "per_seat";
            return (
              <div
                key={plan.key}
                className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                <PlanPriceBlock
                  planKey={plan.key}
                  className="mt-2"
                  amountClassName="text-2xl font-bold text-slate-100"
                  suffixClassName="text-sm font-normal text-slate-500"
                  detailClassName="mt-1 text-xs text-slate-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  {planSeatsLabel(plan)}
                </p>
                <p className="mt-3 flex-1 text-sm text-slate-400">{plan.blurb}</p>
                <div className="mt-5 space-y-2">
                  <PayNowForm
                    plan={plan.key}
                    label="Pay now"
                    className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-wait disabled:opacity-80"
                  >
                    {isShop && (
                      <label className="block text-xs text-slate-400">
                        Seats (1–{plan.maxSeats})
                        <input
                          name="seats"
                          type="number"
                          min={plan.minSeats ?? 1}
                          max={plan.maxSeats ?? 10}
                          defaultValue={1}
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                        />
                        <span className="mt-1 block text-[11px] text-slate-500">
                          1 seat is $10/mo for the first year. Each extra seat
                          is $2/mo, up to {plan.maxSeats}.
                        </span>
                      </label>
                    )}
                  </PayNowForm>
                  <Link
                    href={`/signup?plan=${plan.key.toLowerCase()}`}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {enterprise && (
          <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold">{enterprise.name}</h2>
              <p className="mt-1 text-sm text-slate-400">{enterprise.blurb}</p>
            </div>
            <Link
              href="/signup?plan=enterprise"
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              Contact sales
            </Link>
          </div>
        )}

        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
          {[
            "Every module included",
            "No login before checkout",
            `${TRIAL_DAYS}-day trial, no card`,
            "15-day refund after you subscribe",
          ].map((item) => (
            <li key={item} className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-teal-400" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </MarketingShell>
  );
}
