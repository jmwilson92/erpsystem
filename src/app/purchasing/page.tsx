import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionReceivePo,
  actionApprovePr,
  actionConvertPrToPo,
} from "@/app/actions";
import Link from "next/link";
import { ShoppingCart, FileInput, PackageCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const [prs, pos, spendBySupplier] = await Promise.all([
    prisma.purchaseRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { supplier: true, lines: true },
    }),
    prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        supplier: true,
        lines: { include: { part: true } },
        receipts: true,
      },
    }),
    prisma.purchaseOrder.groupBy({
      by: ["supplierId"],
      _sum: { totalAmount: true },
      _count: true,
    }),
  ]);

  const suppliers = await prisma.supplier.findMany();
  const supMap = Object.fromEntries(suppliers.map((s) => [s.id, s]));

  const openPos = pos.filter((p) =>
    ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"].includes(p.status)
  );
  const openCommitments = openPos.reduce((s, p) => s + p.totalAmount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchasing & Procurement"
        description="PR approval → PO lifecycle → Receipt → Inspection/MRB integration"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Open POs"
          value={openPos.length}
          icon={ShoppingCart}
          accent="teal"
        />
        <StatCard
          title="Open Commitments"
          value={formatCurrency(openCommitments)}
          icon={FileInput}
          accent="sky"
        />
        <StatCard
          title="Purchase Requests"
          value={prs.filter((p) => ["SUBMITTED", "APPROVED"].includes(p.status)).length}
          subtitle="Awaiting action"
          icon={PackageCheck}
          accent="amber"
        />
      </div>

      <Tabs defaultValue="pos">
        <TabsList>
          <TabsTrigger value="pos">Purchase Orders</TabsTrigger>
          <TabsTrigger value="prs">Purchase Requests</TabsTrigger>
          <TabsTrigger value="spend">Spend by Supplier</TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="space-y-3">
          {pos.map((po) => (
            <Card key={po.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/purchasing/po/${po.id}`}
                        className="font-mono text-base font-semibold text-teal-400 hover:underline"
                      >
                        {po.number}
                      </Link>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-sm text-slate-300">{po.supplier.name}</p>
                    <p className="text-xs text-slate-500">
                      Ordered {formatDate(po.orderDate)} · Promised{" "}
                      {formatDate(po.promisedDate)} · {po.lines.length} line(s)
                    </p>
                    <ul className="mt-1 text-xs text-slate-500">
                      {po.lines.map((l) => (
                        <li key={l.id}>
                          {l.part?.partNumber || l.description}: {l.quantityReceived}/
                          {l.quantity} @ {formatCurrency(l.unitCost)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="text-lg font-semibold tabular-nums text-slate-100">
                      {formatCurrency(po.totalAmount)}
                    </p>
                    {["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"].includes(po.status) && (
                      <div className="flex flex-wrap gap-2">
                        <form action={actionReceivePo}>
                          <input type="hidden" name="purchaseOrderId" value={po.id} />
                          <input type="hidden" name="failInspection" value="false" />
                          <Button type="submit" size="sm">
                            Receive (Pass QA)
                          </Button>
                        </form>
                        <form action={actionReceivePo}>
                          <input type="hidden" name="purchaseOrderId" value={po.id} />
                          <input type="hidden" name="failInspection" value="true" />
                          <Button type="submit" size="sm" variant="amber">
                            Receive (Fail → MRB)
                          </Button>
                        </form>
                      </div>
                    )}
                    {po.receipts.length > 0 && (
                      <p className="text-xs text-slate-500">
                        {po.receipts.length} receipt(s)
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="prs" className="space-y-3">
          {prs.map((pr) => (
            <Card key={pr.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-sky-400">{pr.number}</span>
                    <StatusBadge status={pr.status} />
                  </div>
                  <p className="text-sm text-slate-300">{pr.justification}</p>
                  <p className="text-xs text-slate-500">
                    {pr.department} · Need by {formatDate(pr.neededBy)} ·{" "}
                    {pr.supplier?.name || "No supplier"} · Est.{" "}
                    {formatCurrency(pr.totalEstimate)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {pr.status === "SUBMITTED" && (
                    <form action={actionApprovePr}>
                      <input type="hidden" name="id" value={pr.id} />
                      <Button type="submit" size="sm">
                        Approve
                      </Button>
                    </form>
                  )}
                  {pr.status === "APPROVED" && pr.supplierId && (
                    <form action={actionConvertPrToPo}>
                      <input type="hidden" name="id" value={pr.id} />
                      <Button type="submit" size="sm">
                        Convert to PO
                      </Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="spend">
          <Card>
            <CardHeader>
              <CardTitle>PO Spend by Supplier</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {spendBySupplier.map((row) => {
                  const s = supMap[row.supplierId];
                  return (
                    <div
                      key={row.supplierId}
                      className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-slate-200">{s?.name || row.supplierId}</p>
                        <p className="text-xs text-slate-500">
                          {row._count} PO(s) · Rating {s?.rating}
                        </p>
                      </div>
                      <p className="text-lg font-semibold tabular-nums text-teal-400">
                        {formatCurrency(row._sum.totalAmount || 0)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
