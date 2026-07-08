import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { scoreRatingColor } from "@/lib/utils";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { overallScore: "desc" },
    include: {
      _count: { select: { purchaseOrders: true, ncrs: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Management"
        description="Live scorecards from OTD, quality PPM (NCR/MRB), and cost variance"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((s) => (
          <Link key={s.id} href={`/suppliers/${s.id}`}>
            <Card className="h-full transition-colors hover:border-teal-500/30">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-mono text-slate-500">{s.code}</p>
                    <p className="font-semibold text-slate-100">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.category}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-3xl font-bold", scoreRatingColor(s.rating))}>
                      {s.rating}
                    </p>
                    <p className="text-xs text-slate-500">{s.overallScore}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-900/80 p-2">
                    <p className="text-lg font-semibold tabular-nums text-teal-400">
                      {s.onTimeDeliveryPct}%
                    </p>
                    <p className="text-[10px] text-slate-500">OTD</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 p-2">
                    <p className="text-lg font-semibold tabular-nums text-amber-400">
                      {Math.round(s.qualityPpm)}
                    </p>
                    <p className="text-[10px] text-slate-500">PPM</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 p-2">
                    <p className="text-lg font-semibold tabular-nums text-sky-400">
                      {s.costVariancePct}%
                    </p>
                    <p className="text-[10px] text-slate-500">Cost Δ</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <StatusBadge status={s.status} />
                  <span>
                    {s._count.purchaseOrders} POs · {s._count.ncrs} NCRs
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
