/**
 * Pure Stripe subscription-schedule fields for the first-year → standard
 * transition. No network, so checkout wiring and smoke tests share one shape.
 *
 * Phase 0 is the first-year price. Phase 1 is the existing standard price and
 * has no end, so year two and later bill the list price. No coupon.
 */
import {
  addBillingCycles,
  firstYearBillingCycles,
  getPlan,
} from "./subscription-plans";

export function buildIntroScheduleUpdate(input: {
  plan: string;
  startDate: number;
  quantity: number;
  introPriceId: string;
  standardPriceId: string;
  /** Future trial end, if this subscription is still trialing. */
  trialEnd?: number | null;
  nowUnix?: number;
}): Record<string, string> {
  const plan = getPlan(input.plan);
  const cycles = firstYearBillingCycles(input.plan);
  const quantity = Math.max(1, Math.round(input.quantity) || 1);
  const now = input.nowUnix ?? Math.floor(Date.now() / 1000);
  const body: Record<string, string> = {
    "phases[0][start_date]": String(input.startDate),
    "phases[0][items][0][price]": input.introPriceId,
    "phases[0][items][0][quantity]": String(quantity),
    "phases[0][proration_behavior]": "none",
    "phases[1][items][0][price]": input.standardPriceId,
    "phases[1][items][0][quantity]": String(quantity),
    "phases[1][proration_behavior]": "none",
    end_behavior: "release",
  };
  const trialEnd =
    input.trialEnd != null && input.trialEnd > now ? input.trialEnd : null;
  if (trialEnd && plan) {
    // End the intro phase one paid year after the trial, so a $0 trial
    // invoice is not counted as one of the intro cycles.
    body["phases[0][trial_end]"] = String(trialEnd);
    body["phases[0][end_date]"] = String(
      addBillingCycles(trialEnd, plan.interval, cycles)
    );
  } else {
    body["phases[0][iterations]"] = String(cycles);
  }
  return body;
}
