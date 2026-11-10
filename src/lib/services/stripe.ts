import crypto from "crypto";
import { subscriptionFoundingMembership, foundingGrant, type FoundingMembership } from "./founding-membership";
import {
  getPlan,
  isPerSeatPlan,
  normalizeSeats,
  paidShopSeats,
  SHOP_PAID_MIN_SEATS,
  TRIAL_DAYS,
  STRIPE_STANDARD_PRICE_ENV,
  STRIPE_FIRST_YEAR_PRICE_ENV,
} from "@/lib/services/subscription";
import { buildIntroScheduleUpdate } from "@/lib/services/stripe-intro";

/**
 * Minimal Stripe integration over the REST API (no SDK dependency). Env-gated:
 * unconfigured → the billing page falls back to in-app activation.
 *
 * Standard (year two+) prices — existing subscribers stay on these:
 *   STRIPE_PRICE_SHOP        price_... (per-seat monthly, $30/unit; qty = seats 6–10)
 *   STRIPE_PRICE_STARTER     price_... (flat annual, $3,600)
 *   STRIPE_PRICE_GROWTH      price_... (flat annual, $8,400)
 *   STRIPE_PRICE_BUSINESS    price_... (flat annual, $18,000)
 *
 * First-year prices — founders keep these for life; other new subscriptions
 * switch to standard prices after 12 paid months. Shop is graduated ($10 first seat,
 * $2 each additional), not a percent-off coupon.
 *   STRIPE_PRICE_SHOP_FIRST_YEAR
 *   STRIPE_PRICE_STARTER_FIRST_YEAR
 *   STRIPE_PRICE_GROWTH_FIRST_YEAR
 *   STRIPE_PRICE_BUSINESS_FIRST_YEAR
 *
 *   STRIPE_SECRET_KEY        sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...
 *   APP_URL                  https://your-instance (for success/cancel URLs)
 *
 * Enterprise is "contact sales" — no self-serve checkout.
 * Shop: free for 1–5 users (never reaches Checkout). Paid Shop line-item
 * quantity = seats (adjustable 6–10 on Checkout), billed by the same graduated
 * price: $10 + $2 × (seats − 1) in year one.
 * LAUNCH_DATE, LAUNCH_PROMO_DAYS, and STRIPE_COUPON_LAUNCH are not read.
 */

const API = "https://api.stripe.com/v1";

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function envPrice(map: Record<string, string>, plan: string): string | undefined {
  const envName = map[plan.toUpperCase()];
  if (!envName) return undefined;
  const value = process.env[envName]?.trim();
  return value || undefined;
}

/** Standard (year two+) Stripe Price id. Existing subscriptions keep using these. */
export function priceIdForPlan(plan: string): string | undefined {
  return envPrice(STRIPE_STANDARD_PRICE_ENV, plan);
}

/** First-year Stripe Price id. Used only when starting a new subscription. */
export function firstYearPriceIdForPlan(plan: string): string | undefined {
  return envPrice(STRIPE_FIRST_YEAR_PRICE_ENV, plan);
}

/**
 * Price id for a new Checkout. First-year checkout also requires the standard
 * price for non-founders so their renewal schedule can be attached. A verified
 * existing founder intentionally stays on the recurring intro Price forever.
 */
function requireCheckoutPrice(plan: string, firstYear: boolean, lifetime = false): string {
  const key = plan.toUpperCase();
  if (firstYear) {
    const introEnv = STRIPE_FIRST_YEAR_PRICE_ENV[key];
    const standardEnv = STRIPE_STANDARD_PRICE_ENV[key];
    const intro = firstYearPriceIdForPlan(key);
    const standard = priceIdForPlan(key);
    if (!intro || (!standard && !lifetime)) {
      const missing = [
        !intro ? introEnv : null,
        !standard && !lifetime ? standardEnv : null,
      ]
        .filter(Boolean)
        .join(" and ");
      throw new Error(
        `No Stripe price configured for ${key} first-year checkout. Set ${missing}.`
      );
    }
    return intro;
  }
  const standardEnv = STRIPE_STANDARD_PRICE_ENV[key];
  const standard = priceIdForPlan(key);
  if (!standard) {
    throw new Error(
      `No Stripe price configured for ${key}. Set ${standardEnv ?? `STRIPE_PRICE_${key}`}.`
    );
  }
  return standard;
}

