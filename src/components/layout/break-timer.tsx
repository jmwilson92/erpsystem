"use client";

import { Coffee } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type BreakOption = { name: string; minutes: number };

type ActiveBreak = { name: string; endsAt: number; minutes: number };

const STORAGE_KEY = "forge-active-break";

function readActive(): ActiveBreak | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as ActiveBreak;
    if (!b?.endsAt || b.endsAt < Date.now()) return null;
    return b;
  } catch {
    return null;
  }
}

/**
 * Company-configured break/lunch button in the header. Starting a break shows a
 * full-screen animated countdown that "stops work" (blocks the UI) until it
 * elapses or the person ends it early. Break state lives in localStorage so it
 * survives navigation between pages.
 */
export function BreakTimer({ breaks }: { breaks: BreakOption[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<ActiveBreak | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setActive(readActive());
  }, []);

  // Countdown tick
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const ms = active.endsAt - Date.now();
      if (ms <= 0) {
        localStorage.removeItem(STORAGE_KEY);
        setActive(null);
        setRemaining(0);
      } else {
        setRemaining(ms);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const start = useCallback((b: BreakOption) => {
    const rec: ActiveBreak = {
      name: b.name,
      minutes: b.minutes,
      endsAt: Date.now() + b.minutes * 60_000,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
    setActive(rec);
    setMenuOpen(false);
  }, []);

  const end = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setActive(null);
  }, []);

  if (!mounted || breaks.length === 0) return null;

  const totalMs = active ? active.minutes * 60_000 : 0;
  const pct = active && totalMs > 0 ? Math.max(0, remaining / totalMs) : 0;
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const overWarn = remaining > 0 && remaining < 60_000;

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-amber-300"
          title="Take a break"
        >
          <Coffee className="h-4 w-4" />
          <span className="hidden sm:inline">Break</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Clock out for…
            </p>
            {breaks.map((b) => (
              <button
                key={`${b.name}-${b.minutes}`}
                onClick={() => start(b)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-slate-300 hover:bg-amber-500/10 hover:text-amber-300"
              >
                <span>{b.name}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {b.minutes} min
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm">
          <div className="relative flex h-64 w-64 items-center justify-center">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-slate-800"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className={
                  overWarn
                    ? "text-rose-400 transition-[stroke-dashoffset] duration-300"
                    : "text-amber-400 transition-[stroke-dashoffset] duration-300"
                }
                strokeDasharray={2 * Math.PI * 45}
                strokeDashoffset={2 * Math.PI * 45 * (1 - pct)}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <Coffee
                className={`mb-1 h-6 w-6 ${overWarn ? "text-rose-300" : "text-amber-300"}`}
              />
              <span className="font-mono text-4xl font-bold tabular-nums text-white">
                {mm}:{String(ss).padStart(2, "0")}
              </span>
              <span className="mt-1 text-sm text-slate-400">{active.name}</span>
            </div>
          </div>
          <p className="mt-6 text-sm text-slate-400">
            On break — work is paused. Timer keeps running if you navigate away.
          </p>
          <button
            onClick={end}
            className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-teal-500/50 hover:text-teal-300"
          >
            {overWarn ? "Back to work" : "End break early"}
          </button>
        </div>
      )}
    </>
  );
}
