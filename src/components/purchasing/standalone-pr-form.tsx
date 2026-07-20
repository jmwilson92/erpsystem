"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateStandalonePr } from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { Plus, Trash2 } from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

type PartOpt = {
  id: string;
  partNumber: string;
  description: string;
  standardCost: number;
  uom: string;
};
type SupplierOpt = { id: string; code: string; name: string };
type ProjectOpt = { id: string; number: string; name: string };
type WbsOpt = {
  id: string;
  code: string;
  name: string;
  projectId: string;
};
type BudgetOpt = {
  id: string;
  chargeCode: string | null;
  name: string;
  status: string;
  sourceType?: string | null;
  costClass?: string | null;
};

type Line = {
  partId: string;
  description: string;
  quantity: string;
  estimatedUnitCost: string;
  uom: string;
  notes: string;
};

type Purpose = "MANUFACTURING" | "PROJECT" | "FACILITIES" | "OTHER";

const emptyLine = (): Line => ({
  partId: "",
  description: "",
  quantity: "1",
  estimatedUnitCost: "",
  uom: "EA",
  notes: "",
});

export function StandalonePrForm({
  parts,
  suppliers,
  projects,
  wbsElements,
  budgets,
  departments = [],
}: {
  parts: PartOpt[];
  suppliers: SupplierOpt[];
  projects: ProjectOpt[];
  wbsElements: WbsOpt[];
  budgets: BudgetOpt[];
  departments?: string[];
}) {
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [projectId, setProjectId] = useState("");
  // Default to general company buy (office/facility) — most ad-hoc PRs
  const [purpose, setPurpose] = useState<Purpose>("FACILITIES");

  const requiresCatalog =
    purpose === "MANUFACTURING" || purpose === "PROJECT";
  const isGeneralCompany =
    purpose === "FACILITIES" || purpose === "OTHER";

  const partById = useMemo(() => {
    const m = new Map(parts.map((p) => [p.id, p]));
    return m;
  }, [parts]);

  const filteredWbs = projectId
    ? wbsElements.filter((w) => w.projectId === projectId)
    : wbsElements;

  /** Facilities / other: prefer standalone / indirect budgets */
  const shownBudgets = useMemo(() => {
    if (requiresCatalog) {
      return budgets.filter(
        (b) =>
          b.sourceType === "PROJECT" ||
          b.sourceType === "FORECAST" ||
          b.costClass === "DIRECT" ||
          !b.sourceType
      );
    }
    return budgets.filter(
      (b) =>
        b.sourceType === "STANDALONE" ||
        b.costClass === "INDIRECT" ||
        !b.sourceType
    );
  }, [budgets, requiresCatalog]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  }

  function onPartChange(i: number, partId: string) {
    const p = partById.get(partId);
    if (!p) {
      updateLine(i, { partId: "" });
      return;
    }
    updateLine(i, {
      partId,
      description: `${p.partNumber} — ${p.description}`,
      estimatedUnitCost:
        p.standardCost > 0
          ? String(p.standardCost)
          : lines[i].estimatedUnitCost,
      uom: p.uom || "EA",
    });
  }

  const estimate = lines.reduce((s, l) => {
    const q = Number(l.quantity) || 0;
    const c = Number(l.estimatedUnitCost) || 0;
    return s + q * c;
  }, 0);

  const chargeTypeDefault =
    purpose === "PROJECT"
      ? "PROGRAM"
      : purpose === "MANUFACTURING"
        ? "DIRECT"
        : "INDIRECT";

  return (
    <ActionLoadingForm
      theme="purchasing"
      action={actionCreateStandalonePr}
      className="space-y-6"
    >
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="chargeType" value={chargeTypeDefault} />

      <div className="rounded border border-slate-800 bg-slate-950/50 p-3">
        <p className="text-[10px] font-semibold uppercase text-slate-500">
          What is this PR for? *
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                id: "FACILITIES" as const,
                title: "Office / facility (general)",
                detail:
                  "Chairs, tables, office supplies, building — no project, no catalog required",
              },
              {
                id: "OTHER" as const,
                title: "Company / overhead budget",
                detail:
                  "Any non-job buy on a charge code or standalone budget — describe what you need",
              },
              {
                id: "MANUFACTURING" as const,
                title: "Manufacturing",
                detail: "Production / shop floor material — catalog parts only",
              },
              {
                id: "PROJECT" as const,
                title: "Project / program",
                detail: "Charged to project or WBS — catalog parts only",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPurpose(opt.id)}
              className={`rounded border px-3 py-2 text-left text-sm transition ${
                purpose === opt.id
                  ? "border-teal-600 bg-teal-950/40 text-teal-100"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-600"
              }`}
            >
              <span className="font-medium">{opt.title}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                {opt.detail}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {requiresCatalog ? (
            <>
              <span className="text-amber-400">Catalog required:</span> every
              line must pick a part from the item catalog. Free-text-only lines
              are not allowed for manufacturing or project activity.
            </>
          ) : (
            <>
              <span className="text-sky-400">General company buy:</span> just
              describe the item (e.g. “ergonomic office chair”, “conference
              table”). No vendor, project, or catalog part required — purchasing
              can source later. Optional budget/charge code if you have one.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Department
          </label>
          {departments.length ? (
            <select name="department" className={`${selectClass} mt-1`}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <Input
              name="department"
              className="mt-1"
              placeholder={
                isGeneralCompany
                  ? "e.g. Facilities, Admin, HR"
                  : "e.g. Production, Engineering"
              }
            />
          )}
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Needed by
          </label>
          <Input name="neededBy" type="date" className="mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Preferred supplier / vendor (optional)
          </label>
          <select name="supplierId" className={`${selectClass} mt-1`}>
            <option value="">
              {isGeneralCompany
                ? "— None · purchasing will source —"
                : "— Buyer to source —"}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          {isGeneralCompany && (
            <p className="mt-1 text-[10px] text-slate-600">
              Leave blank for chairs, furniture, supplies, etc. — vendor is
              chosen later when converting to PO.
            </p>
          )}
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Charge type
          </label>
          <div className={`${selectClass} mt-1 flex items-center text-slate-400`}>
            {chargeTypeDefault}
            <span className="ml-2 text-[10px]">
              {isGeneralCompany ? "(company overhead)" : "(from purpose)"}
            </span>
          </div>
        </div>
        {purpose === "PROJECT" && (
          <>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Project *
              </label>
              <select
                name="projectId"
                required
                className={`${selectClass} mt-1`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                WBS element (optional)
              </label>
              <select name="wbsElementId" className={`${selectClass} mt-1`}>
                <option value="">— none —</option>
                {filteredWbs.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {purpose !== "PROJECT" && (
          <input type="hidden" name="projectId" value="" />
        )}
        <div className="flex flex-col justify-end sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-500">
            {requiresCatalog
              ? "Job / project budget (optional)"
              : "Standalone / overhead charge budget (optional)"}
          </label>
          <select name="budgetId" className={`${selectClass} mt-1`}>
            <option value="">— none —</option>
            {shownBudgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.chargeCode || b.name} · {b.name} ({b.status})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-500">
            Justification *
          </label>
          <Textarea
            name="justification"
            required
            rows={3}
            className="mt-1"
            placeholder={
              isGeneralCompany
                ? "e.g. New hires need desks and chairs for open office row B"
                : "Why is this needed?"
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-200">
            Line items{" "}
            {requiresCatalog ? (
              <span className="text-xs font-normal text-amber-400">
                · catalog parts only
              </span>
            ) : (
              <span className="text-xs font-normal text-sky-400">
                · describe what to buy (no catalog needed)
              </span>
            )}
          </p>
          <p className="text-xs tabular-nums text-slate-500">
            Est. total ${estimate.toFixed(2)}
          </p>
        </div>

        <input type="hidden" name="lineCount" value={lines.length} />

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid gap-2 rounded border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-12"
            >
              {requiresCatalog ? (
                <div className="flex flex-col justify-end sm:col-span-5">
                  <label className="text-[10px] uppercase text-slate-500">
                    Catalog part *
                  </label>
                  <select
                    name={`partId_${i}`}
                    required
                    className={`${selectClass} mt-1`}
                    value={line.partId}
                    onChange={(e) => onPartChange(i, e.target.value)}
                  >
                    <option value="">— Select catalog part —</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber} · {p.description}
                      </option>
                    ))}
                  </select>
                  <input
                    type="hidden"
                    name={`description_${i}`}
                    value={line.description}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col justify-end sm:col-span-3">
                    <label className="text-[10px] uppercase text-slate-500">
                      Catalog part (optional)
                    </label>
                    <select
                      name={`partId_${i}`}
                      className={`${selectClass} mt-1`}
                      value={line.partId}
                      onChange={(e) => onPartChange(i, e.target.value)}
                    >
                      <option value="">— free text —</option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.partNumber} · {p.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end sm:col-span-4">
                    <label className="text-[10px] uppercase text-slate-500">
                      Description *
                    </label>
                    <Input
                      name={`description_${i}`}
                      required
                      className="mt-1"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(i, { description: e.target.value })
                      }
                      placeholder={
                        isGeneralCompany
                          ? "e.g. Office chair, black, adjustable"
                          : "Service or non-catalog item"
                      }
                    />
                  </div>
                </>
              )}
              <div className="flex flex-col justify-end sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Qty *
                </label>
                <Input
                  name={`quantity_${i}`}
                  type="number"
                  min={0.0001}
                  step="any"
                  required
                  className="mt-1 tabular-nums"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
              </div>
              <div className="flex flex-col justify-end sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Unit $
                </label>
                <Input
                  name={`cost_${i}`}
                  type="number"
                  min={0}
                  step="0.01"
                  className="mt-1 tabular-nums"
                  value={line.estimatedUnitCost}
                  onChange={(e) =>
                    updateLine(i, { estimatedUnitCost: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col justify-end sm:col-span-1">
                <label className="text-[10px] uppercase text-slate-500">
                  UOM
                </label>
                <Input
                  name={`uom_${i}`}
                  className="mt-1"
                  value={line.uom}
                  onChange={(e) => updateLine(i, { uom: e.target.value })}
                />
              </div>
              <div className="sm:col-span-11">
                <label className="text-[10px] uppercase text-slate-500">
                  Line notes
                </label>
                <Input
                  name={`notes_${i}`}
                  className="mt-1"
                  value={line.notes}
                  onChange={(e) => updateLine(i, { notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-rose-400"
                  disabled={lines.length <= 1}
                  onClick={() =>
                    setLines((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add line
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <Button type="submit" name="submitMode" value="submit">
          Create &amp; submit for approval
        </Button>
        <Button
          type="submit"
          name="submitMode"
          value="draft"
          variant="secondary"
        >
          Save as draft
        </Button>
      </div>
    </ActionLoadingForm>
  );
}