function form(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return sp.toString();
}

async function stripePost(path: string, body: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || "Stripe request failed");
  }
  return json;
}

async function stripeGet(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || "Stripe request failed");
  }
  return json;
}

/** Line-item quantity: seat count for Shop, 1 for flat plans. */
function checkoutQuantity(plan: string, seats?: number | null): number {
  if (!isPerSeatPlan(plan)) return 1;
  // Shop ≤5 is free; anything that reaches Stripe is paid Shop (6–10).
  return paidShopSeats(seats);
}

export type CheckoutSessionInfo = {
  complete: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  email: string;
  plan: string;
  seats: number | null;
  companyName: string | null;
  /** true when this checkout should provision a self-serve customer tenant */
  provision: boolean;
  /** true when the buyer pays immediately (public pay-now, no trial) */
  payNow: boolean;
  paymentReceived: boolean;
  foundingMember: boolean;
  foundingQualifiedAt: Date | null;
};

/**
 * Retrieve a Checkout Session by the id Stripe appends to the success URL.
 * Server-side with the secret key, so the returned facts are authoritative —
 * this is what lets the success page provision the workspace immediately
 * instead of waiting on the webhook.
 */
export async function retrieveCheckoutSession(
  sessionId: string
): Promise<CheckoutSessionInfo | null> {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return null;
  // Expand line_items so Shop seat count comes from the actual paid quantity
  // (customer may have adjusted qty on Stripe Checkout).
  const s = (await stripeGet(
    `/checkout/sessions/${sessionId}?expand[]=line_items&expand[]=subscription`
  )) as {
    status?: string;
    payment_status?: string;
    customer?: string | null;
    subscription?: string | StripeSubscription | null;
    customer_email?: string | null;
    customer_details?: { email?: string | null } | null;
    metadata?: Record<string, string> | null;
    line_items?: { data?: { quantity?: number }[] } | null;
  };
  const plan = s.metadata?.plan || "STARTER";
  const qty = s.line_items?.data?.[0]?.quantity;
  const seatsRaw = s.metadata?.seats;
  let seats: number | null;
  if (isPerSeatPlan(plan) && typeof qty === "number" && qty > 0) {
    seats = normalizeSeats(plan, qty);
  } else if (seatsRaw != null && seatsRaw !== "") {
    seats = normalizeSeats(plan, Number(seatsRaw));
  } else {
    seats = getPlan(plan)?.seats ?? null;
  }
  const sub = typeof s.subscription === "string"
    ? (s.status === "complete" ? await retrieveStripeSubscription(s.subscription) : undefined)
    : s.subscription ?? undefined;
  const membership = sub ? subscriptionFoundingMembership(sub) : { foundingMember: false };
  return {
    complete: s.status === "complete",
    customerId: s.customer || null,
    subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
    email: s.customer_email || s.customer_details?.email || "",
    plan,
    seats,
    companyName: s.metadata?.companyName || null,
    provision: s.metadata?.provision === "tenant",
    payNow: s.metadata?.payNow === "1",
    paymentReceived: s.payment_status === "paid" || sub?.status === "active",
    foundingMember: membership.foundingMember,
    foundingQualifiedAt: membership.foundingQualifiedAt ?? null,
  };
}

