"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Play, ArrowRight, GripVertical } from "lucide-react";
import { actionReorderWorkCenters } from "@/app/actions";

export type FlowStation = {
  code: string;
  name: string;
  area: string;
  wos: { id: string; number: string; status: string; pct: number }[];
};

const areaColor: Record<string, string> = {
  MANUFACTURING: "#14b8a6",
  ASSEMBLY: "#14b8a6",
  QA: "#f59e0b",
  TEST: "#0ea5e9",
  INSPECTION: "#f59e0b",
  PAINT: "#a78bfa",
  SHIPPING: "#38bdf8",
};

/**
 * Animated floor flow: work centers laid out left→right in routing order,
 * joined by thick arrows. A work-order token continuously glides along each
 * arrow (station → station), and "Replay flow" runs a one-shot wave that
 * lights each station in sequence to visualize product moving down the line.
 */
export function FloorFlow({
  stations: initial,
  canReorder = false,
}: {
  stations: FlowStation[];
  canReorder?: boolean;
}) {
  const router = useRouter();
  const [lit, setLit] = useState<number>(-1);
  const [stations, setStations] = useState(initial);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Keep local order in sync when server data refreshes.
  useEffect(() => {
    setStations(initial);
  }, [initial]);

  const onDrop = async (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      return;
    }
    const next = [...stations];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setStations(next);
    setDragIdx(null);
    // Persist the new order (real work centers only).
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("codes", JSON.stringify(next.map((s) => s.code)));
      await actionReorderWorkCenters(fd);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const replay = () => {
    clearTimers();
    setLit(-1);
    stations.forEach((_, i) => {
      timers.current.push(setTimeout(() => setLit(i), i * 550));
    });
    timers.current.push(
      setTimeout(() => setLit(-1), stations.length * 550 + 700)
    );
  };

  useEffect(() => () => clearTimers(), []);

  if (stations.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Floor flow</h2>
          <p className="text-[11px] text-slate-500">
            Work centers in routing order — product flows left to right
            {canReorder && (
              <span className="text-slate-600">
                {" · "}
                {saving ? "saving order…" : "drag the grip to reorder"}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={replay}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-teal-500/40 hover:text-teal-300"
        >
          <Play className="h-3.5 w-3.5" />
          Replay flow
        </button>
      </div>

      <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
        {stations.map((st, i) => {
          const color = areaColor[st.area] || "#64748b";
          const top = st.wos[0];
          return (
            <Fragment key={st.code}>
              {/* Station */}
              <div
                draggable={canReorder}
                onDragStart={() => canReorder && setDragIdx(i)}
                onDragOver={(e) => canReorder && e.preventDefault()}
                onDrop={() => canReorder && onDrop(i)}
                className={cn(
                  "w-44 shrink-0 rounded-xl border border-slate-800 bg-slate-950/60",
                  lit === i && "station-lit border-teal-500/60",
                  canReorder && "cursor-grab",
                  dragIdx === i && "opacity-50"
                )}
                style={{ borderTop: `3px solid ${color}` }}
              >
                <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-slate-100">
                      {st.code}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {st.name}
                    </p>
                  </div>
                  {canReorder && (
                    <GripVertical className="h-4 w-4 shrink-0 text-slate-600" />
                  )}
                </div>
                <div className="space-y-1 p-2">
                  {st.wos.length === 0 && (
                    <p className="py-2 text-center text-[10px] text-slate-600">
                      idle
                    </p>
                  )}
                  {st.wos.slice(0, 4).map((wo) => (
                    <Link
                      key={wo.id}
                      href={`/work-orders/${wo.id}`}
                      className="relative block overflow-hidden rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 transition-colors hover:border-teal-500/40"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-500/15"
                        style={{ width: `${wo.pct}%` }}
                        aria-hidden
                      />
                      <div className="relative flex items-center justify-between">
                        <span className="font-mono text-[10px] text-slate-200">
                          {wo.number}
                        </span>
                        <span className="text-[9px] tabular-nums text-emerald-300">
                          {wo.pct}%
                        </span>
                      </div>
                    </Link>
                  ))}
                  {st.wos.length > 4 && (
                    <p className="text-center text-[9px] text-slate-600">
                      +{st.wos.length - 4} more
                    </p>
                  )}
                </div>
              </div>

              {/* Arrow to next station */}
              {i < stations.length - 1 && (
                <div className="relative flex w-14 shrink-0 items-center">
                  <div className="relative h-2 w-full rounded-full bg-slate-800">
                    <div
                      className={cn(
                        "absolute inset-0 rounded-full text-teal-400",
                        top && "flow-track"
                      )}
                    />
                    {/* Gliding WO token */}
                    {top && (
                      <span
                        className="animate-glide absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-teal-500 px-1 text-[8px] font-semibold text-white shadow"
                        style={{ animationDelay: `${(i % 3) * 0.5}s` }}
                      >
                        {top.number.replace(/^.*-/, "")}
                      </span>
                    )}
                  </div>
                  <ArrowRight className="absolute -right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
