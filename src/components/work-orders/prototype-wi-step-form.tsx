"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StepPhotoFields } from "@/components/work-instructions/step-photo-fields";
import { actionAddPrototypeWiStep } from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

type TestProcOption = {
  id: string;
  number: string;
  revision: string;
  title: string;
  status: string;
};

type UomOption = { id: string; code: string; name: string };

/**
 * Prototype build: capture WI steps (build / QA / test) with photos and
 * measurement criteria as the unit is assembled.
 */
export function PrototypeWiStepForm({
  workOrderId,
  testProcedures = [],
  measureUoms = [],
}: {
  workOrderId: string;
  testProcedures?: TestProcOption[];
  measureUoms?: UomOption[];
}) {
  const [stepType, setStepType] = useState<"BUILD" | "QA" | "TEST">("BUILD");
  const showTestFields = stepType === "QA" || stepType === "TEST";

  return (
    <ActionLoadingForm
      theme="manufacturing"
      action={actionAddPrototypeWiStep}
      className="grid gap-2 sm:grid-cols-2"
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <div className="sm:col-span-2">
        <label className="text-[10px] uppercase text-slate-500">
          Step title *
        </label>
        <Input
          name="title"
          required
          className="mt-1"
          placeholder="e.g. Torque housing bolts / Idle current check"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="text-[10px] uppercase text-slate-500">
          Instructions *
        </label>
        <Textarea
          name="instructions"
          required
          rows={3}
          className="mt-1"
          placeholder="What the operator does… include tooling, torque, ESD notes"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase text-slate-500">Type</label>
        <select
          name="stepType"
          className={`${selectClass} mt-1`}
          value={stepType}
          onChange={(e) =>
            setStepType(e.target.value as "BUILD" | "QA" | "TEST")
          }
        >
          <option value="BUILD">Build (manufacturing)</option>
          <option value="QA">QA inspection</option>
          <option value="TEST">Test / measurement</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase text-slate-500">
          Est. minutes
        </label>
        <Input
          name="estimatedMinutes"
          type="number"
          defaultValue={15}
          min={1}
          className="mt-1"
        />
      </div>

      {showTestFields && (
        <>
          <div className="sm:col-span-2 rounded border border-amber-900/40 bg-amber-950/20 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase text-amber-400/90">
              Test / QA criteria
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
                <input
                  type="checkbox"
                  name="passFailRequired"
                  defaultChecked
                  className="rounded border-slate-600"
                />
                Pass / Fail required on sign-off
              </label>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Acceptance criteria
                </label>
                <Textarea
                  name="testCriteria"
                  rows={2}
                  className="mt-1"
                  placeholder="e.g. Continuity &lt; 1 Ω end-to-end; no shorts to chassis"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Expected value
                </label>
                <Input
                  name="expectedValue"
                  className="mt-1"
                  placeholder="e.g. 28.0"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Measure UOM
                </label>
                <select name="measureUom" className={`${selectClass} mt-1`}>
                  <option value="">—</option>
                  {measureUoms.map((u) => (
                    <option key={u.id} value={u.code}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                  {/* common free codes if UOM master empty */}
                  {!measureUoms.length && (
                    <>
                      <option value="VDC">VDC</option>
                      <option value="VAC">VAC</option>
                      <option value="A">A</option>
                      <option value="mA">mA</option>
                      <option value="OHM">OHM</option>
                      <option value="C">°C</option>
                      <option value="PSI">PSI</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Min
                </label>
                <Input
                  name="minValue"
                  type="number"
                  step="any"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Max
                </label>
                <Input
                  name="maxValue"
                  type="number"
                  step="any"
                  className="mt-1"
                />
              </div>
              {testProcedures.length > 0 && (
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Link existing test procedure (optional)
                  </label>
                  <select
                    name="testProcedureId"
                    className={`${selectClass} mt-1`}
                    defaultValue=""
                  >
                    <option value="">— none —</option>
                    {testProcedures.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.number} Rev {tp.revision} · {tp.title} ({tp.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Area
                </label>
                <select
                  name="requiredArea"
                  className={`${selectClass} mt-1`}
                  defaultValue={stepType === "TEST" ? "TEST" : "QA"}
                >
                  <option value="TEST">Test</option>
                  <option value="QA">QA</option>
                  <option value="MANUFACTURING">Manufacturing</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="sm:col-span-2">
        <p className="mb-1 text-[10px] uppercase text-slate-500">
          Step photos (assembly setup, torque map, test setup…)
        </p>
        <StepPhotoFields max={8} />
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" variant="secondary">
          Add step to prototype WI
        </Button>
      </div>
    </ActionLoadingForm>
  );
}
