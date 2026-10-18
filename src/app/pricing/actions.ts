"use server";

import { redirect } from "next/navigation";
import { appUrlForCheckout } from "@/lib/request-origin";
import {
  PLANS,
  isPerSeatPlan,
  normalizeSeats,
} from "@/lib/services/subscription-plans";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Logged-out pay-now. Reuses the existing first-year Stripe prices and
 * Checkout Session helper. Does not require a session and does not write to
 * the current (demo or dogfood) schema — the webhook provisions a new tenant
 * after payment.
 */
export async function actionStartPublicCheckout(formData: FormData) {
  const plan = String(formData.get("plan") || "").trim().toUpperCase();
  const email = String(formData.get("email") || "").trim();
  const company = String(formData.get("company") || "").trim().slice(0, 200);
  const selectable = PLANS.some((p) => p.key === plan && p.pricing !== "custom");
  if (!selectable) redirect("/pricing?error=plan");
  if (email && !EMAIL_RE.test(email)) {
    redirect(`/pricing?error=email&plan=${plan.toLowerCase()}`);
  }

  const { stripeEnabled, createCheckoutSession } = await import(
    "@/lib/services/stripe"
  );
  if (!stripeEnabled()) {
    redirect(`/pricing?error=unavailable&plan=${plan.toLowerCase()}`);
  }

  const seats = isPerSeatPlan(plan)
    ? normalizeSeats(plan, Number(formData.get("seats") || 1))
    : null;

  let url = "";
  try {
    url = await createCheckoutSession({
      plan,
      seats,
      customerEmail: email || undefined,
      companyName: company || undefined,
      appUrl: await appUrlForCheckout(),
      firstYear: true,
      provisionTenant: true,
    });
  } catch {
    redirect(`/pricing?error=stripe&plan=${plan.toLowerCase()}`);
  }
  redirect(url);
}
