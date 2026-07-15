import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAssetsOverview } from "@/lib/services/assets";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionCreateAsset,
  actionCheckoutAsset,
  actionCheckinAsset,
} from "@/app/actions";
import { Boxes, PackageCheck, PlaneTakeoff, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

export default async function AssetsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ assets, counts }, people, openWos, openTasks] = await Promise.all([
    getAssetsOverview(),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.workOrder.findMany({
      where: { status: { notIn: ["COMPLETE", "CLOSED", "CANCELLED"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
      take: 100,
    }),
    prisma.engTask.findMany({
      where: { status: { notIn: ["DONE", "CANCELLED"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset Tracker"
        description="Company tools, test equipment, and demo units. Check assets in and out, assign them to work orders or engineering tasks, and keep in-house-only gear on-site."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Total assets" value={counts.total} icon={Boxes} accent="teal" />
        <StatCard title="Available" value={counts.available} icon={PackageCheck} accent="emerald" />
        <StatCard title="Checked out" value={counts.out} icon={Building2} accent="sky" />
        <StatCard title="Offsite now" value={counts.offsite} icon={PlaneTakeoff} accent="amber" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add an asset</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateAsset} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Input name="name" required placeholder="Name" className="h-9 sm:col-span-2" />
            <select name="category" className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200" defaultValue="EQUIPMENT">
              <option value="EQUIPMENT">Equipment</option>
              <option value="TEST_EQUIPMENT">Test equipment</option>
              <option value="TOOL">Tool</option>
              <option value="IT">IT</option>
              <option value="DEMO_UNIT">Demo unit</option>
              <option value="VEHICLE">Vehicle</option>
            </select>
            <Input name="serialNumber" placeholder="Serial #" className="h-9" />
            <select name="locationScope" className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200" defaultValue="IN_HOUSE_ONLY">
              <option value="IN_HOUSE_ONLY">In-house only</option>
              <option value="OFFSITE_OK">Offsite OK</option>
            </select>
            <Button type="submit" size="sm" className="h-9">
              Add asset
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Asset register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {assets.map((a) => {
            const holder = a.checkouts[0];
            const isOut = ["CHECKED_OUT", "IN_USE"].includes(a.status);
            return (
              <div
                key={a.id}
                className="rounded-xl border border-slate-800 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-slate-200">
                      <Link
                        href={`/assets/${a.id}`}
                        className="font-mono text-xs text-teal-400 hover:underline"
                      >
                        {a.assetTag}
                      </Link>
                      <Link href={`/assets/${a.id}`} className="hover:underline">
                        {a.name}
                      </Link>
                      <StatusBadge status={a.status} />
                      {a.locationScope === "IN_HOUSE_ONLY" ? (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          in-house only
                        </span>
                      ) : (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                          offsite OK
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {a.category.replace(/_/g, " ")}
                      {a.serialNumber ? ` · SN ${a.serialNumber}` : ""}
                      {a.homeLocation ? ` · home: ${a.homeLocation}` : ""}
                      {a.purchaseValue ? ` · ${formatCurrency(a.purchaseValue)}` : ""}
                    </p>
                    {isOut && holder && (
                      <p className="mt-0.5 text-[11px] text-sky-400">
                        Out to {a.assignedToUser?.name || "—"}
                        {holder.offsite && holder.destination
                          ? ` · offsite → ${holder.destination}`
                          : ""}
                        {holder.dueAt ? ` · due ${formatDate(holder.dueAt)}` : ""}
                        {a.workOrder ? ` · WO ${a.workOrder.number}` : ""}
                        {a.engTask ? ` · task: ${a.engTask.name}` : ""}
                        {holder.purpose ? ` · ${holder.purpose}` : ""}
                      </p>
                    )}
                  </div>
                  {isOut ? (
                    <form action={actionCheckinAsset} className="flex items-center gap-1.5">
                      <input type="hidden" name="assetId" value={a.id} />
                      <Input name="returnNote" placeholder="Condition note" className="h-8 w-40 text-xs" />
                      <Button type="submit" size="sm" variant="outline" className="h-8">
                        Check in
                      </Button>
                    </form>
                  ) : a.status === "AVAILABLE" ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500/50">
                        Check out →
                      </summary>
                      <form
                        action={actionCheckoutAsset}
                        className="mt-2 grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2 sm:grid-cols-2"
                      >
                        <input type="hidden" name="assetId" value={a.id} />
                        <select name="userId" className={selectClass} defaultValue={user.id}>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <Input name="purpose" placeholder="Purpose" className="h-8 text-xs" />
                        <select name="workOrderId" className={selectClass} defaultValue="">
                          <option value="">No work order</option>
                          {openWos.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.number}
                            </option>
                          ))}
                        </select>
                        <select name="engTaskId" className={selectClass} defaultValue="">
                          <option value="">No eng task</option>
                          {openTasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name.slice(0, 40)}
                            </option>
                          ))}
                        </select>
                        {a.locationScope === "OFFSITE_OK" && (
                          <>
                            <label className="flex items-center gap-1.5 text-xs text-slate-400">
                              <input type="checkbox" name="offsite" value="true" />
                              Taking offsite
                            </label>
                            <Input name="destination" placeholder="Destination" className="h-8 text-xs" />
                          </>
                        )}
                        <Input name="dueAt" type="date" className="h-8 text-xs" />
                        <Button type="submit" size="sm" className="h-8">
                          Confirm checkout
                        </Button>
                      </form>
                    </details>
                  ) : (
                    <StatusBadge status={a.status} />
                  )}
                </div>
              </div>
            );
          })}
          {assets.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              No assets yet. Add one above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