/** Create a subscription Checkout Session; returns the hosted checkout URL. */
export async function createCheckoutSession(params: {
  plan: string;
  seats?: number | null;
  customerEmail?: string;
  appUrl: string;
  /**
   * true (default): charge the first-year price. The webhook attaches a
   * schedule onto the standard price after 12 paid months, unless the actual
   * subscription start qualifies for the founding offer. Persisted founders
   * always use first-year prices, even when this option is false.
   */
  firstYear?: boolean;
  /** Server-authenticated existing entitlement; never read from FormData. */
  foundingMembership?: FoundingMembership;
  /** Server-resolved ownership for in-app trial conversions/plan selection. */
  workspaceSchema?: string;
  /** Prevent accidental double billing during plan selection/resubscription. */
  existingSubscriptionId?: string | null;
  /**
   * Public pay-now. Same first-year Price ids as in-app checkout, but the
   * session provisions a new tenant (metadata.provision = tenant) and returns
   * the buyer to /signup/complete. No trial — they are charged now.
   */
  provisionTenant?: boolean;
  companyName?: string | null;
}): Promise<string> {
  if (params.existingSubscriptionId) {
    const existing = await retrieveStripeSubscription(params.existingSubscriptionId);
    if (!["canceled", "incomplete_expired"].includes(String(existing.status))) {
      throw new Error("This workspace already has a Stripe subscription. Contact billing to change it without opening a duplicate subscription.");
    }
  }
  const provisionTenant = params.provisionTenant === true;
  if (params.workspaceSchema && params.workspaceSchema !== "public" && !/^tenant_[a-z0-9]{6,40}$/.test(params.workspaceSchema)) {
    throw new Error("Invalid billing workspace");
  }
  const firstYear = params.foundingMembership?.foundingMember === true || provisionTenant || params.firstYear !== false;
  const price = requireCheckoutPrice(params.plan, firstYear, params.foundingMembership?.foundingMember === true);
  const qty = checkoutQuantity(params.plan, params.seats);
  const seatsMeta = isPerSeatPlan(params.plan)
    ? String(qty)
    : String(getPlan(params.plan)?.seats ?? "");
  const planDef = getPlan(params.plan);
  const body: Record<string, string | undefined> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": String(qty),
    success_url: provisionTenant
      ? `${params.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`
      : `${params.appUrl}/billing?checkout=success`,
    cancel_url: provisionTenant
      ? `${params.appUrl}/pricing?checkout=cancel&plan=${params.plan.toLowerCase()}`
      : `${params.appUrl}/billing?checkout=cancel`,
    customer_email: params.customerEmail,
    "metadata[plan]": params.plan,
    "metadata[seats]": seatsMeta,
    "metadata[firstYear]": firstYear ? "1" : "0",
    "metadata[foundingMember]": params.foundingMembership?.foundingMember ? "1" : undefined,
    "metadata[workspaceSchema]": params.workspaceSchema,
    "subscription_data[metadata][foundingMember]": params.foundingMembership?.foundingMember ? "1" : undefined,
    "subscription_data[metadata][foundingQualifiedAt]": params.foundingMembership?.foundingQualifiedAt?.toISOString(),
    "subscription_data[metadata][workspaceSchema]": params.workspaceSchema,
    "subscription_data[metadata][plan]": params.plan,
    "subscription_data[metadata][seats]": seatsMeta,
    "subscription_data[metadata][firstYear]": firstYear ? "1" : "0",
    // Promo codes stay off so a leftover 50%-off coupon cannot stack on the
    // first-year price or discount an existing subscriber's standard price.
  };
  if (provisionTenant) {
    body["metadata[provision]"] = "tenant";
    body["metadata[payNow]"] = "1";
    body["metadata[companyName]"] = params.companyName || undefined;
    body["subscription_data[metadata][provision]"] = "tenant";
    body["subscription_data[metadata][payNow]"] = "1";
  }
  // Shop: let the customer adjust quantity (seats) on Stripe Checkout, 6–10.
  if (isPerSeatPlan(params.plan)) {
    body["line_items[0][adjustable_quantity][enabled]"] = "true";
    body["line_items[0][adjustable_quantity][minimum]"] = String(
      SHOP_PAID_MIN_SEATS
    );
    body["line_items[0][adjustable_quantity][maximum]"] = String(
      planDef?.maxSeats ?? 10
    );
  }

  const session = await stripePost("/checkout/sessions", form(body));
  return session.url as string;
}

