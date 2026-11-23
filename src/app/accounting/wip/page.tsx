import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getWipByWorkOrderReport } from "@/lib/services/inventory-accounting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function WipReportPage() {
  const report = await getWipByWorkOrderReport({ includeClosed: true });
  const money = (n: number) => formatCurrency(n);
  return (
    <div className="space-y-6">
      <PageHeader
        title="WIP by job"
        description="Beginning work in process, material, labor and overhead charged in, amount moved to finished goods, variance at close, and what is still on the job."
        actions={
          <div className="flex gap-2">
            <Link href="/reports/export?key=wip-movement">
              <Button size="sm" variant="outline">Download CSV</Button>
            </Link>
            <Link href="/accounting">
              <Button size="sm" variant="outline">Back to accounting</Button>
            </Link>
          </div>
        }
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {["Job", "Status", "Beginning", "Material in", "Labor in", "Overhead in", "Relieved to FG", "Variance", "Ending WIP"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.workOrderId || "none"} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-medium text-slate-200">
                    {r.workOrderId ? (
                      <Link href={`/work-orders/${r.workOrderId}`} className="text-teal-400 hover:underline">
                        {r.number}
                      </Link>
                    ) : r.number}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.status || "—"}</td>
                  <td className="px-3 py-2 font-mono">{money(r.beginning)}</td>
                  <td className="px-3 py-2 font-mono">{money(r.materialIn)}</td>
                  <td className="px-3 py-2 font-mono">{money(r.laborIn)}</td>
                  <td className="px-3 py-2 font-mono">{money(r.overheadIn)}</td>
                  <td className="px-3 py-2 font-mono">{money(r.relieved)}</td>
                  <td className="px-3 py-2 font-mono">{money(r.variance)}</td>
                  <td className="px-3 py-2 font-mono text-slate-100">{money(r.ending)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-700 bg-slate-900/60 font-medium text-slate-100">
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.beginning)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.materialIn)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.laborIn)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.overheadIn)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.relieved)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.variance)}</td>
                <td className="px-3 py-2 font-mono">{money(report.totals.ending)}</td>
              </tr>
            </tbody>
          </table>
          {report.rows.length === 0 && (
            <p className="px-4 py-8 text-sm text-slate-500">No WIP activity is on the books yet.</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-slate-500">
        Figures come from posted journals on the work-in-process account ({report.wipAccount.code} {report.wipAccount.name}).
        Click a job to receive finished goods or close remaining WIP.
      </p>
    </div>
  );
}
