import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SpinningUpShop } from "@/components/marketing/spinning-up-shop";
import { LandingPage } from "@/components/marketing/landing-page";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE_DESCRIPTOR } from "@/lib/site";
import { DEMO_COOKIE } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-core";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getSessionUser().catch(() => null);
  if (session) {
    return {
      title: "Command center",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: {
      absolute: `${SITE_NAME} — ${SITE_TITLE_DESCRIPTOR}`,
    },
    description: SITE_DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: {
      title: `${SITE_NAME} — Manufacturing ERP for the whole shop`,
      description: SITE_DESCRIPTION,
      url: "/",
      type: "website",
    },
  };
}

function SplashShell({
  hasExistingDemo,
  ended = false,
}: {
  hasExistingDemo?: boolean;
  ended?: boolean;
}) {
  return (
    <div className="marketing-story flex min-h-screen flex-col bg-slate-950">
      <SiteHeader />
      <main className="flex-1">
        <SpinningUpShop
          hasExistingDemo={hasExistingDemo}
          autoStart={false}
          ended={ended}
        />
        <LandingPage showChrome={false} showClassicHero={false} />
      </main>
      <SiteFooter />
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const appRaw = Array.isArray(sp.app) ? sp.app[0] : sp.app;
  const endedRaw = Array.isArray(sp.ended) ? sp.ended[0] : sp.ended;
  const enterApp = appRaw === "1";
  const ended = endedRaw === "1";

  const sessionUser = await getSessionUser().catch(() => null);
  const jar = await cookies();
  const demoCookie = jar.get(DEMO_COOKIE)?.value;
  const { demoSchemaIsLive } = await import("@/lib/services/tenancy");
  const hasDemoCookie = await demoSchemaIsLive(demoCookie);

  // Signed-in operators land on the floor, not the marketing splash.
  if (sessionUser && enterApp) {
    redirect("/floor");
  }
  if (sessionUser && !enterApp) {
    // Keep a real session in the product instead of the splash.
    redirect("/floor");
  }

  if (!sessionUser && !enterApp) {
    if (ended) {
      redirect("/welcome?ended=1");
    }
    return <SplashShell hasExistingDemo={hasDemoCookie} ended={false} />;
  }

  if (!sessionUser && enterApp && !hasDemoCookie) {
    redirect("/");
  }

  if (!sessionUser && enterApp && hasDemoCookie) {
    redirect("/floor");
  }

  return <SplashShell hasExistingDemo={hasDemoCookie} ended={false} />;
}
