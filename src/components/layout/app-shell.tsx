"use client";

import { Suspense, useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { ThemeProvider, useTheme } from "./theme-provider";
import { Toaster } from "sonner";

export type DemoUser = {
  id: string;
  name: string;
  role: string;
  title: string | null;
};

export type ShellCompany = { name: string; tagline: string };

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
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { theme } = useTheme();

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
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenCommand={() => setCmdOpen(true)} notifications={notifications} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </main>
      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
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
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
  notifications: ShellNotifications;
  company: ShellCompany;
}) {
  return (
    <ThemeProvider>
      <ShellInner
        demoUsers={demoUsers}
        currentUser={currentUser}
        notifications={notifications}
        company={company}
      >
        {children}
      </ShellInner>
    </ThemeProvider>
  );
}
