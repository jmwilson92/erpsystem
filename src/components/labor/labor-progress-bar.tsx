import { cn } from "@/lib/utils";

export function LaborProgressBar({
  allocatedHours,
  clockedHours,
  percentComplete,
  overAllocated,
  compact = false,
  className,
}: {
  allocatedHours: number | null | undefined;
  clockedHours: number;
  percentComplete: number | null | undefined;
  overAllocated?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const pct = percentComplete;
  const over = overAllocated ?? (pct != null && pct > 100);
  const width = pct == null ? 0 : Math.min(100, pct);
  const label =
    allocatedHours == null || allocatedHours <= 0
      ? `${fmt(clockedHours)}h clocked · no allocation`
      : `${fmt(clockedHours)} / ${fmt(allocatedHours)}h · ${pct}%`;

  return (
    <div className={cn("min-w-[7rem]", className)} title={label}>
      {!compact && (
        <div
          className={cn(
            "mb-0.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums",
            over ? "font-semibold text-red-400" : "text-slate-400"
          )}
        >
          <span>{label}</span>
          {over && <span className="uppercase tracking-wide">Over</span>}
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        {pct == null ? (
          <div className="h-full w-1/5 bg-slate-600/60" />
        ) : (
          <div
            className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-emerald-500")}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
      {compact && (
        <p
          className={cn(
            "mt-0.5 text-[10px] tabular-nums",
            over ? "font-semibold text-red-400" : "text-slate-500"
          )}
        >
          {pct == null ? "—" : `${pct}%`}
          {over ? " over" : ""}
        </p>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
