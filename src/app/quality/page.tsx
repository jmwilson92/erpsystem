import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import { FlaskConical, ClipboardCheck, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { QualityCharts } from "@/components/quality/charts";
import { Button } from "@/components/ui/button";
import { getQaInspectionQueue } from "@/lib/services/test-center";
import { listWorkCenterCodesByArea } from "@/lib/services/workcenters";

export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const testCodes = await listWorkCenterCodesByArea("TEST");
  const [ncrs, inspections, mrbCount, openTestCount, qaQueue] =
    await Promise.all([
      prisma.nonConformance.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          part: true,
          supplier: true,
          workOrder: true,
          mrbCases: true,
        },
      }),
      prisma.inspection.findMany({
        orderBy: { createdAt: "desc" },
        include: { results: true, workOrder: true },
        take: 30,
      }),
      prisma.mrbCase.count({
        where: { status: { in: ["OPEN", "IN_REVIEW"] } },
      }),
      prisma.inspection.count({
        where: {
          type: "FUNCTIONAL",
          status: { in: ["PENDING", "IN_PROGRESS"] },
          workCenter: { in: testCodes.length ? testCodes : ["TEST-01"] },
        },
      }),
      getQaInspectionQueue(),
    ]);

  const bySource = ncrs.reduce(
    (acc, n) => {
      acc[n.source] = (acc[n.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const passed = inspections.filter((i) => i.status === "PASSED").length;
  const failed = inspections.filter((i) => i.status === "FAILED").length;
  const yieldPct =
    passed + failed > 0
      ? Math.round((passed / (passed + failed)) * 1000) / 10
      : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality / NCR"
        description="Non-conformances, yield metrics, inspection history — live QA queue is under QA"
        actions={
          <div className="flex gap-2">
            <Link href="/qa">
              <Button size="sm">QA module</Button>
            </Link>
            <Link href="/mrb">
              <Button size="sm" variant="outline">
                MRB
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Open NCRs"
          value={
            ncrs.filter((n) => !["CLOSED", "DISPOSITIONED"].includes(n.status))
              .length
          }
          icon={AlertTriangle}
          accent="amber"
        />
        <StatCard
          title="Inspection Yield"
          value={`${yieldPct}%`}
          subtitle={`${failed} failed of ${passed + failed}`}
          icon={ClipboardCheck}
          accent="emerald"
        />
        <StatCard
          title="Open MRB"
          value={mrbCount}
          icon={FlaskConical}
          accent="red"
        />
        <StatCard
          title="QA queue"
          value={qaQueue.stats.total}
          subtitle="Open → QA module"
          icon={ClipboardCheck}
          accent="sky"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {qaQueue.stats.total > 0 && (
          <Card className="flex-1 border-sky-900/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-slate-300">
                <span className="font-medium text-sky-300">
                  {qaQueue.stats.total}
                </span>{" "}
                open at QA stations (visual / GD&amp;T / continuity)
              </p>
              <Link href="/qa">
                <Button size="sm">Open QA</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {openTestCount > 0 && (
          <Card className="flex-1 border-violet-900/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-slate-300">
                <span className="font-medium text-violet-300">
                  {openTestCount}
                </span>{" "}
                functional at Test Center
              </p>
              <Link href="/test-center">
                <Button size="sm">Test Center</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NCR by Source</CardTitle>
        </CardHeader>
        <CardContent>
          <QualityCharts
            data={Object.entries(bySource).map(([name, value]) => ({
              name,
              value,
            }))}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="ncrs">
        <TabsList>
          <TabsTrigger value="ncrs">Non-Conformances</TabsTrigger>
          <TabsTrigger value="inspections">Inspection history</TabsTrigger>
        </TabsList>

        <TabsContent value="ncrs" className="space-y-2">
          {ncrs.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No NCRs.
              </CardContent>
            </Card>
          )}
          {ncrs.map((ncr) => (
            <Card key={ncr.id}>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-amber-400">
                      {ncr.number}
                    </span>
                    <StatusBadge status={ncr.status} />
                    <StatusBadge status={ncr.severity} />
                    <StatusBadge status={ncr.source} />
                  </div>
                  <p className="text-sm text-slate-300">{ncr.title}</p>
                  <p className="text-xs text-slate-500">
                    {ncr.part?.partNumber || "—"} · Qty {ncr.quantity}
                    {ncr.supplier ? ` · ${ncr.supplier.name}` : ""}
                    {ncr.workOrder ? ` · ${ncr.workOrder.number}` : ""}
                    {` · ${formatDate(ncr.createdAt)}`}
                  </p>
                </div>
                {ncr.mrbCases[0] && (
                  <Link href="/mrb" className="text-xs text-teal-400">
                    {ncr.mrbCases[0].number} →
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="inspections" className="space-y-2">
          {inspections.map((insp) => (
            <Card key={insp.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-400">{insp.number}</span>
                  <StatusBadge status={insp.type} />
                  <StatusBadge status={insp.status} />
                  {insp.workCenter && (
                    <span className="font-mono text-[10px] text-slate-500">
                      {insp.workCenter}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-600">
                  {formatDate(insp.createdAt)}
                  {insp.workOrder ? ` · ${insp.workOrder.number}` : ""}
                </span>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
