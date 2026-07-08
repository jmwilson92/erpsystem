import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { computeEvm, formatCurrency, formatPercent } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { workOrders: true, tasks: true, risks: true, issues: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects & Earned Value"
        description="WBS, SPI/CPI, risks, issues — linked to work orders and cost"
      />

      <div className="grid gap-4">
        {projects.map((p) => {
          const { spi, cpi, cv, sv } = computeEvm(
            p.plannedValue,
            p.earnedValue,
            p.actualCost
          );
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="transition-colors hover:border-teal-500/30">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-teal-400">{p.number}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      <h3 className="mt-1 text-lg font-semibold text-slate-100">{p.name}</h3>
                      <p className="text-xs text-slate-500">
                        {p.customerName || "Internal"} · {p._count.workOrders} WOs ·{" "}
                        {p._count.tasks} tasks · {p._count.risks} risks ·{" "}
                        {p._count.issues} issues
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="text-center">
                        <p
                          className={`text-2xl font-bold tabular-nums ${
                            spi >= 1 ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {spi.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500">SPI</p>
                      </div>
                      <div className="text-center">
                        <p
                          className={`text-2xl font-bold tabular-nums ${
                            cpi >= 1 ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {cpi.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500">CPI</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold tabular-nums text-slate-200">
                          {formatCurrency(p.actualCost)}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          AC / BAC {formatCurrency(p.budgetCost)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-200">
                          {formatPercent(p.percentComplete, 0)}
                        </p>
                        <p className="text-[10px] text-slate-500">Complete</p>
                      </div>
                    </div>
                  </div>
                  <Progress value={p.percentComplete} className="mt-4 h-1.5" />
                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span>
                      SV {formatCurrency(sv)} · CV {formatCurrency(cv)}
                    </span>
                    <span>
                      PV {formatCurrency(p.plannedValue)} · EV{" "}
                      {formatCurrency(p.earnedValue)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
