import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInventoryTransactionRegister } from "@/lib/services/inventory-accounting";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

export default async function InventoryRegisterPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const type = pick(sp, "type");
  const rows = await getInventoryTransactionRegister({
    type: type || undefined,
    take: 300,
  });
  const types = ["", "RECEIPT", "KIT", "ISSUE", "UNISSUE", "WO_OUTPUT", "WO_COMPLETE", "SHIP", "RMA_RECEIPT", "RMA_RESTOCK", "SCRAP", "TRANSFER", "ADJUSTMENT"];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory transaction register"
        description="Every stock movement, with a link to the journal that posted it when the books were updated."
        actions={
          <div className="flex gap-2">
            <Link href="/reports/export?key=inv-register">
              <Button size="sm" variant="outline">Download CSV</Button>
            </Link>
            <Link href="/accounting">
              <Button size="sm" variant="outline">Back to accounting</Button>
            </Link>
          </div>
        }
      />
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          Type
          <select name="type" defaultValue={type} className="mt-1 block h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200">
            {types.map((t) => (
              <option key={t || "all"} value={t}>{t || "All movements"}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">Filter</Button>
      </form>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {["Date", "Type", "Part", "Qty", "Value", "From", "To", "Reference", "Journal"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-slate-200">{r.partNumber}</div>
                    <div className="text-xs text-slate-500">{r.description}</div>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.quantity}</td>
                  <td className="px-3 py-2 font-mono">{formatCurrency(r.value)}</td>
                  <td className="px-3 py-2 text-slate-400">{r.fromLocation || "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{r.toLocation || "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{r.rmaId && r.rmaNumber ? (<Link href={`/rma/${r.rmaId}`} className="text-teal-400 hover:underline">{r.rmaNumber}</Link>) : (r.reference || "—")}</td>
                  <td className="px-3 py-2">
                    {r.journalId ? (
                      <Link href={`/accounting/journal/${r.journalId}`} className="text-teal-400 hover:underline">
                        {r.journalNumber}
                      </Link>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="px-4 py-8 text-sm text-slate-500">No inventory movements match this filter.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
