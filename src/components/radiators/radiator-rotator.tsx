"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RadiatorSlide, RadiatorMetric } from "@/lib/services/radiators";
import { cn } from "@/lib/utils";
import { Play, Pause, ChevronRight, Settings2 } from "lucide-react";

const toneText: Record<RadiatorMetric["tone"], string> = {
  teal: "text-teal-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
  emerald: "text-emerald-400",
  sky: "text-sky-400",
  violet: "text-violet-400",
  slate: "text-slate-200",
};

const STORAGE_KEY = "forge-radiator-disciplines";
const ROTATE_MS = 15_000;

export function RadiatorRotator({ slides }: { slides: RadiatorSlide[] }) {
  // Which discipline ids are included in the rotation (persisted).
  const [selected, setSelected] = useState<string[]>(() => slides.map((s) => s.id));
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [idx, setIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const start = useRef(Date.now());

  // Load persisted selection once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        const valid = ids.filter((id) => slides.some((s) => s.id === id));
        if (valid.length) setSelected(valid);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [slides]);

  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
      } catch {
        /* ignore */
      }
    }
  }, [selected, loaded]);

  const active = useMemo(
    () => slides.filter((s) => selected.includes(s.id)),
    [slides, selected]
  );

  const safeIdx = active.length ? idx % active.length : 0;
  const slide = active[safeIdx];

  // Rotation timer + progress tick.
  useEffect(() => {
    if (!playing || active.length <= 1) return;
    start.current = Date.now();
    setTick(0);
    const prog = setInterval(() => setTick(Date.now() - start.current), 100);
    const next = setInterval(() => {
      setIdx((i) => i + 1);
      start.current = Date.now();
      setTick(0);
    }, ROTATE_MS);
    return () => {
      clearInterval(prog);
      clearInterval(next);
    };
  }, [playing, active.length, safeIdx]);

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );

  if (!slide) {
    return (
      <div className="rounded-2xl border border-slate-800 p-10 text-center text-slate-500">
        No radiators selected.{" "}
        <button className="text-teal-400 underline" onClick={() => setSelected(slides.map((s) => s.id))}>
          Show all
        </button>
      </div>
    );
  }

  const progressPct = Math.min(100, (tick / ROTATE_MS) * 100);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {active.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setIdx(i);
                start.current = Date.now();
                setTick(0);
              }}
              className={cn(
                "h-2 rounded-full transition-all",
                i === safeIdx ? "w-8" : "w-2 opacity-40"
              )}
              style={{ background: s.accent }}
              aria-label={s.title}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-teal-500/40"
            title={playing ? "Pause rotation" : "Play rotation"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => {
              setIdx((i) => i + 1);
              start.current = Date.now();
              setTick(0);
            }}
            className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-teal-500/40"
            title="Next radiator"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowPicker((s) => !s)}
            className={cn(
              "rounded-lg border p-1.5 hover:border-teal-500/40",
              showPicker ? "border-teal-500/50 text-teal-300" : "border-slate-700 text-slate-300"
            )}
            title="Choose radiators"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Discipline picker */}
      {showPicker && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          {slides.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  on ? "text-white" : "border-slate-700 text-slate-500"
                )}
                style={on ? { background: s.accent, borderColor: s.accent } : undefined}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Active radiator slide */}
      <div
        className="relative overflow-hidden rounded-3xl border-2 bg-slate-950/60 p-8"
        style={{ borderColor: `${slide.accent}66` }}
      >
        {/* rotation progress bar */}
        {playing && active.length > 1 && (
          <div
            className="absolute left-0 top-0 h-1 transition-[width] duration-100 ease-linear"
            style={{ width: `${progressPct}%`, background: slide.accent }}
          />
        )}
        <div className="mb-6 flex items-center gap-3">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ background: slide.accent }}
          />
          <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-slate-100 md:text-3xl">
            {slide.title}
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {slide.metrics.map((m, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
                {m.label}
              </p>
              <p
                className={cn(
                  "mt-2 text-5xl font-bold tabular-nums radiator-text md:text-6xl",
                  toneText[m.tone]
                )}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
