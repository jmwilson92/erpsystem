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

/** Map a verified webhook event onto the local subscription state. */
export async function handleWebhookEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}) {
  const { activatePlan, cancelSubscription } = await import("./subscription");
  const obj = event.data.object;

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated"
  ) {
    const plan =
      ((obj.metadata as Record<string, string> | undefined)?.plan as string) ||
      "BUSINESS";
    const periodEndUnix =
      (obj.current_period_end as number | undefined) ??
      (obj.expires_at as number | undefined);
    await activatePlan({
      plan,
      provider: "stripe",
      currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
      stripeCustomerId: (obj.customer as string) || null,
      stripeSubscriptionId:
        (obj.subscription as string) || (obj.id as string) || null,
      billingEmail:
        (obj.customer_email as string) ||
        ((obj.customer_details as Record<string, string> | undefined)?.email as string) ||
        null,
    });
  } else if (event.type === "customer.subscription.deleted") {
    await cancelSubscription();
  }
}
