import { prisma } from "@/lib/db";
import { demoModeEnabled } from "@/lib/auth-core";

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

export const PLANS = [
  {
    key: "STARTER",
    name: "Starter",
    price: 2400,
    interval: "year",
    blurb: "Small shops — core ERP, up to 10 seats.",
    seats: 10,
  },
  {
    key: "PRO",
    name: "Pro",
    price: 6000,
    interval: "year",
    blurb: "Growing manufacturers — unlimited seats, custom modules.",
    seats: null,
  },
  {
    key: "ENTERPRISE",
    name: "Enterprise",
    price: 0,
    interval: "year",
    blurb: "Bespoke modules, SSO, priority support — let's talk.",
    seats: null,
  },
] as const;

export const TRIAL_DAYS = 30;

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

export async function getSubscriptionState(): Promise<SubscriptionState> {
  const s = await prisma.companySettings.upsert({
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
export async function startTrial(userId?: string) {
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  return prisma.companySettings.upsert({
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
export async function activatePlan(params: {
  plan: string;
  seats?: number | null;
  billingEmail?: string | null;
  currentPeriodEnd?: Date | null;
  provider?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  userId?: string;
}) {
  const known = PLANS.find((p) => p.key === params.plan);
  if (!known) throw new Error(`Unknown plan: ${params.plan}`);
  const periodEnd =
    params.currentPeriodEnd ??
    new Date(Date.now() + 365 * 86_400_000); // annual by default

  const sub = await prisma.companySettings.update({
    where: { id: "default" },
    data: {
      plan: params.plan,
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: periodEnd,
      seats: params.seats ?? known.seats,
      billingEmail: params.billingEmail ?? undefined,
      billingProvider: params.provider ?? undefined,
      stripeCustomerId: params.stripeCustomerId ?? undefined,
      stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
      updatedById: params.userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "Subscription",
      entityId: "default",
      action: "ACTIVATED",
      metadata: JSON.stringify({ plan: params.plan, periodEnd }),
      userId: params.userId ?? null,
    },
  });
  return sub;
}

export async function cancelSubscription(userId?: string) {
  return prisma.companySettings.update({
    where: { id: "default" },
    data: { subscriptionStatus: "CANCELLED", updatedById: userId },
  });
}
