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

export default async function ReceivingTravelerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id },
    include: {
      purchaseOrder: {
        include: {
          supplier: true,
          lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
          project: true,
          wbsElement: true,
          receipts: { orderBy: { receivedAt: "desc" }, include: { lines: true } },
        },
      },
    },
  });
  if (!traveler) notFound();

  const po = traveler.purchaseOrder;
  const canReceive =
    ["WAITING", "PARTIAL"].includes(traveler.status) &&
    ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"].includes(po.status) &&
    po.lines.some((l) => l.quantityReceived < l.quantity);

  return (
    <div className="space-y-6">
      <PageHeader
        title={traveler.number}
        description={`Receiving traveler for ${po.number} · ${po.supplier.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/receiving">
              <Button variant="outline" size="sm">
                All travelers
              </Button>
            </Link>
            <Link href={`/purchasing/po/${po.id}`}>
              <Button variant="secondary" size="sm">
                Open PO
              </Button>
            </Link>
            {canReceive && (
              <form action={actionReceivePo}>
                <input type="hidden" name="purchaseOrderId" value={po.id} />
                <input type="hidden" name="failInspection" value="false" />
                <Button type="submit" size="sm">
                  Receive remaining qty
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={traveler.status} />
        <StatusBadge status={po.status} />
        <span className="text-xs text-slate-500">
          EDD {formatDate(traveler.expectedDate || po.promisedDate)}
        </span>
      </div>

      <Card className="border-slate-700">
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-[10px] uppercase text-slate-500">PO</p>
              <Link href={`/purchasing/po/${po.id}`} className="font-mono text-teal-400">
                {po.number}
              </Link>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Vendor</p>
              <p className="text-slate-200">{po.supplier.name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Project / WBS</p>
              <p className="font-mono text-xs text-slate-300">
                {po.project?.number || "—"}
                {po.wbsElement ? ` / ${po.wbsElement.code}` : ""}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Amount</p>
              <p className="tabular-nums text-slate-200">{formatCurrency(po.totalAmount)}</p>
            </div>
          </div>

          {traveler.notes && (
            <p className="text-xs text-slate-500">{traveler.notes}</p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Part</th>
                <th className="pb-2 text-right">Ordered</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => {
                const open = Math.max(0, l.quantity - l.quantityReceived);
                return (
                  <tr key={l.id} className="border-b border-slate-800/60">
                    <td className="py-2 text-slate-500">{l.lineNumber}</td>
                    <td className="py-2">
                      <span className="font-mono text-teal-400">
                        {l.part?.partNumber || "—"}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">{l.description}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-400">
                      {l.quantityReceived}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        open > 0 ? "text-amber-400" : "text-slate-600"
                      }`}
                    >
                      {open}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {po.receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Receipt history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {po.receipts.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-teal-400">{r.number}</span>
                  <StatusBadge status={r.status} className="ml-2" />
                </div>
                <span className="text-xs text-slate-500">{formatDate(r.receivedAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
