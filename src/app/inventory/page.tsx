import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Package, AlertTriangle, Shield, Archive } from "lucide-react";
import { actionPutAwayAllReceiving, actionPutAwayItem } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const items = await prisma.inventoryItem.findMany({
    include: {
      part: true,
      location: { include: { warehouse: true } },
      mrbCase: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const totalOnHand = items.reduce((s, i) => s + i.quantityOnHand, 0);
  const totalValue = items.reduce((s, i) => s + i.quantityOnHand * i.unitCost, 0);
  const quarantine = items.filter((i) => i.quantityQuarantine > 0);
  const low = items.filter((i) => i.quantityAvailable > 0 && i.quantityAvailable <= 5);
  const awaitingPutaway = items.filter(
    (i) =>
      i.location.type === "RECEIVING" &&
      i.quantityOnHand > 0 &&
      i.quantityQuarantine === 0 &&
      !i.mrbCaseId
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Receive → inspect + photo → putaway to stock · lot/serial trace · quarantine"
        actions={
          awaitingPutaway.length > 0 ? (
            <form action={actionPutAwayAllReceiving}>
              <Button type="submit" size="sm">
                Put away all receiving ({awaitingPutaway.length})
              </Button>
            </form>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="SKU Locations" value={items.length} icon={Package} accent="teal" />
        <StatCard title="Inventory Value" value={formatCurrency(totalValue)} icon={Archive} accent="sky" />
        <StatCard title="Quarantine Lines" value={quarantine.length} icon={AlertTriangle} accent="amber" />
        <StatCard title="Awaiting Putaway" value={awaitingPutaway.length} icon={Shield} accent="violet" />
      </div>

      {awaitingPutaway.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium text-sky-400">
              Receiving dock — inspected material needs putaway (photos on file)
            </p>
            {awaitingPutaway.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2"
              >
                <div>
                  <span className="font-mono text-teal-400">{item.part.partNumber}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {item.quantityOnHand} @ {item.location.code} · Lot {item.lotNumber || "—"}
                  </span>
                </div>
                <form action={actionPutAwayItem}>
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Put away + photo
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-right">On Hand</th>
              <th className="px-3 py-2 text-right">Available</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Quarantine</th>
              <th className="px-3 py-2 text-left">Lot / Serial</th>
              <th className="px-3 py-2 text-left">Ownership</th>
              <th className="px-3 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-t border-slate-800/60 ${
                  item.quantityQuarantine > 0 ? "bg-orange-500/5" : ""
                } ${item.ownership === "GOVERNMENT" ? "bg-violet-500/5" : ""} ${
                  item.location.type === "RECEIVING" ? "bg-sky-500/5" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <span className="font-mono text-teal-400">{item.part.partNumber}</span>
                  <p className="text-xs text-slate-500">{item.part.description}</p>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {item.location.warehouse.code}/{item.location.code}
                  <span className="ml-1 text-[10px] text-slate-600">{item.location.type}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{item.quantityOnHand}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                  {item.quantityAvailable}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-sky-400">
                  {item.quantityCommitted}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-orange-400">
                  {item.quantityQuarantine || "—"}
                  {item.mrbCase && (
                    <p className="text-[10px]">{item.mrbCase.number}</p>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {item.lotNumber || item.serialNumber || "—"}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={item.ownership} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {formatCurrency(item.quantityOnHand * item.unitCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {low.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium text-amber-400">
              Low stock (≤5 available)
            </p>
            <div className="flex flex-wrap gap-2">
              {low.map((i) => (
                <span
                  key={i.id}
                  className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-200"
                >
                  {i.part.partNumber}: {i.quantityAvailable} avail
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-slate-600">
        Total units on hand: {totalOnHand.toLocaleString()}
      </p>
    </div>
  );
}
