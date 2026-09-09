import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEMO_COOKIE } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-core";
import { getCurrentUser } from "@/lib/auth";
import { SpinningUpShop } from "@/components/marketing/spinning-up-shop";
import { LandingPage } from "@/components/marketing/landing-page";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE_DESCRIPTOR } from "@/lib/site";
import { StatCard } from "@/components/shared/stat-card";
import { Factory, FlaskConical, ShoppingCart, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getSessionUser().catch(() => null);
  const jar = await cookies();
  const { demoSchemaIsLive } = await import("@/lib/services/tenancy");
  const inPlant = Boolean(session) || (await demoSchemaIsLive(jar.get(DEMO_COOKIE)?.value));
  if (inPlant) {
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
  const endedRaw = Array.isArray(sp.ended) ? sp.ended[0] : sp.ended;
  const ended = endedRaw === "1";

  const sessionUser = await getSessionUser().catch(() => null);
  const jar = await cookies();
  const demoCookie = jar.get(DEMO_COOKIE)?.value;
  const { demoSchemaIsLive } = await import("@/lib/services/tenancy");
  const hasDemoCookie = await demoSchemaIsLive(demoCookie);

  // Marketing only when there is no password session AND no live sandbox.
  if (!sessionUser && !hasDemoCookie) {
    if (ended) redirect("/welcome?ended=1");
    return <SplashShell hasExistingDemo={false} ended={false} />;
  }

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return <SplashShell hasExistingDemo={false} ended={false} />;
  }

  const [woCounts, openMrb, openNcr, openPos] = await Promise.all([
    prisma.workOrder.groupBy({ by: ["status"], _count: true }),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.nonConformance.count({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
    }),
    prisma.purchaseOrder.count({
      where: {
        status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"] },
      },
    }),
  ]);

  const statusMap = Object.fromEntries(woCounts.map((w) => [w.status, w._count]));
  const activeWos =
    (statusMap["IN_PROGRESS"] || 0) +
    (statusMap["RELEASED"] || 0) +
    (statusMap["ON_HOLD"] || 0);
  const firstName = user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-slate-500">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Command center — production, quality, and supply at a glance.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Work Orders"
          value={activeWos}
          subtitle={`${statusMap["ON_HOLD"] || 0} on hold`}
          icon={Factory}
          accent="teal"
          href="/work-orders"
        />
        <StatCard
          title="Open MRB / NCR"
          value={`${openMrb} / ${openNcr}`}
          subtitle="Material review · non-conformances"
          icon={FlaskConical}
          accent={openMrb > 0 ? "amber" : "emerald"}
          href="/mrb"
        />
        <StatCard
          title="Open Purchase Orders"
          value={openPos}
          subtitle="In supply pipeline"
          icon={ShoppingCart}
          accent="sky"
          href="/purchasing"
        />
        <StatCard
          title="Production Floor"
          value="Live"
          subtitle="Stations, WIP, and travelers"
          icon={ClipboardList}
          accent="teal"
          href="/floor"
        />
      </div>
      <p className="text-sm text-slate-500">
        <Link href="/floor" className="text-teal-400 hover:underline">
          Open the production floor →
        </Link>
      </p>
    </div>
  );
}
