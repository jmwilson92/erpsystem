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

export function AsBuiltKitPlan(props: {
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
  const {
    workOrderId, workOrderNumber, topPartId, topPartNumber, rmaId,
    units, kitSerialPlan, unitTrees, components, stockSerials,
  } = props;
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
        Building {units.length}× {topPartNumber}. Pick the unit, then a component
        part and a serial already in stock. Missing from the list means it was not received.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {units.map((u) => (
          <button key={u.id} type="button" onClick={() => setUnitIndex(u.unitIndex)}
            className={`rounded border p-2 text-left text-xs ${u.unitIndex === unitIndex ? "border-teal-500 bg-teal-950/40" : "border-slate-800 bg-slate-950/40"}`}>
            <p className="font-semibold text-slate-200">Unit {u.unitIndex} <StatusBadge status={u.status} /></p>
            <p className="mt-1 font-mono text-teal-400">{topPartNumber} · {u.serial?.serial || "no top SN"}</p>
            <ul className="mt-2 space-y-0.5 text-slate-400">
              {kitSerialPlan.filter((a) => a.unitIndex === u.unitIndex).map((a) => (
                <li key={a.id}><span className="text-slate-500">{a.serial.part.partNumber}</span>{" "}
                  <span className="font-mono text-amber-300">{a.serial.serial}</span></li>
              ))}
              {!kitSerialPlan.some((a) => a.unitIndex === u.unitIndex) && (
                <li className="text-slate-600">No kit SNs yet</li>
              )}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
}
