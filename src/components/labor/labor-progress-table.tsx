import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { LaborProgressBar } from "@/components/labor/labor-progress-bar";
import type { LaborRollup } from "@/lib/services/labor-progress";
import { formatCurrency } from "@/lib/utils";

export function LaborProgressTable({
  rollup,
  showCost = true,
}: {
  rollup: LaborRollup;
  showCost?: boolean;
}) {
  const overall = rollup.percentComplete;
  const over = overall != null && overall > 100;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Overall progress"
          value={overall == null ? "—" : `${overall}%`}
          hint={`${fmt(rollup.clockedHours)}h / ${fmt(rollup.allocatedHours)}h`}
          tone={over ? "danger" : "ok"}
        />
        <Stat
          label="Work orders"
          value={String(rollup.workOrderCount)}
          hint={`${rollup.overAllocatedCount} over allocated hours`}
          tone={rollup.overAllocatedCount > 0 ? "danger" : "muted"}
        />
        <Stat
          label="Remaining hours"
          value={fmt(rollup.remainingHours)}
          hint="Allocated minus clocked"
        />
        {showCost && (
          <Stat
            label="Labor cost vs budget"
            value={
              rollup.laborBudget != null
                ? `${formatCurrency(rollup.laborCost)} / ${formatCurrency(rollup.laborBudget)}`
                : rollup.laborCost
                  ? formatCurrency(rollup.laborCost)
                  : "—"
            }
            hint={
              rollup.laborCostVariance == null
                ? "No labor rates or budget on file"
                : rollup.laborCostVariance > 0
                  ? `${formatCurrency(rollup.laborCostVariance)} over budget`
                  : `${formatCurrency(Math.abs(rollup.laborCostVariance))} under budget`
            }
            tone={
              rollup.laborCostVariance != null && rollup.laborCostVariance > 0
                ? "danger"
                : "muted"
            }
          />
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Work order</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2 text-right">Allocated</th>
              <th className="px-3 py-2 text-right">Clocked</th>
              <th className="px-3 py-2">Progress</th>
              {showCost && <th className="px-3 py-2 text-right">Labor cost</th>}
            </tr>
          </thead>
          <tbody>
            {rollup.rows.length === 0 ? (
              <tr>
                <td colSpan={showCost ? 7 : 6} className="px-3 py-6 text-center text-slate-500">
                  No linked work orders.
                </td>
              </tr>
            ) : (
              rollup.rows.map((r) => (
                <tr key={r.workOrderId} className="border-t border-slate-800/80">
                  <td className="px-3 py-2">
                    <Link
                      href={`/work-orders/${r.workOrderId}`}
                      className="font-medium text-slate-200 hover:text-teal-300"
                    >
                      {r.number}
                    </Link>
                    {r.assigneeName && (
                      <p className="text-[11px] text-slate-500">{r.assigneeName}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.partNumber || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.allocatedHours == null ? "—" : fmt(r.allocatedHours)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.clockedHours)}</td>
                  <td className="px-3 py-2">
                    <LaborProgressBar
                      allocatedHours={r.allocatedHours}
                      clockedHours={r.clockedHours}
                      percentComplete={r.percentComplete}
                      overAllocated={r.overAllocated}
                    />
                  </td>
                  {showCost && (
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                      {r.laborCost ? formatCurrency(r.laborCost) : "—"}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "danger" | "muted";
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={
          tone === "danger"
            ? "text-lg font-semibold text-red-400"
            : tone === "ok"
              ? "text-lg font-semibold text-emerald-400"
              : "text-lg font-semibold text-slate-100"
        }
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
