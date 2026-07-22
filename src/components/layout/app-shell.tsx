"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { ThemeProvider, useTheme } from "./theme-provider";
import { ActionLoadingProvider } from "./action-loading";
import { Toaster } from "sonner";

export type DemoUser = {
  id: string;
  name: string;
  role: string;
  title: string | null;
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
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules: string[];
  breaks: ShellBreak[];
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { theme } = useTheme();
  const pathname = usePathname();

  // Print documents and the public demo landing render without chrome.
  if (pathname?.startsWith("/print") || pathname?.startsWith("/demo")) {
    return <>{children}</>;
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
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} disabledModules={disabledModules} />
      <Toaster
        theme={theme === "light" ? "light" : "dark"}
        position="bottom-right"
        toastOptions={{
          className:
            "border-border bg-card text-card-foreground",
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
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
  disabledModules?: string[];
  breaks?: ShellBreak[];
}) {
  const pathname = usePathname();
  // Auth screens render bare — no sidebar/header chrome
  if (
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/invite/")
  ) {
    return <ThemeProvider>{children}</ThemeProvider>;
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
        >
          {children}
        </ShellInner>
      </ActionLoadingProvider>
    </ThemeProvider>
  );
}
