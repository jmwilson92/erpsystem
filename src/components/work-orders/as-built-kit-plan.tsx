"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { actionAssignKitSerialToUnit } from "@/app/actions";
import { actionIssueTopUnitSerial } from "@/app/serial-wo-actions";

export function AsBuiltKitPlan({
  workOrderId,
  workOrderNumber,
  topPartNumber,
  units,
  kitSerialPlan,
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
        {topPartNumber} is serialized, so this traveler records its nameplate SN
        and every serialized BOM component from stock. Install confirmation happens
        on the work-instruction steps the tech signs — not on the CM master WI.
      </p>
      {!complete && (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Traveler incomplete.
          {!unit?.serial?.serial && " Nameplate SN not set."}
          {missing.length > 0 && <> Missing: {missing.map((m) => m.partNumber).join(", ")}.</>}
        </p>
      )}
      {complete && (
        <p className="rounded border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
          Nameplate and all serialized components recorded. Confirm installs on WI steps.
        </p>
      )}
      <div className="space-y-2 rounded border border-slate-800 p-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          1. Type nameplate SN for {topPartNumber}
        </p>
        <ActionLoadingForm action={actionIssueTopUnitSerial} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <input type="hidden" name="unitIndex" value={unitIndex} />
          <Input name="serial" required defaultValue={unit?.serial?.serial || suggested} className="font-mono text-xs" />
          <Button type="submit" size="sm" variant="secondary">Set top SN</Button>
        </ActionLoadingForm>
      </div>
      <div className="space-y-2 rounded border border-slate-800 p-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          2. Stock serial for each serialized BOM line
        </p>
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
                <StatusBadge status={assigned.length >= c.qty ? "RECORDED" : "NEEDED"} />
              </div>
              {assigned.map((a) => (
                <p key={a.id} className="font-mono text-xs text-amber-300">{a.serial.serial}</p>
              ))}
              {assigned.length < c.qty && (
                <ActionLoadingForm action={actionAssignKitSerialToUnit} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input type="hidden" name="workOrderId" value={workOrderId} />
                  <input type="hidden" name="unitIndex" value={unitIndex} />
                  <input type="hidden" name="partId" value={c.id} />
                  <select name="serial" required defaultValue="" className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs font-mono">
                    <option value="" disabled>{options.length ? "Select serial from stock" : "Nothing in stock"}</option>
                    {options.map((s) => (
                      <option key={s.serial} value={s.serial}>
                        {s.serial}{s.lotNumber ? ` · ${s.lotNumber}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" disabled={!options.length}>Assign</Button>
                </ActionLoadingForm>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
