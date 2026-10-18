"use server";

import { redirect } from "next/navigation";
import { requestAppUrl } from "@/lib/request-app-url";
import {
  getPlan,
  isPerSeatPlan,
  normalizeSeats,
} from "@/lib/services/subscription-plans";
import {
  createCheckoutSession,
  stripeEnabled,
} from "@/lib/services/stripe";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Logged-out pay-now. Reuses the existing first-year Checkout prices.
 * Stripe collects the email when the form doesn't include one. The webhook
 * and /signup/complete provision the tenant from that email — no login first.
 */
export async function actionStartPublicCheckout(formData: FormData) {
  const plan = String(formData.get("plan") || "").toUpperCase();
  const email = String(formData.get("email") || "").trim();
  const company = String(formData.get("company") || "").trim();
  const seatsRaw = formData.get("seats");
  const known = getPlan(plan);

  if (!known || known.pricing === "custom") {
    redirect("/pricing?error=plan");
  }
  if (email && !EMAIL_RE.test(email)) {
    redirect(`/pricing?error=email&plan=${plan.toLowerCase()}`);
  }
  if (!stripeEnabled()) {
    redirect("/pricing?error=unavailable");
  }

  const seats = isPerSeatPlan(plan)
    ? normalizeSeats(
        plan,
        seatsRaw == null || String(seatsRaw).trim() === ""
          ? 1
          : Number(seatsRaw)
      )
    : null;

  let url: string;
  try {
    url = await createCheckoutSession({
      plan,
      seats,
      customerEmail: email || undefined,
      companyName: company || null,
      appUrl: await requestAppUrl(),
      firstYear: true,
      provisionTenant: true,
    });
  } catch (err) {
    console.error("[pricing] public checkout failed:", err);
    redirect(`/pricing?error=stripe&plan=${plan.toLowerCase()}`);
  }
  redirect(url);
}
