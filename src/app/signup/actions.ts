"use server";

import { redirect } from "next/navigation";
import {
  PLANS,
  TRIAL_DAYS,
  isPerSeatPlan,
  normalizeSeats,
} from "@/lib/services/subscription";
import { captureSignupLead } from "@/lib/services/signup-lead";
import {
  issueOnboardingLink,
  provisionCustomerTenant,
} from "@/lib/services/tenancy";

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

  let onboardUrl: string | null = null;
  try {
    const tenant = await provisionCustomerTenant({
      plan,
      seats,
      billingEmail: email,
      companyName: company || null,
      trialDays: TRIAL_DAYS,
    });
    const issued = await issueOnboardingLink(tenant.id);
    onboardUrl = issued.url || null;
  } catch {
    redirect(`/signup?error=provision&plan=${plan}`);
  }

  if (!onboardUrl) redirect(`/signup?error=provision&plan=${plan}`);
  redirect(onboardUrl);
}
