import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { demoModeEnabled } from "@/lib/auth-core";

/**
 * A Prisma-ish client. Every function here defaults to the request-scoped
 * `prisma` proxy (which resolves public or the request's demo schema), but the
 * Stripe webhook — which runs with no request cookie — passes an explicit
 * schema-scoped client so a customer's subscription state lands in THEIR schema,
 * never in public. Typed loosely because a scoped client and the proxy share the
 * delegate surface we use but not the full nominal PrismaClient type.
 */
type Db = Pick<PrismaClient, "companySettings" | "auditLog">;

/**
 * Instance-per-customer subscription state. Each ForgeRP instance carries its
 * own plan / trial / billing status on CompanySettings. Access is gated once
 * the trial ends with no active paid subscription (production only — the demo
 * instance is never gated).
 *
 * Payment provider is a seam: `billingProvider` is null during the in-app beta
 * and becomes "stripe" once checkout is wired. The gating logic here doesn't
 * care which provider flipped the status.
 */

/**
 * Pricing model:
 *  - Shop: per-seat annual for 1–10 users ($30/user/mo billed yearly).
 *  - Starter / Growth / Business: flat annual seat bands.
 *  - Enterprise: custom (self-host, SSO, 251+).
 *
 * Crossover: 10 × Shop = Starter list price, but Starter includes 30 seats.
 */
export type PlanDef = {
  key: string;
  name: string;
  /** "per_seat" = Stripe quantity × pricePerSeat; "flat" = fixed annual. */
  pricing: "per_seat" | "flat" | "custom";
  /** Annual list for flat plans; for per_seat, annual total at 1 seat (JSON-LD / min). */
  price: number;
  /** Annual $ per seat (Shop). Null for flat/custom. */
  pricePerSeat: number | null;
  /** Display monthly equivalent per seat (Shop). */
  pricePerSeatMonthly: number | null;
  interval: "year";
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
    price: 360, // 1 seat annual
    pricePerSeat: 360,
    pricePerSeatMonthly: 30,
    interval: "year",
    blurb: "Startups & micro shops — full ERP, pay only for the seats you need.",
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
] as const;

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

/** Annual list price for the plan (× seats for Shop). */
export function annualPriceForPlan(
  planKey: string,
  seats?: number | null
): number {
  const plan = getPlan(planKey);
  if (!plan || plan.pricing === "custom") return 0;
  if (plan.pricing === "flat") return plan.price;
  const n = normalizeSeats(planKey, seats) ?? plan.minSeats ?? 1;
  return (plan.pricePerSeat ?? 0) * n;
}

/** Short seat label for marketing cards. */
export function planSeatsLabel(plan: PlanDef): string {
  if (plan.pricing === "custom" || plan.seats == null) return "Unlimited seats";
  if (plan.pricing === "per_seat") {
    return `${plan.minSeats}–${plan.maxSeats} users (pay per seat)`;
  }
  return `Up to ${plan.seats} users`;
}

export type SubscriptionState = {
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  seats: number | null;
  billingEmail: string | null;
  billingProvider: string | null;
  /** true when the customer has a live paid subscription */
  isPaid: boolean;
  /** true while inside a valid trial window */
  isTrialing: boolean;
  /** whole days left in the trial (0 once elapsed); null when not trialing */
  trialDaysLeft: number | null;
  /** true when access should be granted right now */
  hasAccess: boolean;
  /** true when the trial is over and there is no paid subscription */
  isExpired: boolean;
  /** enforcement is skipped on the demo instance */
  enforced: boolean;
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
}

export async function getSubscriptionState(
  db: Db = prisma
): Promise<SubscriptionState> {
  const s = await db.companySettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
    select: {
      plan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      seats: true,
      billingEmail: true,
      billingProvider: true,
    },
  });

  const now = new Date();
  const enforced = !demoModeEnabled();

  const isPaid =
    s.subscriptionStatus === "ACTIVE" &&
    (!s.currentPeriodEnd || s.currentPeriodEnd > now);
  const isTrialing =
    !isPaid &&
    s.subscriptionStatus === "TRIALING" &&
    !!s.trialEndsAt &&
    s.trialEndsAt > now;
  const trialDaysLeft =
    s.subscriptionStatus === "TRIALING" && s.trialEndsAt
      ? daysBetween(now, s.trialEndsAt)
      : null;
  const isExpired = !isPaid && !isTrialing;
  // Demo instance is always open; otherwise access needs paid or live trial.
  const hasAccess = !enforced || isPaid || isTrialing;

  return {
    plan: s.plan,
    status: s.subscriptionStatus,
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    seats: s.seats,
    billingEmail: s.billingEmail,
    billingProvider: s.billingProvider,
    isPaid,
    isTrialing,
    trialDaysLeft,
    hasAccess,
    isExpired,
    enforced,
  };
}

/** Begin (or restart) the free trial — sets a fresh trial window. */
export async function startTrial(userId?: string, db: Db = prisma) {
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  return db.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      plan: "TRIAL",
      subscriptionStatus: "TRIALING",
      trialEndsAt,
    },
    update: {
      plan: "TRIAL",
      subscriptionStatus: "TRIALING",
      trialEndsAt,
      updatedById: userId,
    },
  });
}

/**
 * Activate a paid plan. During the in-app beta this flips status directly;
 * once Stripe is wired, the webhook calls this after a successful checkout.
 */
export async function activatePlan(
  params: {
    plan: string;
    seats?: number | null;
    billingEmail?: string | null;
    currentPeriodEnd?: Date | null;
    provider?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    userId?: string;
  },
  db: Db = prisma
) {
  const known = getPlan(params.plan);
  if (!known) throw new Error(`Unknown plan: ${params.plan}`);
  const periodEnd =
    params.currentPeriodEnd ??
    new Date(Date.now() + 365 * 86_400_000); // annual by default

  const seats =
    known.pricing === "per_seat"
      ? normalizeSeats(params.plan, params.seats)
      : (params.seats ?? known.seats);

  const sub = await db.companySettings.update({
    where: { id: "default" },
    data: {
      plan: params.plan,
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: periodEnd,
      seats,
      billingEmail: params.billingEmail ?? undefined,
      billingProvider: params.provider ?? undefined,
      stripeCustomerId: params.stripeCustomerId ?? undefined,
      stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
      updatedById: params.userId,
    },
  });

  await db.auditLog.create({
    data: {
      entityType: "Subscription",
      entityId: "default",
      action: "ACTIVATED",
      metadata: JSON.stringify({ plan: params.plan, seats, periodEnd }),
      userId: params.userId ?? null,
    },
  });
  return sub;
}

export async function cancelSubscription(userId?: string, db: Db = prisma) {
  return db.companySettings.update({
    where: { id: "default" },
    data: { subscriptionStatus: "CANCELLED", updatedById: userId },
  });
}
