import type { Metadata } from "next";
import Link from "next/link";
import { LandingPage } from "@/components/marketing/landing-page";
import { OpeningForge } from "@/components/marketing/opening-forge";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — ${SITE_TAGLINE}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/welcome" },
};

/**
 * Marketing landing. After ending a test drive (?ended=1): ring + full story,
 * never auto-provisions a demo. User must click Live demo / Open the Forge.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const endedRaw = Array.isArray(sp.ended) ? sp.ended[0] : sp.ended;
  const ended = endedRaw === "1";
  const warmingRaw = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const warming = warmingRaw === "warming";

  if (ended) {
    return (
      <div className="marketing-story min-h-screen bg-slate-950">
        <SiteHeader />
        <OpeningForge autoStart={false} ended />
        <LandingPage showChrome={false} showClassicHero={false} />
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="marketing-story">
      {warming && (
        <div className="border-b border-amber-500/40 bg-amber-100 px-4 py-3 text-center text-sm text-black">
          The demo plant is warming up. Browse pricing below, or{" "}
          <Link href="/" className="font-semibold underline">
            try Live demo again
          </Link>
          .
        </div>
      )}
      <LandingPage />
    </div>
  );
}
