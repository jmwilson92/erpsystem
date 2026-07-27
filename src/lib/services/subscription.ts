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
type Db = Pick<PrismaClient, "companySettings" | "auditLog" | "user" | "userInvite">;

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
 *  - Shop: per-seat monthly for 1–10 users ($30/user/mo; Stripe quantity = seats).
 *  - Starter / Growth / Business: flat annual seat bands.
 *  - Enterprise: custom (self-host, SSO, 251+).
 *
 * Crossover: 10 × Shop ($300/mo) vs Starter ($3,600/yr) — upgrade for more seats.
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

/** @deprecated use periodPriceForPlan — kept for call sites expecting annual-ish totals */
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

export type SeatUsage = {
  /** Purchased / plan seat cap. null = unlimited (Enterprise / unmetered). */
  limit: number | null;
  activeUsers: number;
  /** Open invites for emails that are not already active users. */
  pendingInvites: number;
  /** activeUsers + pendingInvites */
  used: number;
  /** Seats left to invite/activate; null if unlimited. */
  available: number | null;
};

/**
 * How many seats this instance has paid for vs how many are consumed
 * (active users + outstanding invites that would create new users).
 */
export async function getSeatUsage(db: Db = prisma): Promise<SeatUsage> {
  const settings = await db.companySettings.findUnique({
    where: { id: "default" },
    select: { seats: true },
  });
  const limit = settings?.seats ?? null;

  const activeUsers = await db.user.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  const activeSet = new Set(
    activeUsers.map((u) => u.email.trim().toLowerCase())
  );

  const pending = await db.userInvite.findMany({
    where: {
      kind: "INVITE",
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { email: true },
  });
  const pendingNew = new Set<string>();
  for (const inv of pending) {
    const em = inv.email.trim().toLowerCase();
    if (!activeSet.has(em)) pendingNew.add(em);
  }

  const activeCount = activeUsers.length;
  const pendingInvites = pendingNew.size;
  const used = activeCount + pendingInvites;
  const available = limit == null ? null : Math.max(0, limit - used);

  return {
    limit,
    activeUsers: activeCount,
    pendingInvites,
    used,
    available,
  };
}

/**
 * Block new invites (and reactivations) when the paid seat cap is full.
 * No-op when seats is null (unlimited) or in demo mode.
 * Existing active users and re-sends of an open invite for the same email are allowed.
 */
export async function assertSeatAvailableForInvite(
  email: string,
  db: Db = prisma
): Promise<void> {
  if (demoModeEnabled()) return;
  const usage = await getSeatUsage(db);
  if (usage.limit == null) return;

  const em = email.trim().toLowerCase();
  const existing = await db.user.findFirst({
    where: { email: em },
    select: { isActive: true },
  });
  if (existing?.isActive) return; // already occupying a seat

  const openInvite = await db.userInvite.findFirst({
    where: {
      email: em,
      kind: "INVITE",
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (openInvite) return; // already reserved

  if (usage.used >= usage.limit) {
    throw new Error(
      `Seat limit reached (${usage.limit} seat${usage.limit === 1 ? "" : "s"}). ` +
        `You have ${usage.activeUsers} active user${usage.activeUsers === 1 ? "" : "s"}` +
        (usage.pendingInvites
          ? ` and ${usage.pendingInvites} pending invite${usage.pendingInvites === 1 ? "" : "s"}`
          : "") +
        `. Upgrade your plan or remove a user before inviting more.`
    );
  }
}

/**
 * When accepting an invite that creates or reactivates a user, ensure we still
 * fit under the purchased seat cap (pending invite was counted at send time;
 * race: another accept could fill the last seat).
 */
export async function assertSeatAvailableForAccept(
  email: string,
  db: Db = prisma
): Promise<void> {
  if (demoModeEnabled()) return;
  const settings = await db.companySettings.findUnique({
    where: { id: "default" },
    select: { seats: true },
  });
  const limit = settings?.seats ?? null;
  if (limit == null) return;

  const em = email.trim().toLowerCase();
  const existing = await db.user.findFirst({
    where: { email: em },
    select: { isActive: true },
  });
  if (existing?.isActive) return;

  const activeCount = await db.user.count({ where: { isActive: true } });
  if (activeCount >= limit) {
    throw new Error(
      `This workspace is at its seat limit (${limit}). Ask an admin to free a seat or upgrade the plan.`
    );
  }
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
  const defaultPeriodMs =
    known.interval === "month" ? 32 * 86_400_000 : 365 * 86_400_000;
  const periodEnd =
    params.currentPeriodEnd ?? new Date(Date.now() + defaultPeriodMs);

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
