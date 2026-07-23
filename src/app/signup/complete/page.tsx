import Link from "next/link";
import {
  CheckCircle2,
  Globe,
  MonitorDown,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { TRIAL_DAYS } from "@/lib/services/subscription";
import { retrieveCheckoutSession, stripeEnabled } from "@/lib/services/stripe";
import {
  provisionCustomerTenant,
  issueOnboardingLink,
} from "@/lib/services/tenancy";

export const dynamic = "force-dynamic";

/**
 * Stripe success landing — instant self-serve onboarding, no emails.
 *
 * The session_id Stripe appends to the success URL is verified server-side with
 * the secret key; a complete checkout provisions the customer's workspace right
 * here (idempotent with the webhook — whoever runs first wins) and offers two
 * paths: jump into the browser setup now, or get the desktop build.
 */
export default async function SignupCompletePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const sessionId =
    (Array.isArray(sp.session_id) ? sp.session_id[0] : sp.session_id) || "";

  let onboardUrl: string | null = null;
  let companyName: string | null = null;
  let failed = false;
  try {
    if (!sessionId || !stripeEnabled()) throw new Error("no session");
    const session = await retrieveCheckoutSession(sessionId);
    if (!session?.complete || !session.provision || !session.email) {
      throw new Error("session not provisionable");
    }
    const tenant = await provisionCustomerTenant({
      plan: session.plan,
      billingEmail: session.email,
      companyName: session.companyName,
      trialDays: TRIAL_DAYS,
      stripeCustomerId: session.customerId,
      stripeSubscriptionId: session.subscriptionId,
    });
    companyName = tenant.name;
    const { url } = await issueOnboardingLink(tenant.id);
    onboardUrl = url || null;
  } catch {
    failed = true;
  }

  return (
    <MarketingShell>
      <div className="grid place-items-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-400">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">
              You&apos;re in — {companyName ? `${companyName} is` : "your workspace is"} ready
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-slate-400">
              Your card is on file but won&apos;t be charged for {TRIAL_DAYS} days.
              Cancel anytime before the trial ends and you&apos;re never billed.
              Pick how you want to run ForgeRP:
            </p>
          </div>

          {onboardUrl ? (
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <Link
                href={onboardUrl}
                className="group flex flex-col rounded-2xl border border-teal-500/50 bg-teal-500/[0.07] p-6 ring-1 ring-teal-500/30 transition-colors hover:bg-teal-500/[0.12]"
              >
                <Globe className="h-6 w-6 text-teal-400" />
                <h2 className="mt-3 font-semibold text-slate-100">
                  Set up in your browser
                </h2>
                <p className="mt-1.5 flex-1 text-sm text-slate-400">
                  Jump straight in — set your admin password, then the guided
                  setup wizard walks you through company info, pay policies, and
                  adding your team.
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-300">
                  Start setup now{" "}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>

              {(() => {
                const installer = process.env.DESKTOP_DOWNLOAD_URL;
                const cardClass =
                  "group flex flex-col rounded-2xl border border-slate-800 bg-slate-950/40 p-6 transition-colors hover:border-teal-500/40";
                const body = (
                  <>
                    <MonitorDown className="h-6 w-6 text-slate-400" />
                    <h2 className="mt-3 font-semibold text-slate-100">
                      Run it on your own machine
                    </h2>
                    <p className="mt-1.5 flex-1 text-sm text-slate-400">
                      Prefer the downloadable version? Your data stays entirely on
                      your hardware.
                      {installer
                        ? " The installer download starts as soon as you click."
                        : " The desktop installer is on the way — request it and we’ll send it with setup steps."}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                      {installer ? "Download the desktop app" : "Request the installer"}{" "}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </>
                );
                // When the installer URL is configured, clicking auto-starts the
                // download; until then, fall back to requesting it.
                return installer ? (
                  <a href={installer} download className={cardClass}>
                    {body}
                  </a>
                ) : (
                  <a
                    href="mailto:hello@forge-rp.live?subject=ForgeRP%20desktop%20installer"
                    className={cardClass}
                  >
                    {body}
                  </a>
                );
              })()}
            </div>
          ) : failed ? (
            <div className="mx-auto mt-8 flex max-w-lg items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Your payment went through, but we couldn&apos;t finish preparing the
                workspace automatically. Refresh this page in a minute — or email{" "}
                <a href="mailto:hello@forge-rp.live" className="underline">
                  hello@forge-rp.live
                </a>{" "}
                and we&apos;ll get you set up right away.
              </span>
            </div>
          ) : null}

          <p className="mt-8 text-center text-xs text-slate-600">
            A receipt is on its way from Stripe. Need a refund? You have 15 days
            after the first charge.{" "}
            <Link href="/legal/refund-policy" className="text-slate-500 underline">
              Refund policy
            </Link>
          </p>
        </div>
      </div>
    </MarketingShell>
  );
}
