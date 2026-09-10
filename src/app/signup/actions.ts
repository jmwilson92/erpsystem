"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createTrialCheckoutSession, stripeEnabled } from "@/lib/services/stripe";
import {
  PLANS,
  TRIAL_DAYS,
  isPerSeatPlan,
  normalizeSeats,
} from "@/lib/services/subscription";
import { captureSignupLead } from "@/lib/services/signup-lead";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function actionStartTrial(formData: FormData) {
  const plan = String(formData.get("plan") || "").toUpperCase();
  const email = String(formData.get("email") || "").trim();
  const company = String(formData.get("company") || "").trim();
  const seatsRaw = formData.get("seats");

  const selectable = PLANS.some((p) => p.key === plan && p.key !== "ENTERPRISE");
  if (!selectable) redirect(`/signup?error=plan`);
  if (!EMAIL_RE.test(email)) redirect(`/signup?error=email&plan=${plan}`);

  const seats = isPerSeatPlan(plan)
    ? normalizeSeats(plan, Number(seatsRaw))
    : null;

  void captureSignupLead({
    email,
    company,
    plan,
    seats,
    stage: "submitted",
  });

  if (!stripeEnabled()) redirect(`/signup?error=unavailable&plan=${plan}`);

  const h = await headers();
  const appUrl =
    process.env.APP_URL ||
    `${h.get("x-forwarded-proto") || "https"}://${h.get("host")}`;

  let url: string;
  try {
    url = await createTrialCheckoutSession({
      plan,
      seats,
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
