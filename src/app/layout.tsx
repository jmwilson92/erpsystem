import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SandboxBanner } from "@/components/layout/sandbox-banner";
import { TrialBanner } from "@/components/layout/trial-banner";
import { FlashToast } from "@/components/layout/flash-toast";
import { CookieBanner } from "@/components/marketing/cookie-banner";
import { getSubscriptionState } from "@/lib/services/subscription";
import { getCurrentUser, listUsers } from "@/lib/auth";
import { demoModeEnabled } from "@/lib/auth-core";
import { prisma, DEMO_COOKIE } from "@/lib/db";
import { getNotificationSummary } from "@/lib/services/notifications";
import { readFlashToast } from "@/lib/flash";
import { moduleKeyForPath } from "@/lib/modules";
import { Analytics } from "@vercel/analytics/next";
import {
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { SupportBubble } from "@/components/support/support-bubble";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: "ForgeRP, LLC" }],
  creator: SITE_NAME,
  publisher: "ForgeRP, LLC",
  category: "business software",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Manufacturing ERP for the whole shop`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Manufacturing ERP`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  // Persona switcher: on for the evaluation build (DEMO_MODE), and for
  // anonymous demo visitors — their user list resolves inside their own
  // throwaway schema (the proxy routes them there), so switching personas is
  // sandbox-scoped and never touches real instances.
  const isAnonymousDemo =
    !!jar.get(DEMO_COOKIE)?.value && !jar.get("forge-session")?.value;
  const showDemoSwitcher = demoModeEnabled() || isAnonymousDemo;
  const [demoUsers, currentUser, companyRaw] = await Promise.all([
    showDemoSwitcher ? listUsers() : Promise.resolve([]),
    getCurrentUser(),
    // Tolerate a bad/forged forge-tenant cookie pointing at a nonexistent
    // schema: the query throws, we fall back to defaults, and the request
    // resolves as logged-out (redirect to /login or the marketing page) rather
    // than 500-ing before the auth gate runs.
    prisma.companySettings
      .upsert({ where: { id: "default" }, create: { id: "default" }, update: {} })
      .catch(() => null),
  ]);
  const company =
    companyRaw ??
    ({
      name: "ForgeRP",
      tagline: null,
      disabledModules: null,
      breaksConfig: null,
    } as unknown as NonNullable<typeof companyRaw>);
  const notifications = currentUser
    ? await getNotificationSummary(currentUser)
    : { total: 0, items: [], badges: {} };
  const inSandbox = Boolean(jar.get(DEMO_COOKIE)?.value);
  const flash = await readFlashToast();

  // Per-module enable/disable: block a disabled module's routes server-side
  // (before the page renders) so nothing from that module reaches the client.
  const disabledModules: string[] = company.disabledModules
    ? (() => {
        try {
          return JSON.parse(company.disabledModules) as string[];
        } catch {
          return [];
        }
      })()
    : [];
  const breaks: { name: string; minutes: number }[] = company.breaksConfig
    ? (() => {
        try {
          const parsed = JSON.parse(company.breaksConfig) as {
            name: string;
            minutes: number;
          }[];
          return Array.isArray(parsed)
            ? parsed.filter((b) => b?.name && b.minutes > 0)
            : [];
        } catch {
          return [];
        }
      })()
    : [];
  const pathname = (await headers()).get("x-pathname") || "";

  // Platform support (ForgeRP dogfood + public marketing) — never customer/demo.
  const platformSupport = await isPlatformSupportEnabled();

  // Public marketing surfaces render without the app shell (no sidebar/header),
  // and skip the auth + subscription gates: the home page for signed-out
  // visitors, and the signup flow. Signed-in users on "/" fall through to the
  // dashboard below.
  const isBareMarketing =
    pathname.startsWith("/signup") ||
    pathname.startsWith("/demo") ||
    pathname.startsWith("/legal") ||
    pathname.startsWith("/support/t/") ||
    (pathname === "/" && !currentUser);
  if (isBareMarketing) {
    // Chat on every public marketing surface (landing, signup, legal, demo splash,
    // guest ticket). Not shown on the staff desk (that's app shell + platform admin).
    const showMarketingChat =
      pathname === "/" ||
      pathname.startsWith("/signup") ||
      pathname.startsWith("/legal") ||
      pathname.startsWith("/demo") ||
      pathname.startsWith("/support/t/");
    return (
      <html lang="en" className="dark" suppressHydrationWarning>
        <head>
          {/* Same day/night preference as the app (forge-theme / system).
              Marketing no longer hard-forces dark — that left the site
              stuck in night mode after the chat-submit fix. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem("forge-theme")||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var c=document.documentElement.classList;c.toggle("dark",t==="dark");c.toggle("light",t==="light");document.documentElement.style.colorScheme=t;}catch(e){}`,
            }}
          />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
          suppressHydrationWarning
        >
          {children}
          {showMarketingChat && (
            <SupportBubble
              source={pathname === "/" ? "LANDING" : "MARKETING"}
              autoOpen
            />
          )}
          <CookieBanner />
          <Analytics />
        </body>
      </html>
    );
  }

  // Production auth: middleware only checks that a session cookie EXISTS
  // (edge runtime, no DB). A forged/expired cookie passes it, so enforce
  // the resolved identity here before any page content renders.
  if (
    process.env.DEMO_MODE === "0" &&
    !currentUser &&
    pathname &&
    !["/login", "/invite", "/onboard", "/module-off", "/demo", "/legal"].some(
      (p) => pathname.startsWith(p)
    )
  ) {
    redirect("/login");
  }

  const blockedKey = pathname ? moduleKeyForPath(pathname) : null;
  if (blockedKey && disabledModules.includes(blockedKey)) {
    // Redirect before the disabled module's page renders — nothing from that
    // module reaches the client (not even the RSC payload).
    redirect(`/module-off?m=${blockedKey}`);
  }

  // Subscription gate: once the trial ends with no paid plan, wall the app off
  // (production only — the demo instance is never gated). Billing, auth, and a
  // few utility routes stay reachable so the customer can upgrade or leave.
  const subscription = await getSubscriptionState();
  const billingAllowlist = [
    "/billing",
    "/login",
    "/invite",
    "/onboard", // new-customer claim flow — must not be gated by the dogfood plan
    "/legal",
    "/demo",
    "/module-off",
    "/api",
  ];
  // Demo visitors are never billed or gated.
  const isDemoRequest =
    !!jar.get("forge-demo")?.value && !jar.get("forge-session")?.value;
  if (
    !isDemoRequest &&
    subscription.enforced &&
    !subscription.hasAccess &&
    pathname &&
    !billingAllowlist.some((p) => pathname.startsWith(p))
  ) {
    redirect("/billing?expired=1");
  }
  const shellUsers = showDemoSwitcher
    ? demoUsers.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        title: u.title,
      }))
    : [];
  return (
    // suppressHydrationWarning: browser extensions (e.g. Scribe) often inject
    // class/data attrs on <html>/<body> before React hydrates.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a dark flash
            for day-mode users (ThemeProvider takes over after hydration). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("forge-theme")||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var c=document.documentElement.classList;c.toggle("dark",t==="dark");c.toggle("light",t==="light");document.documentElement.style.colorScheme=t;}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <AppShell
          company={{ name: company.name, tagline: company.tagline }}
          disabledModules={disabledModules}
          breaks={breaks}
          notifications={notifications}
          demoUsers={shellUsers}
          platformSupport={platformSupport}
          currentUser={
            currentUser
              ? {
                  id: currentUser.id,
                  name: currentUser.name,
                  role: currentUser.role,
                  title: currentUser.title,
                  email: currentUser.email,
                }
              : null
          }
        >
          {inSandbox && <SandboxBanner />}
          {subscription.isTrialing && subscription.trialDaysLeft != null && (
            <TrialBanner
              daysLeft={subscription.trialDaysLeft}
              plan={subscription.plan}
              provider={subscription.billingProvider}
              endsAt={subscription.trialEndsAt?.toISOString() ?? null}
            />
          )}
          {flash && (
            <FlashToast message={flash.m} kind={flash.k} stamp={flash.t} />
          )}
          {children}
        </AppShell>
        <CookieBanner />
        <Analytics />
      </body>
    </html>
  );
}
