import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BomPage() {
  const [boms, parts] = await Promise.all([
    prisma.bomHeader.findMany({
      orderBy: [{ partId: "asc" }, { revision: "desc" }],
      include: {
        part: true,
        lines: true,
        _count: { select: { workOrders: true } },
      },
    }),
    prisma.part.findMany({ orderBy: { partNumber: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill of Materials"
        description="Multi-level BOMs with revision control — Prototype → Certify → Production"
      />

      <div className="grid gap-3">
        {boms.map((bom) => (
          <Link key={bom.id} href={`/bom/${bom.id}`}>
            <Card
              className={`transition-colors hover:border-teal-500/30 ${
                bom.isPrototype || bom.status === "PROTOTYPE"
                  ? "border-amber-500/30"
                  : bom.status === "CERTIFIED"
                    ? "border-emerald-500/20"
                    : ""
              }`}
            >
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold text-slate-100">
                      {bom.part.partNumber}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-teal-400">
                      Rev {bom.revision}
                    </span>
                    <StatusBadge status={bom.status} />
                    {bom.isPrototype && <StatusBadge status="PROTOTYPE" />}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{bom.part.description}</p>
                  <p className="text-xs text-slate-500">
                    {bom.lines.length} components · {bom._count.workOrders} WO(s)
                    {bom.certifiedAt ? ` · Certified ${formatDate(bom.certifiedAt)}` : ""}
                    {bom.description ? ` · ${bom.description}` : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Part Master</h2>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Part #</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Rev</th>
                <th className="px-4 py-2 text-right">Std Cost</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} className="border-t border-slate-800/60">
                  <td className="px-4 py-2 font-mono text-teal-400">{p.partNumber}</td>
                  <td className="px-4 py-2 text-slate-300">{p.description}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={p.partType} />
                  </td>
                  <td className="px-4 py-2 text-slate-400">{p.revision}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-300">
                    ${p.standardCost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
