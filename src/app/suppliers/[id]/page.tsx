import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, scoreRatingColor, cn } from "@/lib/utils";
import { actionRefreshScorecard } from "@/app/actions";
import { SupplierTrendChart } from "@/components/suppliers/trend-chart";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      scorecardHistory: { orderBy: { period: "asc" } },
      purchaseOrders: {
        orderBy: { orderDate: "desc" },
        take: 10,
        include: { lines: true },
      },
      ncrs: { orderBy: { createdAt: "desc" }, take: 10, include: { mrbCases: true } },
    },
  });
  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={`${supplier.code} · ${supplier.category || "General"} · ${supplier.contactEmail || ""}`}
        actions={
          <form action={actionRefreshScorecard}>
            <input type="hidden" name="supplierId" value={supplier.id} />
            <Button type="submit" size="sm" variant="outline">
              Recalculate Scorecard
            </Button>
          </form>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className={cn("text-5xl font-bold", scoreRatingColor(supplier.rating))}>
          {supplier.rating}
        </div>
        <div>
          <p className="text-2xl font-semibold text-slate-100">{supplier.overallScore}</p>
          <p className="text-xs text-slate-500">Overall score</p>
        </div>
        <StatusBadge status={supplier.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-400">{supplier.onTimeDeliveryPct}%</p>
            <p className="text-xs text-slate-500">On-Time Delivery</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">{Math.round(supplier.qualityPpm)}</p>
            <p className="text-xs text-slate-500">Quality PPM</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-sky-400">{supplier.costVariancePct}%</p>
            <p className="text-xs text-slate-500">Cost Variance</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scorecard Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierTrendChart
            data={supplier.scorecardHistory.map((h) => ({
              period: h.period,
              score: h.overallScore,
              otd: h.onTimeDeliveryPct,
              ppm: h.qualityPpm,
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supplier.purchaseOrders.map((po) => (
              <Link
                key={po.id}
                href={`/purchasing/po/${po.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
              >
                <div>
                  <span className="font-mono text-teal-400">{po.number}</span>
                  <span className="ml-2 text-slate-500">{formatDate(po.orderDate)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(po.totalAmount)}</span>
                  <StatusBadge status={po.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NCRs / Quality Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supplier.ncrs.length === 0 && (
              <p className="text-sm text-slate-500">No NCRs — strong quality performance</p>
            )}
            {supplier.ncrs.map((ncr) => (
              <div
                key={ncr.id}
                className="rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-amber-400">{ncr.number}</span>
                  <StatusBadge status={ncr.status} />
                  {ncr.mrbCases[0] && (
                    <Link href="/mrb" className="text-xs text-teal-400">
                      {ncr.mrbCases[0].number}
                    </Link>
                  )}
                </div>
                <p className="text-slate-400">{ncr.title}</p>
              </div>
            ))}
            {supplier.rating === "C" || supplier.rating === "D" || supplier.rating === "F" ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                Performance below threshold — consider issuing a Corrective Action Request
                from the next MRB disposition or purchasing review.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
