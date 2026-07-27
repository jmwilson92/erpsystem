import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { demoModeEnabled } from "@/lib/auth-core";

// Plan catalog (client-safe) — re-exported so server code can keep one import path.
export {
  PLANS,
  TRIAL_DAYS,
  getPlan,
  isPerSeatPlan,
  normalizeSeats,
  periodPriceForPlan,
  annualPriceForPlan,
  planSeatsLabel,
  type PlanDef,
} from "./subscription-plans";
import {
  getPlan,
  normalizeSeats,
  TRIAL_DAYS,
} from "./subscription-plans";

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
 *
 * Client components must not import this file — use subscription-plans.ts for
 * PLANS / price helpers so next/headers (via auth-core) never hits the browser bundle.
 */

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
