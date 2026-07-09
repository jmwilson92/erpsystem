import { getFloorBoardData } from "@/lib/services/work-orders";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, cn } from "@/lib/utils";
import Link from "next/link";
import { FloorAutoRefresh } from "@/components/floor/auto-refresh";
import { WorkcenterPanel } from "@/components/workcenters/workcenter-panel";

export const dynamic = "force-dynamic";

const statusBorder: Record<string, string> = {
  IN_PROGRESS: "border-l-teal-500",
  RELEASED: "border-l-sky-500",
  ON_HOLD: "border-l-amber-500",
  PLANNED: "border-l-slate-600",
  CRITICAL: "border-l-red-500",
};

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function FloorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "board";
  const data = await getFloorBoardData();
  const progressMap = Object.fromEntries(data.signOffProgress.map((s) => [s.id, s.pct]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Floor"
        description="Live visual management — work orders, capacity, WIP, and sign-off progress"
        actions={<FloorAutoRefresh />}
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <Link
          href="/floor"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab !== "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Board
        </Link>
        <Link
          href="/floor?tab=stations"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab === "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Workcenters &amp; scan
        </Link>
      </div>

      {tab === "stations" ? (
        <WorkcenterPanel area="MANUFACTURING" returnPath="/floor" />
      ) : (
        <>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "In Progress", value: data.counts.inProgress, color: "text-teal-400" },
          { label: "Released", value: data.counts.released, color: "text-sky-400" },
          { label: "On Hold", value: data.counts.onHold, color: "text-amber-400" },
          { label: "Planned", value: data.counts.planned, color: "text-slate-400" },
          {
            label: "WIP Value",
            value: formatCurrency(data.wipValue),
            color: "text-emerald-400",
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{k.label}</p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums", k.color)}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.byCenter.map((center) => {
          const util =
            center.capacity > 0
              ? Math.min(100, Math.round((center.loadHours / center.capacity) * 100))
              : 0;
          return (
            <Card key={center.center}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono text-teal-400">{center.center}</CardTitle>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      util > 90 ? "text-red-400" : util > 70 ? "text-amber-400" : "text-emerald-400"
                    )}
                  >
                    {util}% loaded
                  </span>
                </div>
                <Progress
                  value={util}
                  className="h-1.5"
                  indicatorClassName={
                    util > 90 ? "bg-red-500" : util > 70 ? "bg-amber-500" : "bg-teal-500"
                  }
                />
                <p className="text-[11px] text-slate-500">
                  ~{center.loadHours.toFixed(1)}h load / {center.capacity.toFixed(1)}h capacity
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {center.orders.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-600">No active work</p>
                )}
                {center.orders.map((wo) => {
                  const pct = progressMap[wo.id] || 0;
                  return (
                    <Link
                      key={wo.id}
                      href={`/work-orders/${wo.id}`}
                      className={cn(
                        "block rounded-lg border border-slate-800 border-l-4 bg-slate-900/40 p-3 transition-all hover:bg-slate-900 hover:shadow-md",
                        statusBorder[wo.status] || "border-l-slate-600",
                        wo.priority === "CRITICAL" && "ring-1 ring-red-500/40 animate-pulse-soft"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-sm font-semibold text-slate-100">
                            {wo.number}
                          </span>
                          <p className="text-xs text-slate-500">
                            {wo.part?.partNumber || wo.type.replace(/_/g, " ")}
                            {wo.quantity > 1 ? ` × ${wo.quantity}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{wo.assignee?.name || "Unassigned"}</span>
                        <span className="uppercase">{wo.priority}</span>
                      </div>
                      {wo.stepCompletions.length > 0 && (
                        <div className="mt-2">
                          <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                            <span>Sign-off</span>
                            <span>{pct}%</span>
                          </div>
                          <Progress value={pct} className="h-1" />
                        </div>
                      )}
                      {wo.project && (
                        <p className="mt-1.5 truncate text-[10px] text-violet-400/80">
                          {wo.project.number}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}
