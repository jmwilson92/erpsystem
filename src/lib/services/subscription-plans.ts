/**
 * Plan catalog + pure pricing helpers.
 *
 * Client-safe: no Prisma, cookies, or next/headers. Marketing client components
 * (e.g. signup seat stepper) must import from this file, not subscription.ts.
 *
 * Pricing model:
 *  - Shop: per-seat monthly for 1–10 users ($30/user/mo; Stripe quantity = seats).
 *  - Starter / Growth / Business: flat annual seat bands.
 *  - Enterprise: custom (self-host, SSO, 251+).
 */

export type PlanDef = {
  key: string;
  name: string;
  /** "per_seat" = Stripe quantity × unit price; "flat" = fixed; "custom" = sales. */
  pricing: "per_seat" | "flat" | "custom";
  /**
   * List price for one billing period: per-seat unit $ for Shop, flat annual $ for tiers.
   * Used for marketing / JSON-LD (Shop quotes 1 seat).
   */
  price: number;
  /** $ per seat per billing period (Shop). Null for flat/custom. */
  pricePerSeat: number | null;
  /** Display monthly $ per seat (Shop). */
  pricePerSeatMonthly: number | null;
  interval: "month" | "year";
  blurb: string;
  /** Max seats included (or max purchasable for Shop). Null = unlimited / custom. */
  seats: number | null;
  minSeats: number | null;
  maxSeats: number | null;
};

export const PLANS: readonly PlanDef[] = [
  {
    key: "SHOP",
    name: "Shop",
    pricing: "per_seat",
    price: 30, // 1 seat / month
    pricePerSeat: 30,
    pricePerSeatMonthly: 30,
    interval: "month",
    blurb: "Startups & micro shops — full ERP, $30 per user / month (up to 10 seats).",
    seats: 10,
    minSeats: 1,
    maxSeats: 10,
  },
  {
    key: "STARTER",
    name: "Starter",
    pricing: "flat",
    price: 3600,
    pricePerSeat: null,
    pricePerSeatMonthly: null,
    interval: "year",
    blurb: "Small manufacturers — full ERP, single site, up to 30 users.",
    seats: 30,
    minSeats: null,
    maxSeats: 30,
  },
  {
    key: "GROWTH",
    name: "Growth",
    pricing: "flat",
    price: 8400,
    pricePerSeat: null,
    pricePerSeatMonthly: null,
    interval: "year",
    blurb: "Growing manufacturers — priority support, up to 100 users.",
    seats: 100,
    minSeats: null,
    maxSeats: 100,
  },
  {
    key: "BUSINESS",
    name: "Business",
    pricing: "flat",
    price: 18000,
    pricePerSeat: null,
    pricePerSeatMonthly: null,
    interval: "year",
    blurb: "Multi-site + custom modules, up to 250 users.",
    seats: 250,
    minSeats: null,
    maxSeats: 250,
  },
  {
    key: "ENTERPRISE",
    name: "Enterprise",
    pricing: "custom",
    price: 0,
    pricePerSeat: null,
    pricePerSeatMonthly: null,
    interval: "year",
    blurb: "251+ users — bespoke modules, SSO, self-host, SLA. Let's talk.",
    seats: null,
    minSeats: null,
    maxSeats: null,
  },
];

export const TRIAL_DAYS = 45;

export function getPlan(key: string): PlanDef | undefined {
  return PLANS.find((p) => p.key === key.toUpperCase());
}

export function isPerSeatPlan(plan: PlanDef | string): boolean {
  const p = typeof plan === "string" ? getPlan(plan) : plan;
  return p?.pricing === "per_seat";
}

/** Clamp seat count for a plan (Shop 1–10; flat plans return max seats). */
export function normalizeSeats(
  planKey: string,
  requested?: number | null
): number | null {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return null;
  if (plan.pricing === "flat") return plan.seats;
  const min = plan.minSeats ?? 1;
  const max = plan.maxSeats ?? 10;
  const n = Number(requested);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Recurring list charge for one billing period (× seats for Shop).
 * Shop = monthly total; flat plans = annual total.
 */
export function periodPriceForPlan(
  planKey: string,
  seats?: number | null
): number {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return 0;
  if (plan.pricing === "flat") return plan.price;
  const n = normalizeSeats(planKey, seats) ?? plan.minSeats ?? 1;
  return (plan.pricePerSeat ?? 0) * n;
}

/** Annualized list for comparison / legacy call sites. */
export function annualPriceForPlan(
  planKey: string,
  seats?: number | null
): number {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return 0;
  if (plan.pricing === "per_seat") {
    return periodPriceForPlan(planKey, seats) * 12;
  }
  return plan.price;
}

/** Short seat label for marketing cards. */
export function planSeatsLabel(plan: PlanDef): string {
  if (plan.pricing === "custom" || plan.seats == null) return "Unlimited seats";
  if (plan.pricing === "per_seat") {
    return `${plan.minSeats}–${plan.maxSeats} users · pay per seat`;
  }
  return `Up to ${plan.seats} users`;
}