/**
 * Card-up-front Checkout with a Stripe trial, then the first-year price.
 * The public signup form does not call this. It provisions a trial of
 * TRIAL_DAYS with no card via provisionCustomerTenant; the customer subscribes
 * later from Plan & billing. This helper still requires a card when it is used,
 * and it does not apply a coupon. `metadata.provision = tenant` tells the
 * webhook this completed checkout should provision a brand-new customer tenant.
 */
export async function createTrialCheckoutSession(params: {
  plan: string;
  seats?: number | null;
  trialDays: number;
  customerEmail?: string;
  companyName?: string;
  appUrl: string;
}): Promise<string> {
  const price = requireCheckoutPrice(params.plan, true);
  const qty = checkoutQuantity(params.plan, params.seats);
  const seatsMeta = isPerSeatPlan(params.plan)
    ? String(qty)
    : String(getPlan(params.plan)?.seats ?? "");
  const planDef = getPlan(params.plan);
  const trialDays = params.trialDays > 0 ? params.trialDays : TRIAL_DAYS;

  const body: Record<string, string | undefined> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": String(qty),
    success_url: `${params.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.appUrl}/signup?checkout=cancel&plan=${params.plan}`,
    customer_email: params.customerEmail,
    // This Checkout path collects a card even though the trial is free.
    // Public signup does not use it.
    payment_method_collection: "always",
    "subscription_data[trial_period_days]": String(trialDays),
    "subscription_data[metadata][plan]": params.plan,
    "subscription_data[metadata][seats]": seatsMeta,
    "subscription_data[metadata][provision]": "tenant",
    "subscription_data[metadata][firstYear]": "1",
    "subscription_data[metadata][trialDays]": String(trialDays),
    "metadata[plan]": params.plan,
    "metadata[seats]": seatsMeta,
    "metadata[provision]": "tenant",
    "metadata[companyName]": params.companyName,
    "metadata[firstYear]": "1",
    "metadata[trialDays]": String(trialDays),
  };
  if (isPerSeatPlan(params.plan)) {
    body["line_items[0][adjustable_quantity][enabled]"] = "true";
    body["line_items[0][adjustable_quantity][minimum]"] = String(
      SHOP_PAID_MIN_SEATS
    );
    body["line_items[0][adjustable_quantity][maximum]"] = String(
      planDef?.maxSeats ?? 10
    );
  }

  const session = await stripePost("/checkout/sessions", form(body));
  return session.url as string;
}

type StripeSubscription = Record<string, unknown> & {
  id: string;
  created?: number;
  metadata?: Record<string, string> | null;
  schedule?: string | { id?: string } | null;
  trial_end?: number | null;
  items?: { data?: { quantity?: number; price?: StripePriceRef }[] };
};
async function retrieveStripeSubscription(id: string): Promise<StripeSubscription> {
  if (!/^sub_[a-zA-Z0-9]+$/.test(id) || id.startsWith("sub_sched")) throw new Error("Invalid subscription id");
  return stripeGet(`/subscriptions/${id}`);
}

type StripePriceRef = string | { id?: string } | null | undefined;

function priceRefId(price: StripePriceRef): string | undefined {
  if (!price) return undefined;
  if (typeof price === "string") return price;
  return price.id;
}

type SchedulePhase = {
  start_date?: number;
  end_date?: number | null;
  trial_end?: number | null;
  items?: { price?: StripePriceRef; quantity?: number }[];
};

