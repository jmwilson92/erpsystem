import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInventoryGlReconciliation } from "@/lib/services/inventory-accounting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InventoryValuationPage() {
  const report = await getInventoryGlReconciliation();
  const money = (n: number) => formatCurrency(n);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory to general ledger"
        description="On-hand stock valued at each bin's unit cost, compared to the raw materials, work-in-process, and finished-goods accounts. Differences are highlighted so an accountant can investigate."
        actions={
          <div className="flex gap-2">
            <Link href="/reports/export?key=inventory-gl">
              <Button size="sm" variant="outline">Download CSV</Button>
            </Link>
            <Link href="/accounting">
              <Button size="sm" variant="outline">Back to accounting</Button>
            </Link>
          </div>
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        {report.rows.map((r) => {
          const off = Math.abs(r.difference) > 0.01;
          return (
            <Card key={r.key} className={off ? "border-amber-700/60" : ""}>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">{r.label}</CardTitle>
                <p className="text-xs text-slate-500">
                  <Link href={`/accounting/account/${r.accountId}`} className="text-teal-400 hover:underline">
                    {r.accountCode} {r.accountName}
                  </Link>
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Subledger</span><span className="font-mono">{money(r.subledger)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">General ledger</span><span className="font-mono">{money(r.gl)}</span></div>
                <div className={`flex justify-between font-medium ${off ? "text-amber-400" : "text-emerald-400"}`}>
                  <span>Difference</span><span className="font-mono">{money(r.difference)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {report.rows.some((r) => r.key === "WIP") && (
        <p className="text-sm text-slate-400">
          Material sitting at jobs is {formatCurrency(report.wipMaterialOnHand)}.
          Labor and overhead absorbed into WIP make up the other {formatCurrency(report.wipConversion)}.
          Together they should equal the work-in-process ledger.
        </p>
      )}
      <p className={`text-sm ${report.inBalance ? "text-emerald-400" : "text-amber-400"}`}>
        {report.inBalance
          ? "The inventory subledger agrees with the general ledger."
          : "The subledger and the general ledger do not agree. Review the highlighted differences and the transaction register."}
      </p>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">On-hand detail</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {["Part", "Location", "Class", "Qty", "Unit cost", "Value", "Account"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.detail.map((d, i) => (
                <tr key={`${d.partNumber}-${d.location}-${i}`} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-mono text-slate-200">{d.partNumber}</td>
                  <td className="px-3 py-2 text-slate-400">{d.location}</td>
                  <td className="px-3 py-2">{d.class}</td>
                  <td className="px-3 py-2 font-mono">{d.quantity}</td>
                  <td className="px-3 py-2 font-mono">{money(d.unitCost)}</td>
                  <td className="px-3 py-2 font-mono">{money(d.value)}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{d.accountCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.detail.length === 0 && (
            <p className="px-4 py-8 text-sm text-slate-500">No on-hand inventory to value.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
