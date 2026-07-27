"use client";

import { useMemo, useState } from "react";
import {
  annualPriceForPlan,
  planSeatsLabel,
  type PlanDef,
} from "@/lib/services/subscription";

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

type Props = {
  plans: PlanDef[];
  defaultPlan: string;
  defaultSeats?: number;
  action: (formData: FormData) => void | Promise<void>;
  trialDays: number;
  promoOn: boolean;
};

/**
 * Self-serve plan picker with a live seat stepper for Shop (per-user annual).
 */
export function SignupPlanForm({
  plans,
  defaultPlan,
  defaultSeats = 3,
  action,
  trialDays,
  promoOn,
}: Props) {
  const [planKey, setPlanKey] = useState(defaultPlan);
  const selected = plans.find((p) => p.key === planKey) ?? plans[0];
  const isShop = selected?.pricing === "per_seat";
  const [seats, setSeats] = useState(() => {
    const min = selected?.minSeats ?? 1;
    const max = selected?.maxSeats ?? 10;
    return Math.min(max, Math.max(min, defaultSeats));
  });

  const annual = useMemo(
    () => annualPriceForPlan(planKey, isShop ? seats : null),
    [planKey, isShop, seats]
  );

  function onPlanChange(key: string) {
    setPlanKey(key);
    const p = plans.find((x) => x.key === key);
    if (p?.pricing === "per_seat") {
      const min = p.minSeats ?? 1;
      const max = p.maxSeats ?? 10;
      setSeats((s) => Math.min(max, Math.max(min, s)));
    }
  }

  return (
    <form action={action} className="mt-6">
      <fieldset>
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Choose your plan
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const priceLabel =
              p.pricing === "per_seat"
                ? `${money(p.pricePerSeatMonthly ?? 30)}/user/mo`
                : `${money(p.price)}/yr`;
            return (
              <label
                key={p.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 transition-colors has-[:checked]:border-teal-500/60 has-[:checked]:bg-teal-500/[0.06]"
              >
                <input
                  type="radio"
                  name="plan"
                  value={p.key}
                  checked={planKey === p.key}
                  onChange={() => onPlanChange(p.key)}
                  className="mt-1 accent-teal-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-sm text-slate-400">{priceLabel}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {planSeatsLabel(p)}
                  </span>
                  {p.pricing === "per_seat" && (
                    <span className="mt-0.5 block text-[11px] text-slate-600">
                      billed annually ({money(p.pricePerSeat ?? 360)}/user/yr)
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isShop && (
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">
              How many users?
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Shop is pay-per-seat for 1–{selected.maxSeats} people. Need more?
              Pick Starter or above.
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                type="number"
                name="seats"
                min={selected.minSeats ?? 1}
                max={selected.maxSeats ?? 10}
                value={seats}
                onChange={(e) => {
                  const min = selected.minSeats ?? 1;
                  const max = selected.maxSeats ?? 10;
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  setSeats(Math.min(max, Math.max(min, Math.round(n))));
                }}
                className="w-24 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
              />
              <p className="text-sm text-slate-300">
                <span className="font-semibold text-slate-100">
                  {money(annual)}
                </span>
                <span className="text-slate-500">/year</span>
                <span className="ml-2 text-xs text-slate-500">
                  ({seats} × {money(selected.pricePerSeatMonthly ?? 30)}/mo)
                </span>
              </p>
            </div>
          </label>
        </div>
      )}

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
        You&apos;ll add a card on Stripe&apos;s secure page. No charge for{" "}
        {trialDays} days
        {promoOn
          ? " — the 50%-off-first-year launch offer is applied automatically."
          : "."}
      </p>
    </form>
  );
}
