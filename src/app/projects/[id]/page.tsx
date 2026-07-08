import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { computeEvm, formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      wbsElements: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: { startDate: "asc" } },
      milestones: { orderBy: { dueDate: "asc" } },
      risks: true,
      issues: true,
      workOrders: { include: { part: true } },
      members: { include: { user: true } },
    },
  });
  if (!project) notFound();

  const { spi, cpi, cv, sv } = computeEvm(
    project.plannedValue,
    project.earnedValue,
    project.actualCost
  );

  return (
    <div className="space-y-6">
      <PageHeader title={project.name} description={project.description || project.number} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "SPI", value: spi.toFixed(2), good: spi >= 1 },
          { label: "CPI", value: cpi.toFixed(2), good: cpi >= 1 },
          { label: "PV (BCWS)", value: formatCurrency(project.plannedValue) },
          { label: "EV (BCWP)", value: formatCurrency(project.earnedValue) },
          { label: "AC (ACWP)", value: formatCurrency(project.actualCost) },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4 text-center">
              <p
                className={`text-2xl font-bold tabular-nums ${
                  m.good === undefined
                    ? "text-slate-100"
                    : m.good
                      ? "text-emerald-400"
                      : "text-amber-400"
                }`}
              >
                {m.value}
              </p>
              <p className="text-xs text-slate-500">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Schedule Variance (SV) {formatCurrency(sv)} · Cost Variance (CV){" "}
        {formatCurrency(cv)} · Contract {formatCurrency(project.contractValue)}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>WBS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.wbsElements.map((w) => (
              <div key={w.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-mono text-teal-400">{w.code}</span>
                  <span className="text-slate-300">{w.name}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatCurrency(w.actualCost)} / {formatCurrency(w.budgetCost)}
                  </span>
                </div>
                <Progress value={w.percentComplete} className="mt-1 h-1" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.milestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="text-slate-200">{m.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{formatDate(m.dueDate)}</span>
                  <StatusBadge status={m.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tasks (Gantt-style list)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {project.tasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-800 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={t.status} />
                    <span className="text-sm text-slate-200">{t.name}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDate(t.startDate)} → {formatDate(t.endDate)} ·{" "}
                    {t.actualHours}/{t.estimatedHours || "?"}h
                  </span>
                </div>
                <Progress value={t.percentComplete} className="mt-2 h-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Risk Register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.risks.map((r) => (
              <div key={r.id} className="rounded border border-slate-800 p-2 text-sm">
                <div className="flex gap-2">
                  <StatusBadge status={r.status} />
                  <StatusBadge status={r.impact} />
                </div>
                <p className="mt-1 text-slate-200">{r.title}</p>
                {r.mitigation && (
                  <p className="text-xs text-slate-500">{r.mitigation}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Issues / Blockers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.issues.map((i) => (
              <div key={i.id} className="rounded border border-slate-800 p-2 text-sm">
                <div className="flex gap-2">
                  <StatusBadge status={i.status} />
                  <StatusBadge status={i.priority} />
                </div>
                <p className="mt-1 text-slate-200">{i.title}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Linked Work Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.workOrders.map((wo) => (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex items-center justify-between text-sm hover:text-teal-400"
              >
                <span className="font-mono">{wo.number}</span>
                <StatusBadge status={wo.status} />
              </Link>
            ))}
            {project.members.length > 0 && (
              <div className="mt-4 border-t border-slate-800 pt-3">
                <p className="mb-1 text-xs text-slate-500">Team</p>
                {project.members.map((m) => (
                  <p key={m.id} className="text-xs text-slate-400">
                    {m.user.name} · {m.role}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
