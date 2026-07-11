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

function ShellInner({
  children,
  demoUsers,
  currentUser,
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
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
        <Sidebar demoUsers={demoUsers} currentUser={currentUser} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenCommand={() => setCmdOpen(true)} />
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
}: {
  children: React.ReactNode;
  demoUsers: DemoUser[];
  currentUser: DemoUser | null;
}) {
  return (
    <ThemeProvider>
      <ShellInner demoUsers={demoUsers} currentUser={currentUser}>
        {children}
      </ShellInner>
    </ThemeProvider>
  );
}
