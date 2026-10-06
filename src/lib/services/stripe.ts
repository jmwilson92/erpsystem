import crypto from "crypto";
import {
  getPlan,
  isPerSeatPlan,
  normalizeSeats,
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
 *   STRIPE_PRICE_SHOP        price_... (per-seat monthly, $30/unit; qty = seats 1–10)
 *   STRIPE_PRICE_STARTER     price_... (flat annual, $3,600)
 *   STRIPE_PRICE_GROWTH      price_... (flat annual, $8,400)
 *   STRIPE_PRICE_BUSINESS    price_... (flat annual, $18,000)
 *
 * First-year prices — new checkouts only. A subscription schedule switches to
 * the standard price after 12 paid months. Shop is graduated ($10 first seat,
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
 * Shop: line-item quantity = seats (adjustable 1–10 on Checkout).
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
 * price so the renewal schedule can be attached; we refuse to start a
 * subscription that would stay on the intro price forever.
 */
function requireCheckoutPrice(plan: string, firstYear: boolean): string {
  const key = plan.toUpperCase();
  if (firstYear) {
    const introEnv = STRIPE_FIRST_YEAR_PRICE_ENV[key];
    const standardEnv = STRIPE_STANDARD_PRICE_ENV[key];
    const intro = firstYearPriceIdForPlan(key);
    const standard = priceIdForPlan(key);
    if (!intro || !standard) {
      const missing = [
        !intro ? introEnv : null,
        !standard ? standardEnv : null,
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
  return normalizeSeats(plan, seats) ?? 1;
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
    `/checkout/sessions/${sessionId}?expand[]=line_items`
  )) as {
    status?: string;
    customer?: string | null;
    subscription?: string | null;
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
  return {
    complete: s.status === "complete",
    customerId: s.customer || null,
    subscriptionId: s.subscription || null,
    email: s.customer_email || s.customer_details?.email || "",
    plan,
    seats,
    companyName: s.metadata?.companyName || null,
    provision: s.metadata?.provision === "tenant",
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
   * schedule that moves the subscription onto the standard price after 12
   * paid months. Pass false for an already-paid instance so a plan change
   * bills the standard price and does not rewrite the existing subscription.
   */
  firstYear?: boolean;
}): Promise<string> {
  const firstYear = params.firstYear !== false;
  const price = requireCheckoutPrice(params.plan, firstYear);
  const qty = checkoutQuantity(params.plan, params.seats);
  const seatsMeta = isPerSeatPlan(params.plan)
    ? String(qty)
    : String(getPlan(params.plan)?.seats ?? "");
  const planDef = getPlan(params.plan);
  const body: Record<string, string | undefined> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": String(qty),
    success_url: `${params.appUrl}/billing?checkout=success`,
    cancel_url: `${params.appUrl}/billing?checkout=cancel`,
    customer_email: params.customerEmail,
    "metadata[plan]": params.plan,
    "metadata[seats]": seatsMeta,
    "metadata[firstYear]": firstYear ? "1" : "0",
    "subscription_data[metadata][plan]": params.plan,
    "subscription_data[metadata][seats]": seatsMeta,
    "subscription_data[metadata][firstYear]": firstYear ? "1" : "0",
    // Promo codes stay off so a leftover 50%-off coupon cannot stack on the
    // first-year price or discount an existing subscriber's standard price.
  };
  // Shop: let the customer adjust quantity (seats) on Stripe Checkout, max 10.
  if (isPerSeatPlan(params.plan)) {
    body["line_items[0][adjustable_quantity][enabled]"] = "true";
    body["line_items[0][adjustable_quantity][minimum]"] = String(
      planDef?.minSeats ?? 1
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
 * The hosted signup does not call this — customers start a no-card trial via
 * provisionCustomerTenant and subscribe later from Plan & billing.
 * Kept so a future card-up-front path cannot reintroduce the 50% coupon.
 * `metadata.provision = tenant` tells the webhook to provision a new tenant.
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
      planDef?.minSeats ?? 1
    );
    body["line_items[0][adjustable_quantity][maximum]"] = String(
      planDef?.maxSeats ?? 10
    );
  }

  const session = await stripePost("/checkout/sessions", form(body));
  return session.url as string;
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
 * Never called for an existing subscriber's current subscription.
 */
export async function ensureIntroRenewalSchedule(
  subscriptionId: string,
  plan: string
): Promise<void> {
  if (!subscriptionId.startsWith("sub_") || subscriptionId.startsWith("sub_sched")) {
    throw new Error("Invalid subscription id for first-year schedule");
  }
  const standardPrice = priceIdForPlan(plan);
  const introPrice = firstYearPriceIdForPlan(plan);
  if (!standardPrice || !introPrice) {
    requireCheckoutPrice(plan, true);
    throw new Error(`Missing Stripe prices for ${plan} first-year schedule`);
  }
  const sub = (await stripeGet(`/subscriptions/${subscriptionId}`)) as {
    schedule?: string | { id?: string } | null;
    trial_end?: number | null;
    items?: { data?: { quantity?: number; price?: StripePriceRef }[] };
  };
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

  const customerId = (obj.customer as string) || null;
  const subscriptionId =
    (obj.subscription as string) || (obj.id as string) || null;

  if (event.type === "checkout.session.completed") {
    const m = meta(obj);
    // New first-year checkouts only. An existing subscriber's subscription is
    // not rewritten; their checkout sets firstYear=0 and bills the standard price.
    if (m.firstYear === "1") {
      const subForSchedule =
        typeof obj.subscription === "string" ? obj.subscription : "";
      if (!subForSchedule.startsWith("sub_")) {
        throw new Error(
          "checkout.session.completed missing subscription for first-year schedule"
        );
      }
      await ensureIntroRenewalSchedule(subForSchedule, m.plan || "STARTER");
    }
    if (m.provision !== "tenant") return; // not a self-serve signup — ignore
    const email =
      (obj.customer_email as string) ||
      ((obj.customer_details as Record<string, string> | undefined)?.email) ||
      "";
    if (!email) throw new Error("checkout.session.completed missing customer email");
    const plan = m.plan || "STARTER";
    // Session payloads often omit line_items — re-fetch so Shop qty is correct.
    let seats = seatsFromMeta(plan, m, obj);
    const sid = (obj.id as string) || "";
    if (isPerSeatPlan(plan) && sid.startsWith("cs_")) {
      try {
        const full = await retrieveCheckoutSession(sid);
        if (full?.seats != null) seats = full.seats;
      } catch {
        /* keep seats from meta */
      }
    }
    await provisionCustomerTenant({
      plan,
      seats,
      billingEmail: email,
      companyName: m.companyName || null,
      trialDays:
        Number(m.trialDays) > 0 ? Number(m.trialDays) : TRIAL_DAYS,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
    return;
  }

  // Subscription lifecycle: resolve the owning tenant and write ONLY its schema.
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "invoice.payment_succeeded"
  ) {
    const tenant = await tenantByStripe({ subscriptionId, customerId });
    if (!tenant) return; // unknown subscription (e.g. the dogfood instance) — skip
    const db = clientForSchema(tenant.schemaName);

    if (event.type === "customer.subscription.deleted") {
      await cancelSubscription(undefined, db);
      return;
    }
    // updated / payment succeeded → mark active with the current period end.
    const periodEndUnix =
      (obj.current_period_end as number | undefined) ??
      (obj.lines as { data?: { period?: { end?: number } }[] } | undefined)
        ?.data?.[0]?.period?.end;
    const plan = tenant.plan || meta(obj).plan || "STARTER";
    let seats = seatsFromMeta(plan, meta(obj), obj);
    // Subscription quantity may change (Shop seat adds) — re-fetch when per-seat.
    if (isPerSeatPlan(plan) && subscriptionId?.startsWith("sub_")) {
      try {
        const sub = (await stripeGet(
          `/subscriptions/${subscriptionId}`
        )) as Record<string, unknown>;
        seats = seatsFromMeta(plan, meta(sub), sub) ?? seats;
      } catch {
        /* keep seats from event payload */
      }
    }
    await activatePlan(
      {
        plan,
        seats,
        provider: "stripe",
        currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        billingEmail: tenant.billingEmail,
      },
      db
    );
  }
}
