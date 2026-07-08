"use client";

import { Bell, Search, Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function Header({ onOpenCommand }: { onOpenCommand?: () => void }) {
  const [time, setTime] = useState<string>("");

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

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-4 backdrop-blur-md">
      <button
        onClick={onOpenCommand}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 text-sm text-slate-500 transition-colors hover:border-slate-700 hover:text-slate-400"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search modules, WOs, POs, parts…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 sm:inline-flex">
          <Command className="h-3 w-3" />K
        </kbd>
      </button>

      <div className="flex items-center gap-3">
        <span className="hidden text-xs tabular-nums text-slate-500 md:inline">{time}</span>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-slate-950" />
        </Button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-semibold text-teal-300 ring-2 ring-slate-800">
          AM
        </div>
      </div>
    </header>
  );
}
