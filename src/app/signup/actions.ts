"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createTrialCheckoutSession, stripeEnabled } from "@/lib/services/stripe";
import { PLANS, TRIAL_DAYS } from "@/lib/services/subscription";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Kick off a self-serve trial: validate the form, create a Stripe Checkout
 * Session (card up front, 45-day trial), and hand off to Stripe's hosted page.
 * On any problem we bounce back to /signup with an ?error= the page renders.
 */
export async function actionStartTrial(formData: FormData) {
  const plan = String(formData.get("plan") || "").toUpperCase();
  const email = String(formData.get("email") || "").trim();
  const company = String(formData.get("company") || "").trim();

  const selectable = PLANS.some((p) => p.key === plan && p.key !== "ENTERPRISE");
  if (!selectable) redirect(`/signup?error=plan`);
  if (!EMAIL_RE.test(email)) redirect(`/signup?error=email&plan=${plan}`);
  if (!stripeEnabled()) redirect(`/signup?error=unavailable&plan=${plan}`);

  const h = await headers();
  const appUrl =
    process.env.APP_URL ||
    `${h.get("x-forwarded-proto") || "https"}://${h.get("host")}`;

  let url: string;
  try {
    url = await createTrialCheckoutSession({
      plan,
      trialDays: TRIAL_DAYS,
      customerEmail: email,
      companyName: company || undefined,
      appUrl,
    });
  } catch {
    redirect(`/signup?error=stripe&plan=${plan}`);
  }
  redirect(url);
}
