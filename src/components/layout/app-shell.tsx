"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { ThemeProvider, useTheme } from "./theme-provider";
import { ActionLoadingProvider } from "./action-loading";
import { GuidedTour } from "@/components/guides/guided-tour";
import { SupportBubble } from "@/components/support/support-bubble";
import { Toaster } from "sonner";

export type DemoUser = {
  id: string;
  name: string;
  role: string;
  title: string | null;
  email?: string | null;
};

export type ShellCompany = { name: string; tagline: string };

export type ShellBreak = { name: string; minutes: number };

export type ShellNotifications = {
  total: number;
  items: { label: string; count: number; href: string }[];
  badges: Record<string, number>;
};

function ShellInner({
  children,
  demoUsers,
  currentUser,
  notifications,
  company,
  disabledModules,
  breaks,
  platformSupport = false,
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules: string[];
  breaks: ShellBreak[];
  /** ForgeRP dogfood only — never customer tenant or demo */
  platformSupport?: boolean;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { theme } = useTheme();
  const pathname = usePathname();

  // Print documents render without chrome (and no chat bubble).
  if (pathname?.startsWith("/print")) {
    return <>{children}</>;
  }

  // ForgeRP platform staff use the admin desk — hide the ask-bubble for them
  // so they don't chat with themselves. Everyone else (customers, demos,
  // marketing, dogfood non-admins) gets the bubble.
  const isPlatformStaff =
    platformSupport && currentUser?.role === "ADMIN";
  const onStaffDesk = pathname?.startsWith("/admin/support");
  const showHelpBubble = !isPlatformStaff && !onStaffDesk;

  // Demo splash can render without sidebar chrome but still gets the bubble.
  if (pathname?.startsWith("/demo")) {
    return (
      <>
        {children}
        {showHelpBubble && (
          <SupportBubble source="DEMO" autoOpen defaultName="" defaultEmail="" />
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Suspense
        fallback={
          <aside className="w-60 border-r border-border bg-background" />
        }
      >
        <Sidebar
          demoUsers={demoUsers}
          currentUser={currentUser}
          badges={notifications.badges}
          company={company}
          disabledModules={disabledModules}
          platformSupport={platformSupport}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenCommand={() => setCmdOpen(true)}
          notifications={notifications}
          breaks={breaks}
          currentUser={currentUser}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </main>
      </div>
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        disabledModules={disabledModules}
        platformSupport={platformSupport}
      />
      <GuidedTour />
      {showHelpBubble && (
        <SupportBubble
          accountLinked={platformSupport && !!currentUser}
          source={platformSupport ? "APP" : "TENANT"}
          defaultName={currentUser?.name || ""}
          defaultEmail={currentUser?.email || ""}
          autoOpen
          badge={
            platformSupport
              ? notifications.badges["/support"] || 0
              : 0
          }
        />
      )}
      <Toaster
        theme={theme === "light" ? "light" : "dark"}
        position="bottom-right"
        toastOptions={{
          className:
            "border-border bg-card text-card-foreground",
          // Leave room for the floating help bubble
          style: { marginBottom: "4.5rem" },
        }}
      />
    </div>
  );
}

export function AppShell({
  children,
  demoUsers,
  currentUser,
  notifications,
  company,
  disabledModules = [],
  breaks = [],
  platformSupport = false,
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules?: string[];
  breaks?: ShellBreak[];
  platformSupport?: boolean;
}) {
  const pathname = usePathname();
  // Auth screens render bare — no sidebar/header chrome, but still offer chat
  if (
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/invite/") ||
    pathname?.startsWith("/onboard/")
  ) {
    return (
      <ThemeProvider>
        {children}
        <SupportBubble source="MARKETING" autoOpen />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <ActionLoadingProvider>
        <ShellInner
          demoUsers={demoUsers}
          currentUser={currentUser}
          notifications={notifications}
          company={company}
          disabledModules={disabledModules}
          breaks={breaks}
          platformSupport={platformSupport}
        >
          {children}
        </ShellInner>
      </ActionLoadingProvider>
    </ThemeProvider>
  );
}
