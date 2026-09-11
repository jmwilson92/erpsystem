"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import {
  actionAssignKitSerialToUnit,
  actionInstallSerialOnWo,
} from "@/app/actions";
import { actionIssueTopUnitSerial } from "@/app/serial-wo-actions";

export function AsBuiltKitPlan({
  workOrderId,
  workOrderNumber,
  topPartNumber,
  rmaId,
  units,
  kitSerialPlan,
  unitTrees,
  components,
  stockSerials,
}: {
  workOrderId: string;
  workOrderNumber: string;
  topPartId: string | null;
  topPartNumber: string;
  rmaId?: string | null;
  units: { id: string; unitIndex: number; status: string; serial: { serial: string } | null }[];
  kitSerialPlan: { id: string; unitIndex: number; status: string; serial: { serial: string; part: { partNumber: string } } }[];
  unitTrees: { unitIndex: number; serial: string; tree: { children: { installId?: string; serial: string; partNumber: string; status: string }[] } | null }[];
  components: { id: string; partNumber: string; description: string; qty: number }[];
  stockSerials: { serial: string; partId: string; partNumber: string; status: string; lotNumber: string | null }[];
}) {
  const unit = units[0];
  const unitIndex = unit?.unitIndex ?? 1;
  const suggested = `${workOrderNumber.replace(/\s+/g, "")}-U${String(unitIndex).padStart(2, "0")}`;

  const assignedPartIds = new Set(
    kitSerialPlan.filter((a) => a.unitIndex === unitIndex).map((a) => a.serial.part.partNumber)
  );
  const missing = components.filter((c) => !assignedPartIds.has(c.partNumber));
  const complete = !!unit?.serial?.serial && missing.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {topPartNumber} is the unit you are building — mint its nameplate SN here.
        Every serialized BOM line below must get a stock serial before this WO can close.
      </p>

      {!complete && (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Traveler incomplete.
          {!unit?.serial?.serial && " Nameplate SN not set."}
          {missing.length > 0 && (
            <> Missing serials: {missing.map((m) => m.partNumber).join(", ")}.</>
          )}
        </p>
      )}
      {complete && (
        <p className="rounded border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
          All serialized components recorded for unit {unitIndex}.
        </p>
      )}

      <div className="space-y-2 rounded border border-slate-800 p-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          1. Nameplate serial for {topPartNumber} · unit {unitIndex}
        </p>
        <p className="text-[11px] text-slate-500">
          Type the SN you are putting on this assembly. This is not pulled from stock — it becomes stock when the WO completes.
        </p>
        <ActionLoadingForm action={actionIssueTopUnitSerial} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <input type="hidden" name="unitIndex" value={unitIndex} />
          <Input
            name="serial"
            required
            defaultValue={unit?.serial?.serial || suggested}
            placeholder={suggested}
            className="font-mono text-xs"
          />
          <Button type="submit" size="sm" variant="secondary">
            {unit?.serial?.serial ? "Update top SN" : "Set top SN"}
          </Button>
        </ActionLoadingForm>
        {unit?.serial?.serial && (
          <p className="font-mono text-xs text-teal-400">Current: {unit.serial.serial}</p>
        )}
      </div>

      <div className="space-y-2 rounded border border-slate-800 p-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          2. Stock serials for every serialized BOM line
        </p>
        {components.length === 0 && (
          <p className="text-xs text-slate-500">No serialized components on this BOM.</p>
        )}
        <div className="space-y-3">
          {components.map((c) => {
            const assigned = kitSerialPlan.filter(
              (a) => a.unitIndex === unitIndex && a.serial.part.partNumber === c.partNumber
            );
            const options = stockSerials.filter((s) => s.partId === c.id);
            return (
              <div key={c.id} className="rounded border border-slate-800/80 p-2">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-teal-400">{c.partNumber}</span>
                  <span className="text-slate-500">{c.description}</span>
                  <span className="text-slate-600">qty {c.qty}</span>
                  {assigned.length >= c.qty ? (
                    <StatusBadge status="RECORDED" />
                  ) : (
                    <StatusBadge status="NEEDED" />
                  )}
                </div>
                <ul className="mb-2 space-y-0.5 text-xs text-slate-400">
                  {assigned.map((a) => (
                    <li key={a.id} className="font-mono text-amber-300">{a.serial.serial}</li>
                  ))}
                </ul>
                {assigned.length < c.qty && (
                  <ActionLoadingForm action={actionAssignKitSerialToUnit} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="unitIndex" value={unitIndex} />
                    <input type="hidden" name="partId" value={c.id} />
                    <select
                      name="serial"
                      required
                      className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs font-mono"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {options.length ? "Select serial from stock" : "No stock serials — receive first"}
                      </option>
                      {options.map((s) => (
                        <option key={s.serial} value={s.serial}>
                          {s.serial}{s.lotNumber ? ` · ${s.lotNumber}` : ""} · {s.status}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" disabled={!options.length}>
                      Assign
                    </Button>
                  </ActionLoadingForm>
                )}
                {assigned.length < c.qty && !options.length && (
                  <p className="mt-1 text-[11px] text-amber-400">
                    {c.partNumber} is not in stock as a serial. Receive or complete the make-from WO first.
                  </p>
                )}
                {unit?.serial?.serial && assigned.length > 0 && assigned.length <= c.qty && (
                  <ActionLoadingForm action={actionInstallSerialOnWo} className="mt-2">
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="unitIndex" value={unitIndex} />
                    <input type="hidden" name="childPartId" value={c.id} />
                    <input type="hidden" name="parentSerial" value={unit.serial.serial} />
                    <input type="hidden" name="childSerial" value={assigned[assigned.length - 1]?.serial.serial || ""} />
                    {rmaId && <input type="hidden" name="rmaId" value={rmaId} />}
                    <Button type="submit" size="sm" variant="outline">
                      Record install on {unit.serial.serial}
                    </Button>
                  </ActionLoadingForm>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {unitTrees.map((ut) => (
        <div key={ut.unitIndex} className="text-xs">
          <p className="mb-1 font-medium text-slate-300">
            Unit {ut.unitIndex} as-built · {ut.serial}
          </p>
          {ut.tree?.children.map((c) => (
            <div key={c.installId} className="ml-2 flex flex-wrap items-center gap-2 border-l border-slate-800 py-0.5 pl-2">
              <StatusBadge status={c.status} />
              <span className="text-slate-500">{c.partNumber}</span>
              <span className="font-mono text-teal-400">{c.serial}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
