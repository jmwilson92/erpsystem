import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { actionCreateCycleCount } from "@/app/actions";
import { ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CycleCountsPage() {
  const user = await getCurrentUser();
  const canCount = await userHasPermission(user?.id, "inventory.cyclecount");

  const counts = await prisma.cycleCount.findMany({
    orderBy: { createdAt: "desc" },
    include: { lines: true },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cycle Counts"
        description="Physical inventory checks — count a bin or part range, review variances, and post adjustments."
        actions={
          <Link href="/inventory">
            <Button size="sm" variant="outline">
              ← Inventory
            </Button>
          </Link>
        }
      />

      {canCount && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-teal-400" />
              Start a cycle count
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={actionCreateCycleCount}
              className="grid gap-2 sm:grid-cols-4"
            >
              <Input
                name="scope"
                placeholder="Scope: bin, warehouse, or part # (blank = everything on hand)"
                className="h-9 sm:col-span-2"
              />
              <Input name="notes" placeholder="Notes" className="h-9" />
              <Button type="submit" size="sm" className="h-9">
                Create count sheet
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              The sheet snapshots system on-hand per part &amp; bin. Enter what you
              physically count; completing the count posts each variance as an
              inventory adjustment (with an audit trail).
            </p>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Count</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Scope</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Counted</th>
              <th className="px-3 py-2 text-right">Variances</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => {
              const counted = c.lines.filter((l) => l.countedQty != null).length;
              const variances = c.lines.filter(
                (l) => (l.variance ?? 0) !== 0 && l.countedQty != null
              ).length;
              return (
                <tr key={c.id} className="border-t border-slate-800/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/inventory/cycle-counts/${c.id}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {c.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {c.scope || "All on-hand"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.lines.length}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {counted}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      variances > 0 ? "text-amber-400" : "text-slate-500"
                    }`}
                  >
                    {variances}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatDate(c.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {counts.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            No cycle counts yet.
          </div>
        )}
      </div>
    </div>
  );
}
