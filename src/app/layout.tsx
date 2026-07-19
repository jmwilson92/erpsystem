import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SandboxBanner } from "@/components/layout/sandbox-banner";
import { FlashToast } from "@/components/layout/flash-toast";
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
  const pathname = (await headers()).get("x-pathname") || "";
  const blockedKey = pathname ? moduleKeyForPath(pathname) : null;
  if (blockedKey && disabledModules.includes(blockedKey)) {
    // Redirect before the disabled module's page renders — nothing from that
    // module reaches the client (not even the RSC payload).
    redirect(`/module-off?m=${blockedKey}`);
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
          {flash && (
            <FlashToast message={flash.m} kind={flash.k} stamp={flash.t} />
          )}
          {children}
        </AppShell>
      </body>
    </html>
  );
}
