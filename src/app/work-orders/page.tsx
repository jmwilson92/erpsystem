import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";
import {
  actionCreateTaskWo,
  actionCreateProductionWo,
} from "@/app/actions";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage() {
  const [workOrders, certifiedBoms, projects] = await Promise.all([
    prisma.workOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        part: true,
        bomHeader: true,
        assignee: true,
        project: true,
        stepCompletions: true,
        _count: { select: { instructions: true } },
      },
    }),
    prisma.bomHeader.findMany({
      where: { status: "CERTIFIED" },
      include: { part: true },
      orderBy: { revision: "desc" },
    }),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
    }),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Orders"
        description="Production (BOM) and task-only orders — WI sign-off uses PIN"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-teal-900/40">
          <CardHeader>
            <CardTitle className="text-base">Create production WO (BOM)</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionCreateProductionWo} className="space-y-3">
              <input type="hidden" name="type" value="PRODUCTION" />
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Certified BOM *
                </label>
                <select
                  name="bomHeaderId"
                  required
                  className={`${selectClass} mt-1`}
                >
                  <option value="">— Select BOM —</option>
                  {certifiedBoms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.part.partNumber} Rev {b.revision} —{" "}
                      {b.part.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Qty
                  </label>
                  <Input
                    name="quantity"
                    type="number"
                    defaultValue={1}
                    min={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Project
                  </label>
                  <select name="projectId" className={`${selectClass} mt-1`}>
                    <option value="">— Optional —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Create production WO
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create task-only WO</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionCreateTaskWo} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Description
                </label>
                <Input
                  name="description"
                  defaultValue="Daily 5S / Task WO"
                  className="mt-1"
                />
              </div>
              <p className="text-xs text-slate-600">
                No BOM / material kitting. Sign-off progress only if a general WI
                is attached.
              </p>
              <Button type="submit" size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />
                Task-only WO
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3">
        {workOrders.map((wo) => {
          const isTask = wo.type === "TASK_ONLY";
          const total = wo.stepCompletions.length;
          const done = wo.stepCompletions.filter((s) =>
            ["SIGNED", "PASSED", "SKIPPED"].includes(s.status)
          ).length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const std = wo.standardCost || 0;
          const act = wo.actualCost || 0;

          return (
            <Link key={wo.id} href={`/work-orders/${wo.id}`}>
              <Card className="transition-colors hover:border-teal-500/30">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-semibold text-teal-400">
                        {wo.number}
                      </span>
                      <StatusBadge status={wo.status} />
                      <StatusBadge status={wo.type} />
                      <StatusBadge status={wo.priority} />
                    </div>
                    <p className="text-sm text-slate-300">
                      {wo.description || wo.part?.description || "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {wo.part?.partNumber || "No part"}
                      {wo.bomHeader ? ` · BOM Rev ${wo.bomHeader.revision}` : ""}
                      {wo.project ? ` · ${wo.project.number}` : ""}
                      {` · ${wo.workCenter || "—"}`}
                      {` · ${wo.assignee?.name || "Unassigned"}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-6 text-right text-xs text-slate-500">
                    <div>
                      <p className="text-slate-400">Qty</p>
                      <p className="font-mono text-sm text-slate-200">
                        {wo.quantityCompleted}/{wo.quantity}
                      </p>
                    </div>
                    {!isTask && total > 0 && (
                      <div>
                        <p className="text-slate-400">WI sign-off</p>
                        <p className="font-mono text-sm text-slate-200">
                          {pct}%
                        </p>
                      </div>
                    )}
                    {!isTask && (
                      <div>
                        <p className="text-slate-400">Std cost</p>
                        <p className="font-mono text-sm text-slate-200">
                          {formatCurrency(std)}
                        </p>
                        {act > 0 && (
                          <p className="text-[10px] text-slate-600">
                            Act {formatCurrency(act)}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="hidden md:block">
                      <p className="text-slate-400">Due</p>
                      <p className="text-sm text-slate-200">
                        {formatDate(wo.plannedEnd)}
                      </p>
                    </div>
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
