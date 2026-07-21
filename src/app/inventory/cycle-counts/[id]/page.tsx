import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  actionRecordCycleCountLine,
  actionCompleteCycleCount,
  actionCancelCycleCount,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CycleCountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canCount = await userHasPermission(user?.id, "inventory.cyclecount");

  const cc = await prisma.cycleCount.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!cc) notFound();

  const parts = await prisma.part.findMany({
    where: { id: { in: [...new Set(cc.lines.map((l) => l.partId))] } },
    select: { id: true, partNumber: true, description: true },
  });
  const partById = new Map(parts.map((p) => [p.id, p]));
  const counters = await prisma.user.findMany({
    where: { id: { in: [...new Set(cc.lines.map((l) => l.countedById).filter((x): x is string => !!x))] } },
    select: { id: true, name: true },
  });
  const counterById = new Map(counters.map((u) => [u.id, u.name]));

  const open = !["COMPLETE", "CANCELLED"].includes(cc.status);
  const counted = cc.lines.filter((l) => l.countedQty != null).length;
  const variances = cc.lines.filter(
    (l) => l.countedQty != null && (l.variance ?? 0) !== 0
  );
  const sortedLines = [...cc.lines].sort((a, b) => {
    const pa = partById.get(a.partId)?.partNumber || "";
    const pb = partById.get(b.partId)?.partNumber || "";
    return pa.localeCompare(pb) || (a.location || "").localeCompare(b.location || "");
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={cc.number}
        description={`Cycle count · ${cc.scope || "all on-hand inventory"} · created ${formatDate(cc.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={cc.status} />
            <Link href="/inventory/cycle-counts">
              <Button size="sm" variant="outline">
                ← All counts
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
        <span>
          {counted} / {cc.lines.length} lines counted
        </span>
        <span className={variances.length ? "text-amber-400" : ""}>
          {variances.length} variance(s)
        </span>
        {cc.notes && <span className="text-slate-500">Notes: {cc.notes}</span>}
      </div>

      {open && canCount && (
        <Card className="border-teal-500/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-slate-300">
              {counted < cc.lines.length
                ? `Count every line (0 is a valid count), then complete to post ${
                    variances.length ? "the variances" : "any variances"
                  } as inventory adjustments.`
                : variances.length
                  ? `All lines counted — completing will adjust on-hand for ${variances.length} variance line(s).`
                  : "All lines counted — no variances. Completing just closes the sheet."}
            </p>
            <div className="flex gap-2">
              <form action={actionCompleteCycleCount}>
                <input type="hidden" name="cycleCountId" value={cc.id} />
                <Button type="submit" size="sm" disabled={counted < cc.lines.length}>
                  Complete &amp; post variances
                </Button>
              </form>
              <form action={actionCancelCycleCount}>
                <input type="hidden" name="cycleCountId" value={cc.id} />
                <Button type="submit" size="sm" variant="outline">
                  Cancel count
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2 text-left">Bin</th>
              <th className="px-3 py-2 text-right">System qty</th>
              <th className="px-3 py-2 text-right">Counted</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2 text-left">Counted by</th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((l) => {
              const part = partById.get(l.partId);
              const hasCount = l.countedQty != null;
              const v = l.variance ?? 0;
              return (
                <tr
                  key={l.id}
                  className={`border-t border-slate-800/60 ${
                    hasCount && v !== 0 ? "bg-amber-500/5" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/items/${l.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {part?.partNumber || l.partId}
                    </Link>
                    <p className="text-xs text-slate-500">{part?.description}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">
                    {l.location || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.systemQty}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {open && canCount ? (
                      <form
                        action={actionRecordCycleCountLine}
                        className="flex items-center justify-end gap-1.5"
                      >
                        <input type="hidden" name="lineId" value={l.id} />
                        <input type="hidden" name="cycleCountId" value={cc.id} />
                        <Input
                          name="countedQty"
                          type="number"
                          step="any"
                          min="0"
                          required
                          defaultValue={hasCount ? String(l.countedQty) : ""}
                          className="h-8 w-24 text-right text-xs"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant={hasCount ? "outline" : "secondary"}
                          className="h-8"
                        >
                          {hasCount ? "Update" : "Count"}
                        </Button>
                      </form>
                    ) : (
                      <span className="tabular-nums">
                        {hasCount ? l.countedQty : "—"}
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      !hasCount
                        ? "text-slate-600"
                        : v === 0
                          ? "text-emerald-400"
                          : "text-amber-400"
                    }`}
                  >
                    {hasCount ? (v > 0 ? `+${v}` : v) : "—"}
                    {l.adjustedAt && (
                      <p className="text-[10px] text-slate-500">adjusted</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {l.countedById
                      ? `${counterById.get(l.countedById) || "?"}${
                          l.countedAt ? ` · ${formatDate(l.countedAt)}` : ""
                        }`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
