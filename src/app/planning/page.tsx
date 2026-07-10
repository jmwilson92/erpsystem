import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { Plus, LineChart, ClipboardList, Factory } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const [forecasts, mrsList, mwoCount] = await Promise.all([
    prisma.forecast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { lines: true, materialRequisitions: true } },
      },
      take: 30,
    }),
    prisma.materialRequisition.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        forecast: { select: { number: true, name: true } },
        _count: { select: { lines: true, workOrders: true } },
      },
      take: 30,
    }),
    prisma.workOrder.count({ where: { sourceType: "MATERIAL_REQ" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning"
        description="Forecast demand → material requisition (stock-netted) → MWO work orders"
        actions={
          <Link href="/planning/forecasts/new">
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              New forecast
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          title="Forecasts"
          value={forecasts.length}
          icon={LineChart}
          accent="sky"
        />
        <StatCard
          title="Material req sheets"
          value={mrsList.length}
          icon={ClipboardList}
          accent="teal"
        />
        <StatCard
          title="MWO work orders"
          value={mwoCount}
          icon={Factory}
          accent="violet"
        />
      </div>

      <Card className="border-slate-800 bg-slate-950/40">
        <CardContent className="space-y-1 p-4 text-xs text-slate-400">
          <p className="font-medium text-slate-300">How it works</p>
          <p>
            1. Create a <strong className="text-slate-200">forecast</strong>{" "}
            (build-to-forecast demand by part).
          </p>
          <p>
            2. Generate a{" "}
            <strong className="text-slate-200">material requisition sheet (MRS)</strong>{" "}
            — nets stock, marks BUILD / BUY / STOCK.
          </p>
          <p>
            3. <strong className="text-slate-200">Release</strong> the MRS to
            create <span className="font-mono text-violet-400">MWO-#####</span>{" "}
            work orders that reference the MRS number.
          </p>
          <p className="pt-1 text-slate-500">
            Sales builds use{" "}
            <span className="font-mono text-sky-400">SWO-#####</span> · BOM
            production{" "}
            <span className="font-mono text-teal-400">BWO-#####</span> · MRS{" "}
            <span className="font-mono text-violet-400">MWO-#####</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Forecasts
            </h2>
            <Link href="/planning/forecasts/new">
              <Button size="sm" variant="outline">
                New
              </Button>
            </Link>
          </div>
          {forecasts.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No forecasts yet. Create one to plan build-to-forecast demand.
              </CardContent>
            </Card>
          )}
          {forecasts.map((f) => (
            <Link key={f.id} href={`/planning/forecasts/${f.id}`}>
              <Card className="mb-2 transition-colors hover:border-sky-500/30">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sky-400">{f.number}</span>
                      <StatusBadge status={f.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-slate-200">{f.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {f._count.lines} line(s) · {f._count.materialRequisitions}{" "}
                      MRS · {formatDate(f.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Material requisitions
          </h2>
          {mrsList.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No MRS yet. Generate one from a forecast.
              </CardContent>
            </Card>
          )}
          {mrsList.map((m) => (
            <Link key={m.id} href={`/planning/mrs/${m.id}`}>
              <Card className="mb-2 transition-colors hover:border-teal-500/30">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-teal-400">{m.number}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-slate-200">
                      {m.name || "Material requisition"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {m.forecast ? (
                        <>
                          From {m.forecast.number} ·{" "}
                        </>
                      ) : null}
                      {m._count.lines} line(s) · {m._count.workOrders} WO(s) ·{" "}
                      {formatDate(m.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
