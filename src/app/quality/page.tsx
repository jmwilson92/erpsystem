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

export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const [ncrs, inspections, mrbCount] = await Promise.all([
    prisma.nonConformance.findMany({
      orderBy: { createdAt: "desc" },
      include: { part: true, supplier: true, workOrder: true, mrbCases: true },
    }),
    prisma.inspection.findMany({
      orderBy: { createdAt: "desc" },
      include: { results: true, workOrder: true },
      take: 30,
    }),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
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
    passed + failed > 0 ? Math.round((passed / (passed + failed)) * 1000) / 10 : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality Management"
        description="Receiving, in-process, final inspection · NCR · yield metrics"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Open NCRs" value={ncrs.filter((n) => !["CLOSED", "DISPOSITIONED"].includes(n.status)).length} icon={AlertTriangle} accent="amber" />
        <StatCard title="Inspection Yield" value={`${yieldPct}%`} subtitle={`${failed} failed of ${passed + failed}`} icon={ClipboardCheck} accent="emerald" />
        <StatCard title="Open MRB" value={mrbCount} icon={FlaskConical} accent="red" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NCR by Source</CardTitle>
        </CardHeader>
        <CardContent>
          <QualityCharts
            data={Object.entries(bySource).map(([name, value]) => ({ name, value }))}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="ncrs">
        <TabsList>
          <TabsTrigger value="ncrs">Non-Conformances</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
        </TabsList>

        <TabsContent value="ncrs" className="space-y-2">
          {ncrs.map((ncr) => (
            <Card key={ncr.id}>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-amber-400">{ncr.number}</span>
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
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-sky-400">{insp.number}</span>
                    <StatusBadge status={insp.type} />
                    <StatusBadge status={insp.status} />
                  </div>
                  <span className="text-xs text-slate-500">
                    Pass {insp.quantityPassed} / Fail {insp.quantityFailed} ·{" "}
                    {formatDate(insp.completedAt || insp.createdAt)}
                  </span>
                </div>
                {insp.results.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {insp.results.map((r) => (
                      <span
                        key={r.id}
                        className={`rounded border px-2 py-0.5 text-[11px] ${
                          r.result === "PASS"
                            ? "border-emerald-500/30 text-emerald-400"
                            : r.result === "FAIL"
                              ? "border-red-500/30 text-red-400"
                              : "border-slate-700 text-slate-400"
                        }`}
                      >
                        {r.characteristic}: {r.result}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
