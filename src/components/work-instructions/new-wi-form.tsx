"use client";

import { useState } from "react";
import { actionCreateWorkInstruction } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";

type StepDraft = {
  title: string;
  instructions: string;
  passFail: boolean;
  test: boolean;
  uom: string;
  expected: string;
  cure: string;
  area: string;
  wc: string;
};

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export function NewWiForm({
  parts,
  boms,
  uoms,
  workCenters,
}: {
  parts: { id: string; partNumber: string; description: string }[];
  boms: { id: string; label: string }[];
  uoms: { id: string; code: string; name: string }[];
  workCenters: { code: string; name: string; area: string }[];
}) {
  const [steps, setSteps] = useState<StepDraft[]>([
    {
      title: "",
      instructions: "",
      passFail: false,
      test: false,
      uom: "",
      expected: "",
      cure: "",
      area: "",
      wc: "",
    },
  ]);

  function update(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <form action={actionCreateWorkInstruction} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Document # *
            </label>
            <Input
              name="documentNumber"
              required
              className="mt-1 font-mono"
              placeholder="WI-ASM-1000"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Revision
            </label>
            <Input name="revision" defaultValue="A" className="mt-1 font-mono" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Title *
            </label>
            <Input name="title" required className="mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">Part</label>
            <select name="partId" className={`${selectClass} mt-1`}>
              <option value="">— Optional —</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNumber} — {p.description}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Planned BOM link
            </label>
            <select name="bomHeaderId" className={`${selectClass} mt-1`}>
              <option value="">— After CM release —</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">Notes</label>
            <Textarea name="notes" rows={2} className="mt-1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Steps</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setSteps((p) => [
                  ...p,
                  {
                    title: "",
                    instructions: "",
                    passFail: false,
                    test: false,
                    uom: "",
                    expected: "",
                    cure: "",
                    area: "",
                    wc: "",
                  },
                ])
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add step
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {steps.map((st, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-teal-400">
                  Step {i + 1}
                </span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    className="text-rose-400"
                    onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Input
                name={`step_title_${i}`}
                required
                placeholder="Step title"
                value={st.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <Textarea
                name={`step_instructions_${i}`}
                rows={2}
                placeholder="Instructions…"
                value={st.instructions}
                onChange={(e) => update(i, { instructions: e.target.value })}
              />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    name={`step_passfail_${i}`}
                    checked={st.passFail}
                    onChange={(e) => update(i, { passFail: e.target.checked })}
                  />
                  Pass / Fail required
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    name={`step_test_${i}`}
                    checked={st.test}
                    onChange={(e) => update(i, { test: e.target.checked })}
                  />
                  Test / measurement step
                </label>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Measure UOM
                  </label>
                  <select
                    name={`step_uom_${i}`}
                    className={`${selectClass} mt-0.5`}
                    value={st.uom}
                    onChange={(e) => update(i, { uom: e.target.value })}
                  >
                    <option value="">—</option>
                    {uoms.map((u) => (
                      <option key={u.id} value={u.code}>
                        {u.code} — {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Expected
                  </label>
                  <Input
                    name={`step_expected_${i}`}
                    className="mt-0.5 h-9"
                    value={st.expected}
                    onChange={(e) => update(i, { expected: e.target.value })}
                    placeholder="e.g. &lt;0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Cure time (min)
                  </label>
                  <Input
                    name={`step_cure_${i}`}
                    type="number"
                    className="mt-0.5 h-9"
                    value={st.cure}
                    onChange={(e) => update(i, { cure: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Area
                  </label>
                  <select
                    name={`step_area_${i}`}
                    className={`${selectClass} mt-0.5`}
                    value={st.area}
                    onChange={(e) => update(i, { area: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="MANUFACTURING">Manufacturing</option>
                    <option value="QA">QA</option>
                    <option value="TEST">Test</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Station
                  </label>
                  <select
                    name={`step_wc_${i}`}
                    className={`${selectClass} mt-0.5`}
                    value={st.wc}
                    onChange={(e) => update(i, { wc: e.target.value })}
                  >
                    <option value="">—</option>
                    {workCenters.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-600">
            Need a measurement UOM (VDC, OHM, mΩ…)? Add it under{" "}
            <a href="/uom" className="text-sky-400 hover:underline">
              UOM master
            </a>{" "}
            (category ELECTRICAL / MEASURE).
          </p>
        </CardContent>
      </Card>

      <Button type="submit">Create work instruction</Button>
    </form>
  );
}
