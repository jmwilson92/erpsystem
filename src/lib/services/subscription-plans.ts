/**
 * Plan catalog + pure pricing helpers.
 *
 * Client-safe: no Prisma, cookies, or next/headers. Marketing client components
 * (e.g. signup seat stepper) must import from this file, not subscription.ts.
 *
 * This file is the only place dollar amounts live. Marketing, legal, meta, and
 * Stripe setup all read from here.
 *
 * Pricing model:
 *  - Shop: monthly, 1–10 users. First year is $10 for the first user plus $2
 *    for each additional user ($28/month at 10 users). After that, $30/user/month.
 *  - Starter / Growth / Business: flat annual. First year is a fixed intro
 *    amount; the standard annual price applies after that.
 *  - Enterprise: custom (self-host, SSO, 251+). Unchanged — quoted.
 *
 * `price` / `pricePerSeat` are the standard (year two+) amounts. First-year
 * amounts are `firstYearPrice` and, for Shop, `firstYearAdditionalPerSeat`.
 */

export type PlanDef = {
  key: string;
  name: string;
  /** "per_seat" = Stripe quantity × price; "flat" = fixed; "custom" = sales. */
  pricing: "per_seat" | "flat" | "custom";
  /**
   * Standard list price for one billing period after year one.
   * Shop: per-seat monthly $. Flat tiers: annual $.
   */
  price: number;
  /** Standard $ per seat per billing period (Shop). Null for flat/custom. */
  pricePerSeat: number | null;
  /** Standard monthly $ per seat (Shop) after year one. */
  pricePerSeatMonthly: number | null;
  /**
   * First-year charge.
   * Shop: monthly $ for the first user. Flat tiers: annual $ for year one.
   * Null for custom.
   */
  firstYearPrice: number | null;
  /** Shop only: monthly $ for each user after the first, during year one. */
  firstYearAdditionalPerSeat: number | null;
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
    price: 30, // standard, per user / month, after year one
    pricePerSeat: 30,
    pricePerSeatMonthly: 30,
    firstYearPrice: 10,
    firstYearAdditionalPerSeat: 2,
    interval: "month",
    blurb: "Startups & micro shops — full ERP, up to 10 seats.",
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
    firstYearPrice: 250,
    firstYearAdditionalPerSeat: null,
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
    firstYearPrice: 500,
    firstYearAdditionalPerSeat: null,
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
    firstYearPrice: 1000,
    firstYearAdditionalPerSeat: null,
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
    firstYearPrice: null,
    firstYearAdditionalPerSeat: null,
    interval: "year",
    blurb: "251+ users — bespoke modules, SSO, self-host, SLA. Let's talk.",
    seats: null,
    minSeats: null,
    maxSeats: null,
  },
];

export const TRIAL_DAYS = 60;

/**
 * Stripe Price lookup keys. The setup script reuses a price when the key
 * already exists, so these must stay stable.
 * Standard keys match the prices created before first-year pricing.
 */
export const STRIPE_LOOKUP_KEYS = {
  SHOP: "forgerp_shop_monthly",
  SHOP_FIRST_YEAR: "forgerp_shop_first_year_monthly",
  STARTER: "forgerp_starter_annual",
  STARTER_FIRST_YEAR: "forgerp_starter_first_year_annual",
  GROWTH: "forgerp_growth_annual",
  GROWTH_FIRST_YEAR: "forgerp_growth_first_year_annual",
  BUSINESS: "forgerp_business_annual",
  BUSINESS_FIRST_YEAR: "forgerp_business_first_year_annual",
} as const;

/** Env var holding the standard (year two+) Stripe Price id. */
export const STRIPE_STANDARD_PRICE_ENV: Record<string, string> = {
  SHOP: "STRIPE_PRICE_SHOP",
  STARTER: "STRIPE_PRICE_STARTER",
  GROWTH: "STRIPE_PRICE_GROWTH",
  BUSINESS: "STRIPE_PRICE_BUSINESS",
};

/** Env var holding the first-year Stripe Price id. Existing subscriptions do not use these. */
export const STRIPE_FIRST_YEAR_PRICE_ENV: Record<string, string> = {
  SHOP: "STRIPE_PRICE_SHOP_FIRST_YEAR",
  STARTER: "STRIPE_PRICE_STARTER_FIRST_YEAR",
  GROWTH: "STRIPE_PRICE_GROWTH_FIRST_YEAR",
  BUSINESS: "STRIPE_PRICE_BUSINESS_FIRST_YEAR",
};

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

export function formatPlanMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

export function priceCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Paid billing cycles the first-year price covers.
 * Shop is monthly, so 12 cycles = 12 months. Annual plans are 1 cycle = 1 year.
 */
export function firstYearBillingCycles(planKey: string): number {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return 0;
  return plan.interval === "month" ? 12 : 1;
}

/** Shop first-year monthly total: $10 + $2 × (seats − 1). */
export function shopFirstYearMonthly(seats: number): number {
  const plan = getPlan("SHOP");
  const n = normalizeSeats("SHOP", seats) ?? 1;
  const base = plan?.firstYearPrice ?? 0;
  const extra = plan?.firstYearAdditionalPerSeat ?? 0;
  return base + extra * (n - 1);
}

