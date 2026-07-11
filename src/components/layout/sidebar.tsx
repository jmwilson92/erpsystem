"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, activeNavHref } from "@/lib/navigation";
import { ChevronLeft, ChevronDown, Flame } from "lucide-react";
import { useEffect, useState } from "react";

const COLLAPSED_GROUPS_KEY = "forge-nav-collapsed-groups";

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      if (stored) setClosedGroups(JSON.parse(stored));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const toggleGroup = (label: string) => {
    setClosedGroups((prev) => {
      const next = prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label];
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  const activeHref = activeNavHref(pathname, searchParams);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-slate-800/80 bg-slate-950/95 transition-all duration-200",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-slate-800/80 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-900/40">
          <Flame className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-50">ForgeERP</span>
            <span className="text-[10px] uppercase tracking-widest text-teal-500/80">
              Manufacturing
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => {
          const groupClosed = !collapsed && closedGroups.includes(group.label);
          const groupHasActive = group.items.some((i) => i.href === activeHref);
          return (
            <div key={group.label} className="mb-3">
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className={cn(
                    "mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                    groupHasActive && groupClosed
                      ? "text-teal-500"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {group.label}
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      groupClosed && "-rotate-90"
                    )}
                  />
                </button>
              )}
              {!groupClosed && (
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-teal-500/10 text-teal-400 shadow-sm"
                              : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                          )}
                        >
                          <Icon className={cn("h-4 w-4 shrink-0", active && "text-teal-400")} />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-slate-800/80 p-3">
          <div className="rounded-lg bg-slate-900/80 p-2.5">
            <p className="text-xs font-medium text-slate-300">Demo Mode</p>
            <p className="text-[10px] text-slate-500">Alex Morgan · ADMIN</p>
          </div>
        </div>
      )}
    </aside>
  );
}
