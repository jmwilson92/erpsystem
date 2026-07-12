import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { workOrderHoldProvenance } from "@/lib/provenance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  actionCreateTaskWo,
  actionCreateProductionWo,
} from "@/app/actions";
import { Plus } from "lucide-react";
import Link from "next/link";
import { getCompanyDepartments } from "@/lib/services/company";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

const STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "BACKLOG", label: "Backlog" },
  { id: "PLANNED", label: "Planned" },
  { id: "RELEASED", label: "Released" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "COMPLETED", label: "Completed" },
  { id: "ON_HOLD", label: "On hold" },
] as const;

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = pick(sp, "status");

  const [workOrders, certifiedBoms, projects, departments] = await Promise.all([
    prisma.workOrder.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        part: true,
        bomHeader: true,
        assignee: true,
        project: true,
        salesOrder: { select: { id: true, number: true } },
        materialRequisition: { select: { id: true, number: true } },
        mrbCase: { select: { id: true, number: true } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        businessPriority: {
          select: { id: true, number: true, title: true, priority: true },
        },
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
    getCompanyDepartments(),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader title="Work Orders" />

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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Initial status
                  </label>
                  <select
                    name="status"
                    defaultValue="PLANNED"
                    className={`${selectClass} mt-1`}
                  >
                    <option value="BACKLOG">Backlog</option>
                    <option value="PLANNED">Planned</option>
                    <option value="RELEASED">Released</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Department (routes time approvals)
                  </label>
                  <select
                    name="department"
                    defaultValue={departments[0]}
                    className={`${selectClass} mt-1`}
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Initial status
                  </label>
                  <select
                    name="status"
                    defaultValue="BACKLOG"
                    className={`${selectClass} mt-1`}
                  >
                    <option value="BACKLOG">Backlog</option>
                    <option value="PLANNED">Planned</option>
                    <option value="RELEASED">Released</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Department
                  </label>
                  <select
                    name="department"
                    defaultValue={departments[0]}
                    className={`${selectClass} mt-1`}
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
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

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.id || "all"}
            href={f.id ? `/work-orders?status=${f.id}` : "/work-orders"}
            className={`rounded border px-3 py-1.5 text-sm ${
              statusFilter === f.id || (!statusFilter && !f.id)
                ? "border-teal-500/50 bg-teal-500/10 text-teal-200"
                : "border-slate-700 text-slate-400"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3">
        {workOrders.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No work orders match this filter.
            </CardContent>
          </Card>
        )}
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
                      <span
                        className={`font-mono text-base font-semibold ${
                          wo.number.startsWith("SWO")
                            ? "text-sky-400"
                            : wo.number.startsWith("MWO")
                              ? "text-violet-400"
                              : wo.number.startsWith("BWO")
                                ? "text-teal-400"
                                : "text-teal-400"
                        }`}
                      >
                        {wo.number}
                      </span>
                      <StatusBadge
                        status={wo.status}
                        {...workOrderHoldProvenance(wo)}
                      />
                      <StatusBadge status={wo.sourceType || wo.type} />
                      <StatusBadge status={wo.priority} />
                      <StatusBadge
                        status={
                          wo.businessPriority
                            ? wo.businessPriority.number
                            : "UNRATED"
                        }
                      />
                    </div>
                    <p className="text-sm text-slate-300">
                      {wo.description || wo.part?.description || "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {wo.part?.partNumber || "No part"}
                      {wo.bomHeader ? ` · BOM Rev ${wo.bomHeader.revision}` : ""}
                      {wo.salesOrder
                        ? ` · SO ${wo.salesOrder.number}`
                        : wo.materialRequisition
                          ? ` · MRS ${wo.materialRequisition.number}`
                          : wo.project
                            ? ` · ${wo.project.number}`
                            : ""}
                      {` · ${wo.workCenter || "—"}`}
                      {` · ${wo.assignee?.name || "Unassigned"}`}
                      {wo.businessPriority
                        ? ` · ${wo.businessPriority.title}`
                        : " · Unrated"}
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