/**
 * Attach a subscription schedule that keeps the first-year price for 12 paid
 * months, then moves the same quantity onto the standard price. Idempotent:
 * a subscription that already has a phase on the standard price is left alone.
 * Founders return without creating or editing any schedule. Existing schedules
 * require an explicitly approved Stripe reconciliation; this helper never releases them.
 */
export async function ensureIntroRenewalSchedule(
  subscriptionId: string,
  plan: string,
  existingMembership?: FoundingMembership
): Promise<void> {
  if (!subscriptionId.startsWith("sub_") || subscriptionId.startsWith("sub_sched")) {
    throw new Error("Invalid subscription id for first-year schedule");
  }
  // Check the actual subscription start before reading renewal prices or writing
  // any schedule. Delayed webhooks and checkout sessions crossing midnight must
  // not change the entitlement. A persisted account grant survives trial conversion.
  const sub = await retrieveStripeSubscription(subscriptionId);
  if (subscriptionFoundingMembership(sub, existingMembership).foundingMember) return;
  const standardPrice = priceIdForPlan(plan);
  const introPrice = firstYearPriceIdForPlan(plan);
  if (!standardPrice || !introPrice) {
    requireCheckoutPrice(plan, true);
    throw new Error(`Missing Stripe prices for ${plan} first-year schedule`);
  }
  let scheduleId =
    typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;

  if (!scheduleId) {
    try {
      const created = (await stripePost(
        "/subscription_schedules",
        form({ from_subscription: subscriptionId })
      )) as { id?: string };
      scheduleId = created.id;
    } catch (err) {
      const again = (await stripeGet(`/subscriptions/${subscriptionId}`)) as {
        schedule?: string | { id?: string } | null;
      };
      scheduleId =
        typeof again.schedule === "string" ? again.schedule : again.schedule?.id;
      if (!scheduleId) throw err;
    }
  }
  if (!scheduleId) throw new Error("Stripe did not return a subscription schedule");

  const schedule = (await stripeGet(
    `/subscription_schedules/${scheduleId}`
  )) as { phases?: SchedulePhase[] };
  const phases = schedule.phases ?? [];
  const already = phases.some((ph) =>
    (ph.items ?? []).some((it) => priceRefId(it.price) === standardPrice)
  );
  if (already) return;

  const current = phases[phases.length - 1];
  if (!current?.start_date) {
    throw new Error("First-year schedule is missing the current phase");
  }
  const quantity =
    current.items?.[0]?.quantity ?? sub.items?.data?.[0]?.quantity ?? 1;
  const trialEnd = current.trial_end ?? sub.trial_end ?? null;
  const body = buildIntroScheduleUpdate({
    plan,
    startDate: current.start_date,
    quantity,
    introPriceId: introPrice,
    standardPriceId: standardPrice,
    trialEnd,
  });
  await stripePost(`/subscription_schedules/${scheduleId}`, form(body));
}

