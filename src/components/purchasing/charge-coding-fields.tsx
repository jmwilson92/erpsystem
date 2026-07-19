"use client";

import { useState } from "react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

/**
 * Charge coding that only shows what applies:
 *  - PROGRAM  → project + WBS pickers
 *  - DIRECT / INDIRECT (no project) → budget charge-code picker only;
 *    accounting maps the charge code to the GL later
 *  - SALES_ORDER → nothing extra; SO spend is tracked separately
 */
export function ChargeCodingFields({
  defaults,
  projects,
  wbsElements,
  budgets,
}: {
  defaults: {
    chargeType: string;
    projectId: string;
    wbsElementId: string;
    budgetId: string;
  };
  projects: { id: string; number: string; name: string }[];
  wbsElements: {
    id: string;
    code: string;
    name: string;
    projectId: string | null;
  }[];
  budgets: {
    id: string;
    number: string;
    name: string;
    chargeCode: string | null;
  }[];
}) {
  const [chargeType, setChargeType] = useState(defaults.chargeType);
  const [projectId, setProjectId] = useState(defaults.projectId);

  const isProject = chargeType === "PROGRAM";
  const isSalesOrder = chargeType === "SALES_ORDER";
  const wbsForProject = wbsElements.filter(
    (w) => !projectId || w.projectId === projectId
  );

  return (
    <>
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Charge type
        </label>
        <select
          name="chargeType"
          className={selectClass}
          value={chargeType}
          onChange={(e) => setChargeType(e.target.value)}
        >
          <option value="PROGRAM">PROGRAM (project / WBS)</option>
          <option value="SALES_ORDER">SALES_ORDER</option>
          <option value="DIRECT">DIRECT</option>
          <option value="INDIRECT">INDIRECT</option>
        </select>
      </div>

      {isProject && (
        <>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Project
            </label>
            <select
              name="projectId"
              className={selectClass}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              WBS
            </label>
            <select
              name="wbsElementId"
              className={selectClass}
              defaultValue={defaults.wbsElementId}
            >
              <option value="">— None —</option>
              {wbsForProject.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {!isProject && !isSalesOrder && (
        <div className="space-y-1 sm:col-span-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Charge code (budget)
          </label>
          <select
            name="budgetId"
            className={selectClass}
            defaultValue={defaults.budgetId}
          >
            <option value="">— Pick a charge code —</option>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.chargeCode || b.number} — {b.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-500">
            Accounting maps this charge code into the GL — no GL pick needed
            here.
          </p>
        </div>
      )}

      {isSalesOrder && (
        <p className="self-end pb-2 text-[11px] text-slate-500 sm:col-span-2">
          Charged to the linked sales order — accounting tracks spend per SO
          separately to watch profit / loss.
        </p>
      )}
    </>
  );
}
