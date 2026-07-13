import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleField } from "@/components/ui/toggle-field";
import { actionSaveWorkCenter } from "@/app/actions";
import { WORK_AREAS, WORK_AREA_LABELS } from "@/lib/work-areas";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WorkCentersPage() {
  const centers = await prisma.workCenter.findMany({
    orderBy: [{ area: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  });

  const byArea = WORK_AREAS.map((area) => ({
    area,
    centers: centers.filter((c) => c.area === area),
  }));

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workcenters"
        description="Manufacturing · QA · Test — create stations and set defaults for area routing"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {byArea.map(({ area, centers: list }) => (
          <Card key={area} className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                <StatusBadge status={area} />
              </CardTitle>
              <p className="text-xs text-slate-500">{WORK_AREA_LABELS[area]}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.length === 0 && (
                <p className="text-xs text-slate-600">No stations yet</p>
              )}
              {list.map((c) => (
                <Link
                  key={c.id}
                  href={`/workcenters/${c.id}`}
                  className="block rounded border border-slate-800 px-3 py-2 text-sm transition-colors hover:border-teal-500/40 hover:bg-slate-900/50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-teal-400">{c.code}</span>
                    {!c.isActive && <StatusBadge status="INACTIVE" />}
                    {c.isDefault && <StatusBadge status="DEFAULT" />}
                  </div>
                  <p className="text-xs text-slate-400">{c.name}</p>
                  <p className="text-[10px] text-slate-600">
                    Cap {c.capacityHoursPerDay}h/d · eff{" "}
                    {Math.round(c.efficiency * 100)}%
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-teal-900/40">
        <CardHeader>
          <CardTitle>Add or update workcenter</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionSaveWorkCenter} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Code
                </label>
                <Input
                  name="code"
                  required
                  className="mt-1 font-mono"
                  placeholder="e.g. ASM-03"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Name
                </label>
                <Input
                  name="name"
                  required
                  className="mt-1"
                  placeholder="Assembly Cell 3"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Area / module
                </label>
                <select
                  name="area"
                  required
                  className={`${selectClass} mt-1`}
                  defaultValue="MANUFACTURING"
                >
                  {WORK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Department label
                </label>
                <Input name="department" className="mt-1" placeholder="Optional" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Capacity h/day
                </label>
                <Input
                  name="capacityHoursPerDay"
                  type="number"
                  step="0.5"
                  className="mt-1"
                  defaultValue={16}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Efficiency (0–1)
                </label>
                <Input
                  name="efficiency"
                  type="number"
                  step="0.01"
                  className="mt-1"
                  defaultValue={0.85}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Sort order
                </label>
                <Input
                  name="sortOrder"
                  type="number"
                  className="mt-1"
                  defaultValue={0}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Existing (to update)
                </label>
                <select name="id" className={`${selectClass} mt-1`} defaultValue="">
                  <option value="">— Create new —</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.area}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <ToggleField
                name="isDefault"
                label="Default for area (used when WI only says QA / TEST / MANUFACTURING)"
              />
              <ToggleField name="isActive" defaultChecked label="Active" />
            </div>
            <Button type="submit">Save workcenter</Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-600">
        Work instructions can require a general <strong className="text-slate-400">area</strong>{" "}
        and/or a <strong className="text-slate-400">specific station</strong>. Coordinators
        assign WOs and steps on the traveler unless the step is route-locked.{" "}
        <Link href="/work-orders" className="text-sky-400 hover:underline">
          Work orders →
        </Link>
      </p>
    </div>
  );
}