/** Verify a Stripe webhook signature (Stripe-Signature header). */
export function verifyWebhook(payload: string, sigHeader: string | null): unknown {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  if (!sigHeader) throw new Error("Missing signature");

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("=") as [string, string])
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) throw new Error("Malformed signature");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${payload}`, "utf8")
    .digest("hex");
  const ok =
    expected.length === v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  if (!ok) throw new Error("Signature verification failed");

  // Reject events older than 5 minutes (replay protection).
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
    throw new Error("Timestamp outside tolerance");
  }
  return JSON.parse(payload);
}

function meta(obj: Record<string, unknown>): Record<string, string> {
  return (obj.metadata as Record<string, string> | undefined) ?? {};
}

function seatsFromMeta(
  plan: string,
  m: Record<string, string>,
  obj?: Record<string, unknown>
): number | null {
  // Prefer live Stripe quantity (Shop seats) over stale metadata.
  const itemQty = (
    obj?.items as { data?: { quantity?: number }[] } | undefined
  )?.data?.[0]?.quantity;
  const lineQty = (
    obj?.line_items as { data?: { quantity?: number }[] } | undefined
  )?.data?.[0]?.quantity;
  // checkout.session.completed may include quantity on display_items or lines
  const linesQty = (
    obj?.lines as { data?: { quantity?: number }[] } | undefined
  )?.data?.[0]?.quantity;
  const qty = itemQty ?? lineQty ?? linesQty;
  if (isPerSeatPlan(plan) && typeof qty === "number" && qty > 0) {
    return normalizeSeats(plan, qty);
  }
  if (m.seats != null && m.seats !== "") {
    return normalizeSeats(plan, Number(m.seats));
  }
  return getPlan(plan)?.seats ?? null;
}

/**
 * Map a verified webhook event onto tenant subscription state.
 *
 * Multi-tenant safety: a self-serve signup (metadata.provision === "tenant")
 * provisions a NEW customer tenant and writes its state into that tenant's own
 * schema. It must NEVER call the schema-scoped activatePlan against the request
 * proxy — with no request cookie that resolves to `public` (the live dogfood
 * instance), which a stranger's checkout would otherwise overwrite. Every write
 * below is either provisioning or scoped through the resolved tenant's client.
 */
export async function handleWebhookEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}) {
  const obj = event.data.object;
  const { clientForSchema } = await import("@/lib/db");
  const { provisionCustomerTenant, tenantByStripe } = await import("./tenancy");
  const { activatePlan, cancelSubscription } = await import("./subscription");

  const customerId = typeof obj.customer === "string" ? obj.customer : null;
  const subscriptionId = subscriptionIdForEvent(event.type, obj);
  const cp = (await import("@/lib/db")).controlPlaneClient();

  // Only signed, server-created Checkout metadata can carry this routing hint.
  // Unknown public checkouts still cannot write to the dogfood workspace.
  async function owner(metadata: Record<string, string>) {
    const mapped = await tenantByStripe({ subscriptionId, customerId });
    const hint = metadata.workspaceSchema;
    if (mapped) {
      if (mapped.isDemo || mapped.status === "DESTROYED") return null;
      if (hint && hint !== mapped.schemaName) throw new Error("Billing ownership mismatch");
      return { tenant: mapped, db: clientForSchema(mapped.schemaName) };
    }
    if (hint === "public") return { tenant: null, db: clientForSchema("public") };
    if (hint && /^tenant_[a-z0-9]{6,40}$/.test(hint)) {
      const tenant = await cp.tenant.findUnique({ where: { schemaName: hint } });
      if (tenant && !tenant.isDemo && tenant.status === "ACTIVE") return { tenant, db: clientForSchema(hint) };
    }
    return null;
  }
  async function membershipFor(db: ReturnType<typeof clientForSchema>, sub: StripeSubscription, registry?: { foundingMember: boolean; foundingQualifiedAt: Date | null } | null) {
    const stored = await db.companySettings.findUnique({ where: { id: "default" }, select: { foundingMember: true, foundingQualifiedAt: true } });
    return subscriptionFoundingMembership(sub, { foundingMember: stored?.foundingMember === true || registry?.foundingMember === true, foundingQualifiedAt: stored?.foundingQualifiedAt ?? registry?.foundingQualifiedAt ?? undefined });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const m = meta(obj);
    if (!subscriptionId) throw new Error("Completed checkout is missing a subscription");
    const sub = await retrieveStripeSubscription(subscriptionId);
    const email = (obj.customer_email as string) || (obj.customer_details as Record<string, string> | undefined)?.email || "";
    const plan = m.plan || "STARTER";
    let seats = seatsFromMeta(plan, m, sub);
    if (isPerSeatPlan(plan) && typeof obj.id === "string" && obj.id.startsWith("cs_")) {
      const full = await retrieveCheckoutSession(obj.id);
      if (full?.seats != null) seats = full.seats;
    }
    let workspace = await owner(m);
    let membership = workspace ? await membershipFor(workspace.db, sub, workspace.tenant) : subscriptionFoundingMembership(sub);
    if (m.provision === "tenant") {
      if (!email) throw new Error("Completed checkout is missing customer email");
      const tenant = await provisionCustomerTenant({ plan, seats, billingEmail: email, companyName: m.companyName || null, trialDays: TRIAL_DAYS, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, foundingMembership: membership });
      workspace = { tenant, db: clientForSchema(tenant.schemaName) };
      membership = await membershipFor(workspace.db, sub, workspace.tenant);
    }
    if (workspace) {
      await workspace.db.companySettings.update({ where: { id: "default" }, data: { ...foundingGrant(membership), stripeCustomerId: customerId ?? undefined, stripeSubscriptionId: subscriptionId, billingProvider: "stripe" } });
      if (workspace.tenant) await cp.tenant.update({ where: { id: workspace.tenant.id }, data: { ...foundingGrant(membership), stripeCustomerId: customerId ?? undefined, stripeSubscriptionId: subscriptionId, plan } });
      // Do not activate an unpaid asynchronous Checkout just because it completed.
      if (obj.payment_status === "paid" || sub.status === "active") {
        await activatePlan({ plan, seats, provider: "stripe", billingEmail: email || undefined, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, foundingMembership: membership }, workspace.db);
      }
    }
    if (m.firstYear === "1" && ["active", "trialing"].includes(String(sub.status))) await ensureIntroRenewalSchedule(subscriptionId, plan, membership);
    return;
  }

  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_succeeded", "invoice.paid"].includes(event.type)) {
    if (!subscriptionId) return;
    const sub = event.type.startsWith("customer.subscription.") ? obj as StripeSubscription : await retrieveStripeSubscription(subscriptionId);
    const workspace = await owner(meta(sub));
    if (!workspace) return;
    const membership = await membershipFor(workspace.db, sub, workspace.tenant);
    if (membership.foundingMember) {
      await workspace.db.companySettings.update({ where: { id: "default" }, data: foundingGrant(membership) });
      if (workspace.tenant) await cp.tenant.update({ where: { id: workspace.tenant.id }, data: foundingGrant(membership) });
    }
    if (event.type === "customer.subscription.deleted") {
      await cancelSubscription(undefined, workspace.db);
      return;
    }
    const plan = meta(sub).plan || workspace.tenant?.plan || "STARTER";
    if (meta(sub).firstYear === "1" && ["active", "trialing"].includes(String(sub.status))) {
      await ensureIntroRenewalSchedule(subscriptionId, plan, membership);
    }
    if (sub.status === "trialing") {
      await workspace.db.companySettings.update({ where: { id: "default" }, data: { subscriptionStatus: "TRIALING", trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined } });
      return;
    }
    if (event.type.startsWith("customer.subscription.") && sub.status && sub.status !== "active") return;
    const periodEndUnix = (sub.current_period_end as number | undefined) ?? (obj.lines as { data?: { period?: { end?: number } }[] } | undefined)?.data?.[0]?.period?.end;
    await activatePlan({ plan, seats: seatsFromMeta(plan, meta(sub), sub), provider: "stripe", currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, billingEmail: workspace.tenant?.billingEmail, foundingMembership: membership }, workspace.db);
  }
}

/** Never persist an invoice/session id as a subscription id. Supports current and legacy invoices. */
export function subscriptionIdForEvent(type: string, obj: Record<string, unknown>): string | null {
  const ref = type.startsWith("customer.subscription.") ? obj.id : obj.subscription ??
    (obj.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details?.subscription;
  const id = typeof ref === "string" ? ref : (ref as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^sub_[a-zA-Z0-9]+$/.test(id) && !id.startsWith("sub_sched") ? id : null;
}
