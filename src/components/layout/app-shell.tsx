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
import { VoiceAssistant } from "@/components/ai/voice-assistant";
import { CarinaPoint } from "@/components/ai/carina-point";
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
  fill = false,
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules: string[];
  breaks: ShellBreak[];
  /** Protessera dogfood only — never customer tenant or demo */
  platformSupport?: boolean;
  /** Fill parent height (demo stack with marketing header/footer) instead of h-screen */
  fill?: boolean;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { theme } = useTheme();
  const pathname = usePathname();

  // Print documents render without chrome (and no chat bubble).
  if (pathname?.startsWith("/print")) {
    return <>{children}</>;
  }

  // Support Staff portal — own chrome (StaffDeskShell), no ERP sidebar/header.
  // Keep AppShell mounted so "Exit portal" → / soft-nav restores the shell
  // (sidebar + logout) instead of a bare page.
  if (
    pathname?.startsWith("/admin/support") ||
    pathname?.startsWith("/admin/insights")
  ) {
    return <>{children}</>;
  }

  // Help bubble for everyone in the ERP (including platform admins testing).
  const showHelpBubble = true;

  // Demo splash can render without sidebar chrome but still gets the bubble.
  if (pathname?.startsWith("/demo")) {
    // Demo shell: support tickets OK; AI only if user is in demo ERP (not bare splash)
    // Bare /demo splash gets support-only; signed-in demo app uses full shell below.
    return (
      <>
        {children}
        {showHelpBubble && (
          <SupportBubble
            source="DEMO"
            autoOpen
            defaultName=""
            defaultEmail=""
            enableAi={false}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={`flex overflow-hidden bg-background text-foreground ${
        fill ? "h-full min-h-0 w-full" : "h-screen"
      }`}
    >
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
      <CarinaPoint />
      {showHelpBubble && (
        <SupportBubble
          accountLinked={platformSupport && !!currentUser}
          source={platformSupport ? "APP" : "TENANT"}
          defaultName={currentUser?.name || ""}
          defaultEmail={currentUser?.email || ""}
          autoOpen
          enableAi
          badge={
            platformSupport
              ? notifications.badges["/support"] || 0
              : 0
          }
        />
      )}
      {/* Single global Carina mic engine (ERP only) */}
      {currentUser && !pathname?.startsWith("/print") && (
        <VoiceAssistant host="shell" />
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
  fill = false,
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules?: string[];
  breaks?: ShellBreak[];
  platformSupport?: boolean;
  /** Nest under marketing chrome (demo) — use parent height instead of h-screen */
  fill?: boolean;
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
        <SupportBubble source="MARKETING" autoOpen enableAi={false} />
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
          fill={fill}
        >
          {children}
        </ShellInner>
      </ActionLoadingProvider>
    </ThemeProvider>
  );
}
