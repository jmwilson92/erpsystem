import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingSection } from "@/components/marketing/landing-page";
import { firstYearOfferSummary } from "@/lib/services/subscription-plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Protessera pricing. ${firstYearOfferSummary()}`,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Protessera pricing",
    description: firstYearOfferSummary(),
    url: "/pricing",
  },
  robots: { index: true, follow: true },
};

const ERRORS: Record<string, string> = {
  plan: "Choose Shop, Starter, Growth, or Business to pay now.",
  email: "That email doesn't look right — please check and try again.",
  unavailable:
    "Pay now isn't switched on yet. You can still start a free trial with no card.",
  stripe: "We couldn't start checkout just now. Please try again in a moment.",
};

/**
 * Public pricing. Middleware used to send /pricing to /login; this page
 * renders the plans with no session. Pay now goes straight to Stripe Checkout.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const errorKey = (Array.isArray(sp.error) ? sp.error[0] : sp.error) || "";
  const errorMsg = ERRORS[errorKey];
  const cancelled =
    (Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout) === "cancel";

  return (
    <div className="marketing-story bg-slate-950">
      <MarketingShell>
        {(errorMsg || cancelled) && (
          <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {errorMsg ||
              "Checkout was cancelled — no card was charged. Pick a plan below whenever you're ready."}
          </div>
        )}
        <PricingSection />
      </MarketingShell>
    </div>
  );
}
