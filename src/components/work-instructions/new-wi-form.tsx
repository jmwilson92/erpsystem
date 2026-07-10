"use client";

import { useState } from "react";
import { actionCreateWorkInstruction } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Plus, Trash2 } from "lucide-react";

type StepDraft = {
  title: string;
  instructions: string;
  stepType: "BUILD" | "QA" | "TEST";
  passFail: boolean;
  uom: string;
  expected: string;
  cure: string;
  area: string;
  wc: string;
  photos: { url: string; name: string }[];
};

type ToolDraft = {
  name: string;
  partId: string;
  qty: string;
};

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function emptyStep(): StepDraft {
  return {
    title: "",
    instructions: "",
    stepType: "BUILD",
    passFail: false,
    uom: "",
    expected: "",
    cure: "",
    area: "",
    wc: "",
    photos: [],
  };
}

export function NewWiForm({
  parts,
  toolParts,
  boms,
  uoms,
  workCenters,
}: {
  parts: { id: string; partNumber: string; description: string }[];
  toolParts: { id: string; partNumber: string; description: string }[];
  boms: { id: string; label: string }[];
  uoms: { id: string; code: string; name: string }[];
  workCenters: { code: string; name: string; area: string }[];
}) {
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const [tools, setTools] = useState<ToolDraft[]>([
    { name: "", partId: "", qty: "1" },
  ]);

  function update(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function updateTool(i: number, patch: Partial<ToolDraft>) {
    setTools((prev) =>
      prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t))
    );
  }

  async function onStepPhotos(i: number, files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; name: string }[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      next.push({ url, name: file.name });
    }
    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === i
          ? { ...s, photos: [...s.photos, ...next].slice(0, 8) }
          : s
      )
    );
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
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Drawing number
            </label>
            <Input
              name="drawingNumber"
              className="mt-1 font-mono"
              placeholder="DWG-1000-A"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Additional drawing references
            </label>
            <Input
              name="drawingReferences"
              className="mt-1"
              placeholder="Sheet 2, zone B4; Spec XYZ…"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Hazmat / PPE required
            </label>
            <Textarea
              name="hazmatRequired"
              rows={2}
              className="mt-1"
              placeholder="e.g. Isopropyl alcohol, nitrile gloves, Class 2 solvent cabinet…"
            />
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
            <span>Required tools</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setTools((p) => [...p, { name: "", partId: "", qty: "1" }])
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add tool
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            Link tools to inventory items when possible. If a linked tool is not
            in stock, a purchase request is created automatically with the WI as
            the trigger.
          </p>
          {tools.map((t, i) => (
            <div
              key={i}
              className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-12"
            >
              <div className="sm:col-span-4">
                {i === 0 && (
                  <label className="text-[10px] uppercase text-slate-600">
                    Tool name
                  </label>
                )}
                <Input
                  name={`tool_name_${i}`}
                  className={i === 0 ? "mt-1" : ""}
                  placeholder="Torque wrench 10–50 in-lb"
                  value={t.name}
                  onChange={(e) => updateTool(i, { name: e.target.value })}
                />
              </div>
              <div className="sm:col-span-5">
                {i === 0 && (
                  <label className="text-[10px] uppercase text-slate-600">
                    Inventory item (optional)
                  </label>
                )}
                <select
                  name={`tool_partId_${i}`}
                  className={`${selectClass} ${i === 0 ? "mt-1" : ""}`}
                  value={t.partId}
                  onChange={(e) => {
                    const partId = e.target.value;
                    const part = toolParts.find((p) => p.id === partId);
                    updateTool(i, {
                      partId,
                      name: t.name || part?.description || part?.partNumber || "",
                    });
                  }}
                >
                  <option value="">— Free-text only —</option>
                  {toolParts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} — {p.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                {i === 0 && (
                  <label className="text-[10px] uppercase text-slate-600">
                    Qty
                  </label>
                )}
                <Input
                  name={`tool_qty_${i}`}
                  type="number"
                  min={1}
                  className={i === 0 ? "mt-1" : ""}
                  value={t.qty}
                  onChange={(e) => updateTool(i, { qty: e.target.value })}
                />
              </div>
              <div className="flex items-end sm:col-span-1">
                {tools.length > 1 && (
                  <button
                    type="button"
                    className="mb-1 text-rose-400"
                    onClick={() => setTools((p) => p.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
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
              onClick={() => setSteps((p) => [...p, emptyStep()])}
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
              className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
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
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Step type *
                  </label>
                  <select
                    name={`step_type_${i}`}
                    className={`${selectClass} mt-0.5`}
                    value={st.stepType}
                    onChange={(e) => {
                      const stepType = e.target.value as StepDraft["stepType"];
                      update(i, {
                        stepType,
                        passFail: stepType === "QA" || stepType === "TEST",
                        area:
                          stepType === "QA"
                            ? "QA"
                            : stepType === "TEST"
                              ? "TEST"
                              : st.area || "MANUFACTURING",
                      });
                    }}
                  >
                    <option value="BUILD">Build (manufacturing)</option>
                    <option value="QA">QA</option>
                    <option value="TEST">Test</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    name={`step_passfail_${i}`}
                    checked={st.passFail}
                    onChange={(e) => update(i, { passFail: e.target.checked })}
                  />
                  Pass / Fail required
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

              {/* Photos */}
              <div className="rounded border border-slate-800 p-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
                  <Camera className="h-3.5 w-3.5" />
                  Add photo / picture
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={(e) => onStepPhotos(i, e.target.files)}
                  />
                </label>
                {st.photos.map((ph, pi) => (
                  <input
                    key={pi}
                    type="hidden"
                    name={`step_photo_${i}_${pi}`}
                    value={ph.url}
                  />
                ))}
                {st.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {st.photos.map((ph, pi) => (
                      <div key={pi} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ph.url}
                          alt={ph.name}
                          className="h-16 w-16 rounded border border-slate-700 object-cover"
                        />
                        <button
                          type="button"
                          className="absolute -right-1 -top-1 rounded bg-rose-600 px-1 text-[10px] text-white"
                          onClick={() =>
                            update(i, {
                              photos: st.photos.filter((_, j) => j !== pi),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button type="submit">Create work instruction</Button>
    </form>
  );
}
