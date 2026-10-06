"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  planPriceView,
  planSeatsLabel,
  type PlanDef,
} from "@/lib/services/subscription-plans";

type Props = {
  plans: PlanDef[];
  defaultPlan: string;
  defaultSeats?: number;
  action: (formData: FormData) => void | Promise<void>;
  trialDays: number;
};

function pingLead(payload: {
  email: string;
  company: string;
  plan: string;
  seats: number | null;
  stage: "typed" | "submitted";
}) {
  if (!payload.email.includes("@")) return;
  void fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

function SubmitButton({ trialDays }: { trialDays: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-teal-500/20 transition-transform hover:scale-[1.01] disabled:cursor-wait disabled:opacity-80 disabled:hover:scale-100"
    >
      {pending
        ? "Opening your plant…"
        : `Enter your ERP — ${trialDays}-day free trial`}
    </button>
  );
}

export function SignupPlanForm({
  plans,
  defaultPlan,
  defaultSeats = 3,
  action,
  trialDays,
}: Props) {
  const [planKey, setPlanKey] = useState(defaultPlan);
  const selected = plans.find((p) => p.key === planKey) ?? plans[0];
  const isShop = selected?.pricing === "per_seat";
  const [seats, setSeats] = useState(() => {
    const min = selected?.minSeats ?? 1;
    const max = selected?.maxSeats ?? 10;
    return Math.min(max, Math.max(min, defaultSeats));
  });
  const lastTyped = useRef("");

  const selectedView = useMemo(
    () => planPriceView(planKey, isShop ? { seats } : undefined),
    [planKey, isShop, seats]
  );
  const shopFormula = useMemo(
    () => (isShop ? planPriceView(planKey) : null),
    [planKey, isShop]
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

  function collect(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      email: String(fd.get("email") || "").trim(),
      company: String(fd.get("company") || "").trim(),
      plan: String(fd.get("plan") || planKey),
      seats: isShop ? seats : null,
    };
  }

  return (
    <form
      action={action}
      className="mt-6"
      onSubmit={(e) => {
        const fields = collect(e.currentTarget);
        pingLead({ ...fields, stage: "submitted" });
      }}
    >
      <fieldset>
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Choose your plan
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const view = planPriceView(p.key);
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
                    <span className="text-right text-sm text-slate-400">
                      {view.primaryAmount}
                      {view.primarySuffix}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {planSeatsLabel(p)}
                  </span>
                  {view.note && (
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {view.note}
                    </span>
                  )}
                  {view.afterYearOne && (
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {view.afterYearOne}
                    </span>
                  )}
                  {p.pricing === "per_seat" && (
                    <span className="mt-0.5 block text-[11px] text-slate-600">
                      billed monthly, set quantity for seats (max {p.maxSeats})
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
              How many seats?
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {shopFormula?.primaryAmount}
              {shopFormula?.primarySuffix}. {shopFormula?.note}{" "}
              {shopFormula?.afterYearOne} 1–{selected.maxSeats} seats on Shop.
              Need more? Choose Starter or above.
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
                  {selectedView.primaryAmount}
                </span>
                <span className="text-slate-500">{selectedView.primarySuffix}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {selectedView.note} {selectedView.afterYearOne}
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
            onBlur={(e) => {
              const form = e.currentTarget.form;
              if (!form) return;
              const fields = collect(form);
              const key = fields.email.toLowerCase();
              if (!key || key === lastTyped.current) return;
              lastTyped.current = key;
              pingLead({ ...fields, stage: "typed" });
            }}
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

      <SubmitButton trialDays={trialDays} />
      <p className="mt-3 text-center text-xs text-slate-500">
        No credit card. Takes about 20 seconds to open your plant. Free for{" "}
        {trialDays} days. When you subscribe: {selectedView.primaryAmount}
        {selectedView.primarySuffix}. {selectedView.afterYearOne}
      </p>
    </form>
  );
}
