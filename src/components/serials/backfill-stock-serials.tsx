import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { actionBackfillStockSerials } from "@/app/serial-backfill-actions";

export async function BackfillStockSerialsCard() {
  const parts = await prisma.part.findMany({
    where: { isActive: true },
    orderBy: { partNumber: "asc" },
    select: {
      id: true,
      partNumber: true,
      description: true,
      isSerialized: true,
      inventoryItems: {
        select: {
          quantityOnHand: true,
          quantityAvailable: true,
          quantityQuarantine: true,
        },
      },
      _count: { select: { serials: true } },
    },
    take: 400,
  });
  const rows = parts.map((p) => {
    const onHand = p.inventoryItems.reduce((s, i) => s + (i.quantityOnHand || 0), 0);
    const available = p.inventoryItems.reduce((s, i) => s + (i.quantityAvailable || 0), 0);
    const quarantined = p.inventoryItems.reduce((s, i) => s + (i.quantityQuarantine || 0), 0);
    return {
      ...p,
      onHand,
      available,
      quarantined,
      serials: p._count.serials,
      gap: Math.max(0, Math.round(available) - p._count.serials),
    };
  });
  const selected = rows.find((p) => p.gap > 0);

  return (
    <Card className="border-amber-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-200">
          Record serials onto existing stock
        </CardTitle>
        <p className="text-xs text-slate-500">
          Use this when a part was received as bulk qty, then later marked serialized.
          Type one serial per line. They become IN_STOCK and can be kitted to a WO.
        </p>
      </CardHeader>
      <CardContent>
        <ActionLoadingForm action={actionBackfillStockSerials} className="space-y-2">
          <select
            name="partId"
            required
            defaultValue={selected?.id || ""}
            className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
          >
            <option value="" disabled>
              Select part
            </option>
            {rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.partNumber} — on hand {p.onHand} · avail {p.available} · Q {p.quarantined} · serials {p.serials}
                {p.gap > 0 ? ` · need {p.gap}` : ""}
              </option>
            ))}
          </select>
          <Input name="lotNumber" placeholder="Lot (optional)" className="text-sm" />
          <Textarea
            name="serials"
            required
            rows={6}
            placeholder={"SN-0001\nSN-0002\nSN-0003"}
            className="font-mono text-xs"
          />
          <Button type="submit" size="sm">
            Add serials to stock
          </Button>
        </ActionLoadingForm>
      </CardContent>
    </Card>
  );
}
