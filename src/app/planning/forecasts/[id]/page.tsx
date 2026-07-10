import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionGenerateMrsFromForecast } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ForecastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const forecast = await prisma.forecast.findUnique({
    where: { id },
    include: {
      lines: {
        include: { part: true },
        orderBy: { id: "asc" },
      },
      materialRequisitions: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { lines: true, workOrders: true } } },
      },
    },
  });
  if (!forecast) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={forecast.number}
        description={forecast.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/planning">
              <Button size="sm" variant="outline">
                Planning
              </Button>
            </Link>
            <form action={actionGenerateMrsFromForecast}>
              <input type="hidden" name="forecastId" value={forecast.id} />
              <Button type="submit" size="sm">
                Generate material requisition
              </Button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={forecast.status} />
        <span className="text-xs text-slate-500">
          Period {formatDate(forecast.periodStart)} —{" "}
          {formatDate(forecast.periodEnd)}
        </span>
      </div>

      {forecast.notes && (
        <p className="text-sm text-slate-400">{forecast.notes}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Forecast lines</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">Part</th>
                <th className="pb-2">Sourcing</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2">Need by</th>
              </tr>
            </thead>
            <tbody>
              {forecast.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60">
                  <td className="py-2">
                    <Link
                      href={`/items/${l.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {l.part.partNumber}
                    </Link>
                    <p className="text-xs text-slate-500">{l.part.description}</p>
                  </td>
                  <td className="py-2">
                    <StatusBadge status={l.part.sourcingMethod} />
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {l.quantity}
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {formatDate(l.dueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Material requisitions from this forecast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {forecast.materialRequisitions.length === 0 && (
            <p className="text-sm text-slate-500">
              None yet. Generate an MRS to net stock and plan BUILD / BUY.
            </p>
          )}
          {forecast.materialRequisitions.map((m) => (
            <Link
              key={m.id}
              href={`/planning/mrs/${m.id}`}
              className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-teal-500/30"
            >
              <div>
                <span className="font-mono text-teal-400">{m.number}</span>
                <StatusBadge status={m.status} className="ml-2" />
                <p className="text-[11px] text-slate-500">
                  {m._count.lines} lines · {m._count.workOrders} WOs
                </p>
              </div>
              <span className="text-xs text-slate-600">
                {formatDate(m.createdAt)}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
