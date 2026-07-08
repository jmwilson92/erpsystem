import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { actionCreateTaskWo } from "@/app/actions";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage() {
  const workOrders = await prisma.workOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      part: true,
      bomHeader: true,
      assignee: true,
      project: true,
      stepCompletions: true,
      _count: { select: { instructions: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Orders"
        description="Production, prototype, inspection, and task-only orders with WI sign-offs"
        actions={
          <form action={actionCreateTaskWo}>
            <input type="hidden" name="description" value="Daily 5S / Task WO" />
            <Button type="submit" size="sm">
              <Plus className="h-4 w-4" />
              Task-only WO
            </Button>
          </form>
        }
      />

      <div className="grid gap-3">
        {workOrders.map((wo) => {
          const total = wo.stepCompletions.length;
          const done = wo.stepCompletions.filter((s) =>
            ["SIGNED", "PASSED", "SKIPPED"].includes(s.status)
          ).length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;

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
                    <div>
                      <p className="text-slate-400">Sign-off</p>
                      <p className="font-mono text-sm text-slate-200">{pct}%</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Cost</p>
                      <p className="font-mono text-sm text-slate-200">
                        {formatCurrency(wo.actualCost || wo.standardCost)}
                      </p>
                    </div>
                    <div className="hidden md:block">
                      <p className="text-slate-400">Due</p>
                      <p className="text-sm text-slate-200">{formatDate(wo.plannedEnd)}</p>
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
