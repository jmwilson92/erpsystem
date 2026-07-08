import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionReceivePo } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { part: true } },
      receipts: { include: { lines: true } },
      inspections: true,
      purchaseRequest: true,
    },
  });
  if (!po) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={po.number}
        description={`${po.supplier.name} · ${formatCurrency(po.totalAmount)}`}
        actions={
          ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"].includes(po.status) ? (
            <div className="flex gap-2">
              <form action={actionReceivePo}>
                <input type="hidden" name="purchaseOrderId" value={po.id} />
                <input type="hidden" name="failInspection" value="false" />
                <Button type="submit" size="sm">Receive Pass</Button>
              </form>
              <form action={actionReceivePo}>
                <input type="hidden" name="purchaseOrderId" value={po.id} />
                <input type="hidden" name="failInspection" value="true" />
                <Button type="submit" size="sm" variant="amber">Receive Fail→MRB</Button>
              </form>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={po.status} />
        <Link href={`/suppliers/${po.supplierId}`} className="text-sm text-teal-400">
          {po.supplier.name} (Score {po.supplier.overallScore})
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Order / Promise</p>
            <p className="text-sm text-slate-200">
              {formatDate(po.orderDate)} / {formatDate(po.promisedDate)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Acknowledged</p>
            <p className="text-sm text-slate-200">{formatDate(po.acknowledgedAt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">From PR</p>
            <p className="text-sm text-slate-200">{po.purchaseRequest?.number || "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Part</th>
                <th className="pb-2 text-right">Ordered</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2 text-right">Unit Cost</th>
                <th className="pb-2 text-right">Ext</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-800">
                  <td className="py-2">{l.lineNumber}</td>
                  <td className="py-2">
                    <span className="text-slate-200">{l.part?.partNumber || "—"}</span>
                    <span className="ml-2 text-xs text-slate-500">{l.description}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-teal-400">
                    {l.quantityReceived}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(l.unitCost)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(l.quantity * l.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {po.receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {po.receipts.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-800 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-teal-400">{r.number}</span>
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-slate-500">{formatDate(r.receivedAt)}</span>
                </div>
                {r.notes && <p className="mt-1 text-xs text-amber-400">{r.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {po.inspections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Inspections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {po.inspections.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                <span className="font-mono text-sm text-slate-300">{i.number}</span>
                <StatusBadge status={i.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
