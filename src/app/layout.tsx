import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser, listUsers } from "@/lib/auth";
import { getNotificationSummary } from "@/lib/services/notifications";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ForgeERP — Manufacturing ERP",
  description:
    "Integrated manufacturing ERP: shop floor execution, CM, supply chain, MRB, EVM, and compliance.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Demo-mode identity switcher data (replace with real auth in prod)
  const [demoUsers, currentUser] = await Promise.all([
    listUsers(),
    getCurrentUser(),
  ]);
  const notifications = currentUser
    ? await getNotificationSummary(currentUser)
    : { total: 0, items: [], badges: {} };
  const shellUsers = demoUsers.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    title: u.title,
  }));
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
          {children}
        </AppShell>
      </body>
    </html>
  );
}
