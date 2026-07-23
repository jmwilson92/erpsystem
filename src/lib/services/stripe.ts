import crypto from "crypto";

/**
 * Minimal Stripe integration over the REST API (no SDK dependency). Env-gated:
 * unconfigured → the billing page falls back to in-app activation.
 *
 *   STRIPE_SECRET_KEY        sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...
 *   STRIPE_PRICE_STARTER     price_... (annual)
 *   STRIPE_PRICE_GROWTH      price_...
 *   STRIPE_PRICE_BUSINESS    price_...
 *   APP_URL                  https://your-instance (for success/cancel URLs)
 *
 * Enterprise is "contact sales" — no self-serve checkout.
 */

const API = "https://api.stripe.com/v1";

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function priceIdForPlan(plan: string): string | undefined {
  const map: Record<string, string | undefined> = {
    STARTER: process.env.STRIPE_PRICE_STARTER,
    GROWTH: process.env.STRIPE_PRICE_GROWTH,
    BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
  };
  return map[plan];
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

export type CheckoutSessionInfo = {
  complete: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  email: string;
  plan: string;
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
  const s = (await stripeGet(`/checkout/sessions/${sessionId}`)) as {
    status?: string;
    customer?: string | null;
    subscription?: string | null;
    customer_email?: string | null;
    customer_details?: { email?: string | null } | null;
    metadata?: Record<string, string> | null;
  };
  return {
    complete: s.status === "complete",
    customerId: s.customer || null,
    subscriptionId: s.subscription || null,
    email: s.customer_email || s.customer_details?.email || "",
    plan: s.metadata?.plan || "STARTER",
    companyName: s.metadata?.companyName || null,
    provision: s.metadata?.provision === "tenant",
  };
}

/** Create a subscription Checkout Session; returns the hosted checkout URL. */
export async function createCheckoutSession(params: {
  plan: string;
  customerEmail?: string;
  appUrl: string;
}): Promise<string> {
  const price = priceIdForPlan(params.plan);
  if (!price) {
    throw new Error(
      `No Stripe price configured for ${params.plan}. Set STRIPE_PRICE_${params.plan}.`
    );
  }
  const session = await stripePost(
    "/checkout/sessions",
    form({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      success_url: `${params.appUrl}/billing?checkout=success`,
      cancel_url: `${params.appUrl}/billing?checkout=cancel`,
      customer_email: params.customerEmail,
      "metadata[plan]": params.plan,
      "subscription_data[metadata][plan]": params.plan,
      allow_promotion_codes: "true",
    })
  );
  return session.url as string;
}

/**
 * Whether the launch promo (50% off first year) is currently active. Gated to a
 * window that opens on LAUNCH_DATE and runs LAUNCH_PROMO_DAYS (default 60) days.
 * If LAUNCH_DATE is unset, the auto-coupon is off (customers can still enter a
 * promo code manually — allow_promotion_codes stays on).
 */
export function launchPromoActive(now: Date = new Date()): boolean {
  const raw = process.env.LAUNCH_DATE;
  if (!raw) return false;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return false;
  const days = Number(process.env.LAUNCH_PROMO_DAYS) || 60;
  const end = new Date(start.getTime() + days * 86_400_000);
  return now >= start && now <= end;
}

/**
 * Create a subscription Checkout Session for a new self-serve signup: card
 * required up front, a 45-day free trial (no charge until day 45), and — inside
 * the launch window — the 50%-off-first-year coupon applied automatically.
 * Returns the hosted checkout URL. `metadata.provision = tenant` tells the
 * webhook this completed checkout should provision a brand-new customer tenant.
 */
export async function createTrialCheckoutSession(params: {
  plan: string;
  trialDays: number;
  customerEmail?: string;
  companyName?: string;
  appUrl: string;
}): Promise<string> {
  const price = priceIdForPlan(params.plan);
  if (!price) {
    throw new Error(
      `No Stripe price configured for ${params.plan}. Set STRIPE_PRICE_${params.plan}.`
    );
  }
  const coupon = process.env.STRIPE_COUPON_LAUNCH;
  const applyCoupon = coupon && launchPromoActive();

  const body: Record<string, string | undefined> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${params.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.appUrl}/signup?checkout=cancel&plan=${params.plan}`,
    customer_email: params.customerEmail,
    // Require a card even though the trial is free, so day-45 billing is seamless.
    payment_method_collection: "always",
    "subscription_data[trial_period_days]": String(params.trialDays),
    "subscription_data[metadata][plan]": params.plan,
    "subscription_data[metadata][provision]": "tenant",
    "metadata[plan]": params.plan,
    "metadata[provision]": "tenant",
    "metadata[companyName]": params.companyName,
    allow_promotion_codes: applyCoupon ? undefined : "true",
  };
  // Stripe rejects allow_promotion_codes + discounts together; when we auto-apply
  // the launch coupon we drop the manual promo-code box.
  if (applyCoupon) body["discounts[0][coupon]"] = coupon;

  const session = await stripePost("/checkout/sessions", form(body));
  return session.url as string;
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
    if (m.provision !== "tenant") return; // not a self-serve signup — ignore
    const email =
      (obj.customer_email as string) ||
      ((obj.customer_details as Record<string, string> | undefined)?.email) ||
      "";
    if (!email) throw new Error("checkout.session.completed missing customer email");
    await provisionCustomerTenant({
      plan: m.plan || "STARTER",
      billingEmail: email,
      companyName: m.companyName || null,
      trialDays: 45,
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
    await activatePlan(
      {
        plan: tenant.plan || meta(obj).plan || "STARTER",
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
