import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SandboxBanner } from "@/components/layout/sandbox-banner";
import { TrialBanner } from "@/components/layout/trial-banner";
import { FlashToast } from "@/components/layout/flash-toast";
import { getSubscriptionState } from "@/lib/services/subscription";
import { getCurrentUser, listUsers } from "@/lib/auth";
import { demoModeEnabled } from "@/lib/auth-core";
import { prisma, SANDBOX_COOKIE } from "@/lib/db";
import { getNotificationSummary } from "@/lib/services/notifications";
import { readFlashToast } from "@/lib/flash";
import { moduleKeyForPath } from "@/lib/modules";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ForgeRP — Manufacturing ERP",
  description:
    "Integrated manufacturing ERP: shop floor execution, CM, supply chain, MRB, EVM, and compliance.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Persona switcher only when DEMO_MODE is on (evaluation / test-drive)
  const showDemoSwitcher = demoModeEnabled();
  const [demoUsers, currentUser, company] = await Promise.all([
    showDemoSwitcher ? listUsers() : Promise.resolve([]),
    getCurrentUser(),
    prisma.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
  ]);
  const notifications = currentUser
    ? await getNotificationSummary(currentUser)
    : { total: 0, items: [], badges: {} };
  const jar = await cookies();
  const inSandbox = Boolean(jar.get(SANDBOX_COOKIE)?.value);
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

  // Public marketing surfaces render without the app shell (no sidebar/header),
  // and skip the auth + subscription gates: the home page for signed-out
  // visitors, and the signup flow. Signed-in users on "/" fall through to the
  // dashboard below.
  const isBareMarketing =
    pathname.startsWith("/signup") || (pathname === "/" && !currentUser);
  if (isBareMarketing) {
    return (
      <html lang="en" className="dark" suppressHydrationWarning>
        <head>
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
    !["/login", "/invite", "/module-off", "/demo", "/legal"].some((p) =>
      pathname.startsWith(p)
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
    "/legal",
    "/demo",
    "/module-off",
    "/api",
  ];
  if (
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
          currentUser={
            currentUser
              ? {
                  id: currentUser.id,
                  name: currentUser.name,
                  role: currentUser.role,
                  title: currentUser.title,
                }
              : null
          }
        >
          {inSandbox && <SandboxBanner />}
          {subscription.isTrialing && subscription.trialDaysLeft != null && (
            <TrialBanner daysLeft={subscription.trialDaysLeft} />
          )}
          {flash && (
            <FlashToast message={flash.m} kind={flash.k} stamp={flash.t} />
          )}
          {children}
        </AppShell>
      </body>
    </html>
  );
}
