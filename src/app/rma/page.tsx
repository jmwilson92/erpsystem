import Link from "next/link";
import { listRmas } from "@/lib/services/rma";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function RmaListPage() {
  const rmas = await listRmas({ take: 80 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="RMA"
        description="Customer returns — warranty evaluation, repair quotes, repair work orders (no SO step)"
        actions={
          <Link href="/rma/new">
            <Button size="sm">New RMA request</Button>
          </Link>
        }
      />
      <Card className="border-slate-800">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">RMA</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Serial / Part</th>
                <th className="px-3 py-2 text-left">Coverage</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">WO / Quote</th>
              </tr>
            </thead>
            <tbody>
              {rmas.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-800/60 hover:bg-slate-900/40"
                >
                  <td className="px-3 py-2 font-mono text-teal-400">
                    <Link href={`/rma/${r.id}`} className="hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.customer.code} · {r.customer.name}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-amber-300">
                      {r.customerSn}
                    </span>
                    <p className="text-[11px] text-slate-500">
                      {r.topPart.partNumber}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.coverage} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {r.workOrders[0] && (
                      <Link
                        href={`/work-orders/${r.workOrders[0].id}`}
                        className="text-sky-400 hover:underline"
                      >
                        {r.workOrders[0].number}
                      </Link>
                    )}
                    {r.quote && (
                      <span className="ml-2">
                        /{" "}
                        <Link
                          href={`/sales/quotes/${r.quote.id}`}
                          className="text-violet-400 hover:underline"
                        >
                          {r.quote.number}
                        </Link>
                      </span>
                    )}
                    {!r.workOrders[0] && !r.quote && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rmas.length && (
            <p className="p-8 text-center text-sm text-slate-500">
              No RMAs yet — create a request with customer SN + part.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
