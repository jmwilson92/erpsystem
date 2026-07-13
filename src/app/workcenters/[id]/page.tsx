import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WORK_AREA_LABELS } from "@/lib/work-areas";
import { formatDate } from "@/lib/utils";
import { Factory, ClipboardList, Users2, Gauge } from "lucide-react";

export const dynamic = "force-dynamic";

const ACTIVE = ["RELEASED", "IN_PROGRESS", "ON_HOLD"];

export default async function WorkCenterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wc = await prisma.workCenter.findUnique({
    where: { id },
    include: {
      staff: { include: { user: { select: { name: true, title: true } } } },
    },
  });
  if (!wc) notFound();

  const [activeWos, recentDone, statusHistory] = await Promise.all([
    prisma.workOrder.findMany({
      where: { workCenter: wc.code, status: { in: ACTIVE } },
      include: { part: { select: { partNumber: true } }, assignee: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.workOrder.count({
      where: { workCenter: wc.code, status: { in: ["COMPLETE", "CLOSED"] } },
    }),
    prisma.workOrderStatusHistory.findMany({
      where: { workOrder: { workCenter: wc.code } },
      include: { workOrder: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const effectiveCapacity = wc.capacityHoursPerDay * wc.efficiency;
  const inProgress = activeWos.filter((w) => w.status === "IN_PROGRESS").length;
  const onHold = activeWos.filter((w) => w.status === "ON_HOLD").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${wc.code} — ${wc.name}`}
        description={`${(WORK_AREA_LABELS as Record<string, string>)[wc.area] || wc.area}${wc.department ? ` · ${wc.department}` : ""}`}
        actions={
          <Link href="/workcenters">
            <Button size="sm" variant="outline">
              All workcenters
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wc.area} />
        {!wc.isActive && <StatusBadge status="INACTIVE" />}
        {wc.isDefault && <StatusBadge status="DEFAULT" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Active WOs" value={activeWos.length} icon={Factory} accent="teal" />
        <StatCard title="In progress" value={inProgress} subtitle={`${onHold} on hold`} icon={ClipboardList} accent={inProgress > 0 ? "sky" : "emerald"} />
        <StatCard
          title="Effective capacity"
          value={`${Math.round(effectiveCapacity)}h/d`}
          subtitle={`${wc.capacityHoursPerDay}h × ${Math.round(wc.efficiency * 100)}% eff`}
          icon={Gauge}
          accent="violet"
        />
        <StatCard title="Completed here" value={recentDone} subtitle="Lifetime WOs" icon={ClipboardList} accent="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live queue</CardTitle>
            <p className="text-xs text-slate-500">
              Work orders currently routed to this station.
            </p>
          </CardHeader>
          <CardContent className="space-y-1">
            {activeWos.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-500">
                Station idle — no active work orders.
              </p>
            )}
            {activeWos.map((w) => (
              <Link
                key={w.id}
                href={`/work-orders/${w.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-teal-400">{w.number}</span>
                  <span className="text-slate-400">
                    {w.part?.partNumber || w.type}
                  </span>
                  {w.assignee && (
                    <span className="text-xs text-slate-600">
                      · {w.assignee.name}
                    </span>
                  )}
                </span>
                <StatusBadge status={w.status} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users2 className="h-4 w-4 text-slate-500" />
              Staff
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {wc.staff.length === 0 && (
              <p className="text-sm text-slate-500">No staff assigned.</p>
            )}
            {wc.staff.map((s) => (
              <div key={s.id} className="border-b border-slate-900 py-1.5 text-sm">
                <span className="text-slate-200">{s.user.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {s.user.title || ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent status activity</CardTitle>
        </CardHeader>
        <CardContent>
          {statusHistory.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500">
              No recent activity.
            </p>
          ) : (
            <ol className="relative ml-1.5 space-y-0 border-l border-slate-800">
              {statusHistory.map((h) => (
                <li key={h.id} className="relative pb-2.5 pl-4 last:pb-0">
                  <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border border-slate-600 bg-slate-900" />
                  <p className="text-sm text-slate-300">
                    <span className="font-mono text-teal-400">
                      {h.workOrder.number}
                    </span>{" "}
                    {h.fromStatus ? `${h.fromStatus} → ` : ""}
                    <span className="text-slate-200">{h.toStatus}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {formatDate(h.createdAt)}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
