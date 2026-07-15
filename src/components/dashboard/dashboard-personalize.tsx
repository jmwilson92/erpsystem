"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, Check } from "lucide-react";

const STORAGE_KEY = "forge-dashboard-hidden";

export type DashSection = { id: string; label: string };

/**
 * Personalize which dashboard views show. Sections are marked in the page with
 * `data-dash="<id>"`; this control injects a stylesheet that hides the ones the
 * user has switched off (persisted to localStorage). Sections the user has no
 * permission for are never passed in, so they can't be shown at all.
 */
export function DashboardPersonalize({ sections }: { sections: DashSection[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHidden(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
      } catch {
        /* ignore */
      }
    }
  }, [hidden, loaded]);

  const css = useMemo(() => {
    const valid = new Set(sections.map((s) => s.id));
    const on = hidden.filter((id) => valid.has(id));
    if (!on.length) return "";
    return on.map((id) => `[data-dash="${id}"]`).join(",") + "{display:none!important}";
  }, [hidden, sections]);

  const toggle = (id: string) =>
    setHidden((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <>
      {/* Only inject once loaded so SSR markup isn't hidden before hydration */}
      {loaded && css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors",
            open
              ? "border-teal-500/50 text-teal-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Customize
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-xl">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                Show on dashboard
              </p>
              {sections.map((s) => {
                const on = !hidden.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-900"
                  >
                    {s.label}
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        on ? "border-teal-500 bg-teal-500/20" : "border-slate-700"
                      )}
                    >
                      {on && <Check className="h-3 w-3 text-teal-400" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
