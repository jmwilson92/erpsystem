import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionReleaseMaterialRequisition } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MrsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mrs = await prisma.materialRequisition.findUnique({
    where: { id },
    include: {
      forecast: true,
      lines: {
        include: {
          part: true,
          workOrder: { select: { id: true, number: true, status: true } },
        },
        orderBy: [{ action: "asc" }, { id: "asc" }],
      },
      workOrders: {
        include: { part: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!mrs) notFound();

  const buildLines = mrs.lines.filter((l) => l.action === "BUILD");
  const buyLines = mrs.lines.filter((l) => l.action === "BUY");
  const stockLines = mrs.lines.filter((l) => l.action === "STOCK");
  const canRelease =
    ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(mrs.status) &&
    buildLines.some((l) => l.shortQty > 0 && !l.workOrderId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={mrs.number}
        description={mrs.name || "Material requisition sheet"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/planning">
              <Button size="sm" variant="outline">
                Planning
              </Button>
            </Link>
            {mrs.forecast && (
              <Link href={`/planning/forecasts/${mrs.forecast.id}`}>
                <Button size="sm" variant="outline">
                  Forecast {mrs.forecast.number}
                </Button>
              </Link>
            )}
            {canRelease && (
              <form action={actionReleaseMaterialRequisition}>
                <input
                  type="hidden"
                  name="materialRequisitionId"
                  value={mrs.id}
                />
                <Button type="submit" size="sm">
                  Release → create MWO work orders
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={mrs.status} />
        {mrs.forecast && (
          <span className="rounded border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-400">
            From {mrs.forecast.number}
          </span>
        )}
        <span className="text-xs text-slate-500">
          Created {formatDate(mrs.createdAt)}
          {mrs.releasedAt ? ` · Released ${formatDate(mrs.releasedAt)}` : ""}
        </span>
      </div>

      {mrs.notes && <p className="text-sm text-slate-400">{mrs.notes}</p>}

      <p className="text-xs text-slate-500">
        Stock-netted plan:{" "}
        <strong className="text-violet-300">BUILD</strong> lines become{" "}
        <span className="font-mono text-violet-400">MWO-#####</span> with this
        MRS number on the traveler.{" "}
        <strong className="text-amber-300">BUY</strong> lines are purchase
        demand. <strong className="text-emerald-300">STOCK</strong> is covered
        by on-hand.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>
            Requisition lines ({mrs.lines.length})
            <span className="ml-2 font-normal text-xs text-slate-500">
              BUILD {buildLines.length} · BUY {buyLines.length} · STOCK{" "}
              {stockLines.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">Part</th>
                <th className="pb-2">Action</th>
                <th className="pb-2 text-right">Required</th>
                <th className="pb-2 text-right">On hand</th>
                <th className="pb-2 text-right">Short</th>
                <th className="pb-2">Work order</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {mrs.lines.map((l) => (
                <tr
                  key={l.id}
                  className={`border-b border-slate-800/60 ${
                    l.action === "BUILD"
                      ? "bg-violet-500/5"
                      : l.action === "BUY"
                        ? "bg-amber-500/5"
                        : ""
                  }`}
                >
                  <td className="py-2">
                    <Link
                      href={`/items/${l.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {l.part.partNumber}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      {l.part.description}
                    </p>
                  </td>
                  <td className="py-2">
                    <StatusBadge status={l.action} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {l.requiredQty}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {l.onHandQty}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      l.shortQty > 0 ? "text-amber-400" : "text-slate-600"
                    }`}
                  >
                    {l.shortQty}
                  </td>
                  <td className="py-2">
                    {l.workOrder ? (
                      <Link
                        href={`/work-orders/${l.workOrder.id}`}
                        className="font-mono text-violet-400 hover:underline"
                      >
                        {l.workOrder.number}
                      </Link>
                    ) : l.action === "BUILD" && l.shortQty > 0 ? (
                      <span className="text-[11px] text-slate-600">
                        Pending release
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 text-[11px] text-slate-500 max-w-[200px]">
                    {l.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Linked work orders ({mrs.workOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {mrs.workOrders.length === 0 && (
            <p className="text-sm text-slate-500">
              No MWOs yet. Release this sheet to create them.
            </p>
          )}
          {mrs.workOrders.map((wo) => (
            <Link
              key={wo.id}
              href={`/work-orders/${wo.id}`}
              className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-violet-500/30"
            >
              <div>
                <span className="font-mono text-violet-400">{wo.number}</span>
                <StatusBadge status={wo.status} className="ml-2" />
                <StatusBadge status={wo.sourceType} className="ml-1" />
                <p className="text-xs text-slate-400">
                  {wo.part?.partNumber} · qty {wo.quantity}
                </p>
              </div>
              <span className="text-[11px] text-slate-600">
                MRS {mrs.number}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
