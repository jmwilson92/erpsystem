"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import {
  actionAssignKitSerialToUnit,
  actionInstallSerialOnWo,
  actionRemoveSerialInstall,
} from "@/app/actions";
import { actionIssueTopUnitSerial } from "@/app/serial-wo-actions";

export function AsBuiltKitPlan({
  workOrderId,
  workOrderNumber,
  topPartId,
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
  components: { id: string; partNumber: string; description: string }[];
  stockSerials: { serial: string; partId: string; partNumber: string; status: string; lotNumber: string | null }[];
}) {
  const [unitIndex, setUnitIndex] = useState(units[0]?.unitIndex ?? 1);
  const [componentPartId, setComponentPartId] = useState(components[0]?.id ?? "");
  const unit = units.find((u) => u.unitIndex === unitIndex) ?? units[0];
  const topStock = stockSerials.filter((s) => s.partId === topPartId);
  const componentStock = useMemo(
    () => stockSerials.filter((s) => s.partId === componentPartId),
    [stockSerials, componentPartId]
  );
  const selectedPart = components.find((c) => c.id === componentPartId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Building {units.length}× {topPartNumber}. Click a unit, set its nameplate SN,
        then pick a component part and a serial that is already in stock.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {units.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setUnitIndex(u.unitIndex)}
            className={`rounded border p-2 text-left text-xs ${
              u.unitIndex === unitIndex
                ? "border-teal-500 bg-teal-950/40"
                : "border-slate-800 bg-slate-950/40"
            }`}
          >
            <p className="font-semibold text-slate-200">
              Unit {u.unitIndex} <StatusBadge status={u.status} />
            </p>
            <p className="mt-1 font-mono text-teal-400">
              {topPartNumber} · {u.serial?.serial || "no top SN"}
            </p>
            <ul className="mt-2 space-y-0.5 text-slate-400">
              {kitSerialPlan
                .filter((a) => a.unitIndex === u.unitIndex)
                .map((a) => (
                  <li key={a.id}>
                    <span className="text-slate-500">{a.serial.part.partNumber}</span>{" "}
                    <span className="font-mono text-amber-300">{a.serial.serial}</span>
                  </li>
                ))}
              {!kitSerialPlan.some((a) => a.unitIndex === u.unitIndex) && (
                <li className="text-slate-600">No kit SNs yet</li>
              )}
            </ul>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded border border-slate-800 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            1. Nameplate serial for {topPartNumber} · unit {unitIndex}
          </p>
          <ActionLoadingForm action={actionIssueTopUnitSerial} className="grid gap-2">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="unitIndex" value={unitIndex} />
            <select name="serial" className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs" defaultValue="">
              <option value="">Mint {workOrderNumber}-U{String(unitIndex).padStart(2, "0")}</option>
              {topStock.map((s) => (
                <option key={s.serial} value={s.serial}>{s.serial} ({s.status})</option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary">Set top SN</Button>
          </ActionLoadingForm>
        </div>

        <div className="space-y-2 rounded border border-slate-800 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            2. Assign stock serial to this unit
          </p>
          <ActionLoadingForm action={actionAssignKitSerialToUnit} className="grid gap-2">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="unitIndex" value={unitIndex} />
            <input type="hidden" name="partId" value={componentPartId} />
            <select className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs" value={componentPartId} onChange={(e) => setComponentPartId(e.target.value)}>
              {components.length === 0 && <option value="">No serialized BOM lines</option>}
              {components.map((c) => (
                <option key={c.id} value={c.id}>{c.partNumber} — {c.description}</option>
              ))}
            </select>
            <select name="serial" required className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs font-mono" defaultValue="">
              <option value="" disabled>{componentStock.length ? "Select serial in stock" : "No stock serials for this part"}</option>
              {componentStock.map((s) => (
                <option key={s.serial} value={s.serial}>
                  {s.serial}{s.lotNumber ? ` · ${s.lotNumber}` : ""} · {s.status}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={!componentStock.length}>Assign to unit {unitIndex}</Button>
            {!componentStock.length && selectedPart && (
              <p className="text-[11px] text-amber-400">
                {selectedPart.partNumber} has no IN_STOCK serial. Receive it first.
              </p>
            )}
          </ActionLoadingForm>
        </div>
      </div>

      <div className="space-y-2 rounded border border-teal-900/40 p-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">3. Record install</p>
        <ActionLoadingForm action={actionInstallSerialOnWo} className="grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <input type="hidden" name="unitIndex" value={unitIndex} />
          <input type="hidden" name="childPartId" value={componentPartId} />
          {rmaId && <input type="hidden" name="rmaId" value={rmaId} />}
          <input type="hidden" name="parentSerial" value={unit?.serial?.serial || ""} />
          <p className="self-center text-xs text-slate-400">
            Parent: <span className="font-mono text-teal-400">{unit?.serial?.serial || "set top SN first"}</span>
          </p>
          <select className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs" value={componentPartId} onChange={(e) => setComponentPartId(e.target.value)}>
            {components.map((c) => (
              <option key={c.id} value={c.id}>{c.partNumber}</option>
            ))}
          </select>
          <select name="childSerial" required className="flex h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs font-mono" defaultValue="">
            <option value="" disabled>{componentStock.length ? "Serial to install" : "Nothing in stock"}</option>
            {componentStock.map((s) => (
              <option key={s.serial} value={s.serial}>{s.serial}</option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={!unit?.serial?.serial || !componentStock.length}>Record install</Button>
        </ActionLoadingForm>
      </div>

      {unitTrees.map((ut) => (
        <div key={ut.unitIndex} className="text-xs">
          <p className="mb-1 font-medium text-slate-300">Unit {ut.unitIndex} tree · {ut.serial}</p>
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
