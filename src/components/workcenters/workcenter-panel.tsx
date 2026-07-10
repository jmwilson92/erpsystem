import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { actionSaveWorkCenter, actionScanWorkOrderToStation } from "@/app/actions";
import type { WorkArea } from "@/lib/work-areas";
import { WORK_AREA_LABELS } from "@/lib/work-areas";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

/** Create/list workcenters for one area + scan WO into a station. */
export async function WorkcenterPanel({
  area,
  returnPath,
}: {
  area: WorkArea;
  returnPath: string;
}) {
  const [centers, openWos] = await Promise.all([
    prisma.workCenter.findMany({
      where: { area },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.workOrder.findMany({
      where: {
        status: {
          in: [
            "PLANNED",
            "RELEASED",
            "IN_PROGRESS",
            "ON_HOLD",
            "WAITING_MATERIAL",
            "KITTED",
            "READY_TO_KIT",
          ],
        },
      },
      orderBy: { number: "asc" },
      take: 80,
      select: {
        id: true,
        number: true,
        workCenter: true,
        status: true,
        part: { select: { partNumber: true } },
      },
    }),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {WORK_AREA_LABELS[area]} stations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {centers.length === 0 && (
            <p className="text-sm text-slate-500">No stations yet — add one.</p>
          )}
          {centers.map((c) => (
            <div
              key={c.id}
              className="rounded border border-slate-800 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-teal-400">{c.code}</span>
                {c.isDefault && <StatusBadge status="DEFAULT" />}
                {!c.isActive && <StatusBadge status="INACTIVE" />}
              </div>
              <p className="text-xs text-slate-400">{c.name}</p>
              <p className="text-[10px] text-slate-600">
                Cap {c.capacityHoursPerDay}h/d ·{" "}
                {Math.round(c.efficiency * 100)}% eff
              </p>
            </div>
          ))}

          <form
            action={actionSaveWorkCenter}
            className="mt-3 grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
          >
            <input type="hidden" name="area" value={area} />
            <input type="hidden" name="returnPath" value={returnPath} />
            <input type="hidden" name="isActive" value="on" />
            <p className="sm:col-span-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Add workcenter
            </p>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Code *
              </label>
              <Input
                name="code"
                required
                className="mt-1 font-mono"
                placeholder={
                  area === "QA"
                    ? "QA-02"
                    : area === "TEST"
                      ? "TEST-02"
                      : "ASM-03"
                }
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Name *
              </label>
              <Input name="name" required className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Capacity h/day
              </label>
              <Input
                name="capacityHoursPerDay"
                type="number"
                step="0.5"
                defaultValue={16}
                className="mt-1"
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-400">
              <input
                type="checkbox"
                name="isDefault"
                className="rounded border-slate-600"
              />
              Default for area
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm">
                Save workcenter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-teal-900/40">
        <CardHeader>
          <CardTitle className="text-base">
            Scan WO into station
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-slate-500">
            Operators scan (or select) a work order into a workcenter to start /
            continue work. Demo: pick WO + station and click Scan.
          </p>
          <form action={actionScanWorkOrderToStation} className="space-y-3">
            <input type="hidden" name="returnPath" value={returnPath} />
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Work order *
              </label>
              <select
                name="workOrderId"
                required
                className={`${selectClass} mt-1`}
              >
                <option value="">— Select WO —</option>
                {openWos.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.number}
                    {w.part?.partNumber ? ` · ${w.part.partNumber}` : ""}
                    {w.workCenter ? ` @ ${w.workCenter}` : ""} · {w.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Or type WO number
              </label>
              <Input
                name="workOrderNumber"
                className="mt-1 font-mono"
                placeholder="SWO/BWO/MWO-00012"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Station *
              </label>
              <select
                name="workCenterCode"
                required
                className={`${selectClass} mt-1`}
              >
                <option value="">— Select station —</option>
                {centers
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Scan into station
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
