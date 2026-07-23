import Link from "next/link";
import { CheckCircle2, Factory } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { TRIAL_DAYS } from "@/lib/services/subscription";

export const dynamic = "force-dynamic";

/**
 * Stripe success landing. The subscription + trial start on Stripe's side; the
 * webhook provisions the customer's workspace asynchronously, so this page just
 * confirms and sets expectations (login details follow by email during
 * onboarding).
 */
export default function SignupCompletePage() {
  return (
    <MarketingShell>
      <div className="grid place-items-center px-6 py-20">
        <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-400">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">You&apos;re in — trial started</h1>
        <p className="mt-3 text-slate-400">
          Your card is on file but won&apos;t be charged for {TRIAL_DAYS} days. We&apos;re
          setting up your ForgeRP workspace now — you&apos;ll get an email with your
          login details shortly. Cancel anytime before the trial ends and you&apos;re
          never billed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
          >
            <Factory className="h-4 w-4" /> Back to ForgeRP
          </Link>
          <a
            href="mailto:hello@forge-rp.live?subject=ForgeRP%20onboarding"
            className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold hover:border-teal-500/50"
          >
            Questions? Email us
          </a>
        </div>
        <p className="mt-6 text-xs text-slate-600">
          A receipt is on its way from Stripe. Need a refund? You have 15 days after the
          first charge.
        </p>
        </div>
      </div>
    </MarketingShell>
  );
}