/**
 * First-year charge for one billing period.
 * Shop = monthly total at `seats`. Flat plans = annual intro total.
 */
export function firstYearPeriodPriceForPlan(
  planKey: string,
  seats?: number | null
): number {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return 0;
  if (plan.pricing === "per_seat") {
    return shopFirstYearMonthly(seats ?? plan.minSeats ?? 1);
  }
  return plan.firstYearPrice ?? 0;
}

/**
 * Standard recurring charge for one billing period after year one (× seats for Shop).
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

/** Annualized standard list for comparison / legacy call sites. */
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

export type PlanPriceView = {
  /** Figure customers see first (the first-year price, or "Quoted"). */
  primaryAmount: string;
  primarySuffix: string;
  /** States the year-two price. Empty for Enterprise. */
  afterYearOne: string;
  /** Shop formula or seat math. Null when the headline is enough. */
  note: string | null;
};

/**
 * Customer-facing price block. Omit `seats` on Shop to show the formula
 * ($10 first user + $2 each additional, with the 10-user example).
 * Pass `seats` to show that shop's actual first-year monthly total.
 */
export function planPriceView(
  planKey: string,
  opts?: { seats?: number | null }
): PlanPriceView {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") {
    return {
      primaryAmount: "Quoted",
      primarySuffix: "",
      afterYearOne: "",
      note: null,
    };
  }
  if (plan.pricing === "per_seat") {
    const perUser = formatPlanMoney(plan.pricePerSeatMonthly ?? 0);
    if (opts?.seats == null) {
      const max = plan.maxSeats ?? 10;
      const ten = shopFirstYearMonthly(max);
      return {
        primaryAmount: formatPlanMoney(plan.firstYearPrice ?? 0),
        primarySuffix: "/mo for the first user",
        note: `+ ${formatPlanMoney(plan.firstYearAdditionalPerSeat ?? 0)}/mo for each additional user. A ${max}-user shop pays ${formatPlanMoney(ten)}/mo in the first year.`,
        afterYearOne: `Then ${perUser}/user/mo.`,
      };
    }
    const n = normalizeSeats(plan.key, opts.seats) ?? 1;
    const intro = shopFirstYearMonthly(n);
    const standard = periodPriceForPlan(plan.key, n);
    const extraSeats = n - 1;
    const note =
      extraSeats === 0
        ? "First user only, for the first year."
        : `${formatPlanMoney(plan.firstYearPrice ?? 0)} for the first user + ${formatPlanMoney(plan.firstYearAdditionalPerSeat ?? 0)}/mo × ${extraSeats} additional.`;
    return {
      primaryAmount: formatPlanMoney(intro),
      primarySuffix: "/mo for the first year",
      note,
      afterYearOne: `Then ${formatPlanMoney(standard)}/mo (${perUser}/user).`,
    };
  }
  return {
    primaryAmount: formatPlanMoney(plan.firstYearPrice ?? 0),
    primarySuffix: " for the first year",
    note: null,
    afterYearOne: `Then ${formatPlanMoney(plan.price)}/year.`,
  };
}

/** One honest paragraph of every self-serve first-year and standard price. */
export function firstYearOfferSummary(): string {
  const shop = getPlan("SHOP")!;
  const starter = getPlan("STARTER")!;
  const growth = getPlan("GROWTH")!;
  const business = getPlan("BUSINESS")!;
  const max = shop.maxSeats ?? 10;
  const ten = shopFirstYearMonthly(max);
  return `First year, Shop is ${formatPlanMoney(shop.firstYearPrice ?? 0)}/month for the first user plus ${formatPlanMoney(shop.firstYearAdditionalPerSeat ?? 0)}/month for each additional user (a ${max}-user shop pays ${formatPlanMoney(ten)}/month). Starter is ${formatPlanMoney(starter.firstYearPrice ?? 0)} for the first year, Growth ${formatPlanMoney(growth.firstYearPrice ?? 0)}, and Business ${formatPlanMoney(business.firstYearPrice ?? 0)}. After the first 12 months, standard prices apply: Shop ${formatPlanMoney(shop.pricePerSeatMonthly ?? 0)}/user/month, Starter ${formatPlanMoney(starter.price)}/year, Growth ${formatPlanMoney(growth.price)}/year, Business ${formatPlanMoney(business.price)}/year. Enterprise stays quoted.`;
}

export function pricingSectionLead(): string {
  return `${firstYearOfferSummary()} Every plan is the full product. The trial is ${TRIAL_DAYS} days and does not require a card.`;
}

/** Add `cycles` calendar months or years to a unix timestamp (UTC). */
export function addBillingCycles(
  startUnix: number,
  interval: "month" | "year",
  cycles: number
): number {
  const d = new Date(startUnix * 1000);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + cycles);
  else d.setUTCMonth(d.getUTCMonth() + cycles);
  return Math.floor(d.getTime() / 1000);
}
