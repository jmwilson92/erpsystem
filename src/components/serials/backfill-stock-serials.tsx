import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { actionBackfillStockSerials } from "@/app/serial-backfill-actions";

export async function BackfillStockSerialsCard({
  partId,
}: {
  partId?: string;
}) {
  const parts = await prisma.part.findMany({
    where: { isActive: true },
    orderBy: { partNumber: "asc" },
    select: {
      id: true,
      partNumber: true,
      description: true,
      isSerialized: true,
      inventoryItems: { select: { quantity: true } },
      _count: { select: { serialNumbers: true } },
    },
    take: 400,
  });
  const rows = parts.map((p) => {
    const onHand = p.inventoryItems.reduce((s, i) => s + (i.quantity || 0), 0);
    return {
      ...p,
      onHand,
      serials: p._count.serialNumbers,
      gap: Math.max(0, Math.round(onHand) - p._count.serialNumbers),
    };
  });
  const selected = partId ? rows.find((p) => p.id === partId) : rows.find((p) => p.gap > 0 && p.isSerialized);

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
                {p.partNumber} — on hand {p.onHand} · serials {p.serials}
                {p.gap > 0 ? ` · need ${p.gap}` : ""}
                {p.isSerialized ? "" : " (will mark serialized)"}
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
        {rows.some((r) => r.gap > 0) && (
          <p className="mt-2 text-[11px] text-amber-400">
            Gaps (on-hand qty with no serial yet):{" "}
            {rows
              .filter((r) => r.gap > 0)
              .slice(0, 8)
              .map((r) => `${r.partNumber} ×${r.gap}`)
              .join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
