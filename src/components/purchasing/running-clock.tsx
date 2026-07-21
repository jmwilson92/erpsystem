"use client";

import { useEffect, useState } from "react";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Live "on the clock" indicator: pulsing dot + ticking elapsed time since
 * `startedAt`. Renders nothing until mounted (avoids hydration mismatch).
 */
export function RunningClock({
  startedAt,
  label,
}: {
  startedAt: string | Date;
  label?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const start = new Date(startedAt).getTime();

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/50 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {label || "On the clock"}
      {now != null && (
        <span className="font-mono tabular-nums">{fmt(now - start)}</span>
      )}
    </span>
  );
}
