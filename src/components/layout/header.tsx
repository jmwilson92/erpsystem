"use client";

import { Bell, Search, Command, Moon, Sun, LogOut, User as UserIcon, HelpCircle } from "lucide-react";
import { startTourEvent } from "@/components/guides/guided-tour";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "./theme-provider";
import { BreakTimer, type BreakOption } from "./break-timer";
import { actionLogout } from "@/app/actions";
import type { ShellNotifications, DemoUser } from "./app-shell";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Header({
  onOpenCommand,
  notifications,
  breaks = [],
  currentUser,
}: {
  onOpenCommand?: () => void;
  notifications?: ShellNotifications;
  breaks?: BreakOption[];
  currentUser?: DemoUser | null;
}) {
  const [time, setTime] = useState<string>("");
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useTheme();
  const router = useRouter();

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!bellOpen) return;
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [bellOpen]);

  useEffect(() => {
    if (!userOpen) return;
    const close = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userOpen]);

  const total = notifications?.total ?? 0;
  const items = notifications?.items ?? [];

  return (
    // relative z-40: backdrop-blur creates a stacking context, and without an
    // explicit z-index the whole header (and its z-50 dropdowns — notifications,
    // breaks, account) could paint BEHIND page elements that carry their own
    // z-index (sticky table headers, kanban lanes). z-40 keeps the header above
    // all page content while staying below dialogs/overlays (z-50+).
    <header className="relative z-40 flex h-14 items-center justify-between border-b border-border bg-card/60 px-4 backdrop-blur-md">
      <button
        data-tour="global-search"
        onClick={onOpenCommand}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:border-slate-600 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search modules, WOs, POs, parts…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex">
          <Command className="h-3 w-3" />K
        </kbd>
      </button>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
          {time}
        </span>
        <BreakTimer breaks={breaks} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/guides")}
          onDoubleClick={() => window.dispatchEvent(startTourEvent("getting-started"))}
          title="Guides & interactive tours"
          aria-label="Guides"
          data-tour="help"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          title={theme === "dark" ? "Switch to Day Mode" : "Switch to Night Mode"}
          aria-label="Toggle day/night mode"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-amber-300" />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" />
          )}
        </Button>

        <div className="relative" ref={bellRef} data-tour="notifications">
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              total > 0 ? `${total} pending notifications` : "Notifications"
            }
            onClick={() => setBellOpen((o) => !o)}
          >
            <Bell className="h-4 w-4" />
            {total > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold tabular-nums text-white ring-2 ring-background">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </Button>
          {bellOpen && (
            <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Needs your attention
              </p>
              {items.length === 0 && (
                <p className="px-2 pb-2 text-sm text-slate-500">
                  All clear — nothing pending. 🎉
                </p>
              )}
              {items.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setBellOpen(false);
                    router.push(item.href);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-slate-300 hover:bg-teal-500/10 hover:text-teal-300"
                >
                  <span>{item.label}</span>
                  <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-rose-400 ring-1 ring-rose-500/30">
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={userRef} data-tour="account-menu">
          <button
            onClick={() => setUserOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-semibold text-teal-300 ring-2 ring-border transition hover:ring-teal-500/50"
            aria-label="Account menu"
            title={currentUser?.name || "Account"}
          >
            {currentUser?.name ? initials(currentUser.name) : <UserIcon className="h-4 w-4" />}
          </button>
          {userOpen && (
            <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
              <div className="border-b border-slate-800 px-3 py-2.5">
                <p className="truncate text-sm font-medium text-slate-100">
                  {currentUser?.name || "Signed in"}
                </p>
                {currentUser && (
                  <p className="truncate text-[11px] text-slate-500">
                    {currentUser.title || currentUser.role}
                  </p>
                )}
              </div>
              <Link
                href="/account"
                onClick={() => setUserOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-teal-500/10 hover:text-teal-300"
              >
                <UserIcon className="h-4 w-4" />
                My account
              </Link>
              <form action={actionLogout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
