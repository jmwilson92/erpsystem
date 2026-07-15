"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionRecordTestSignOff } from "@/app/actions";
import { Camera } from "lucide-react";

/**
 * Follow-along execution of one released test-procedure step: record a
 * measurement, optionally attach a photo, and PIN-verify. PASS/FAIL is graded
 * server-side against the step's min/max.
 */
export function TestStepRecord({
  testProcedureId,
  stepId,
  hasSpec,
  units,
}: {
  testProcedureId: string;
  stepId: string;
  hasSpec: boolean;
  units?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string>("");

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    setPhoto(url);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (photo) fd.set("photoUrl", photo);
    start(async () => {
      try {
        await actionRecordTestSignOff(fd);
        (e.target as HTMLFormElement).reset();
        setPhoto("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="testProcedureId" value={testProcedureId} />
      <input type="hidden" name="stepId" value={stepId} />
      <Input
        name="measuredValue"
        type="number"
        step="any"
        placeholder={units ? `Value (${units})` : "Measured value"}
        className="h-8 w-28 text-xs"
      />
      {!hasSpec && (
        <select
          name="result"
          defaultValue="PASS"
          className="h-8 rounded-md border border-slate-700 bg-slate-950 px-1 text-xs text-slate-200"
        >
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="NA">N/A</option>
        </select>
      )}
      <Input name="unitSerial" placeholder="Unit S/N" className="h-8 w-24 text-xs" />
      <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-teal-500/40">
        <Camera className="h-3.5 w-3.5" />
        {photo ? "✓" : "Photo"}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files)} />
      </label>
      <Input name="pinCode" type="password" placeholder="PIN" className="h-8 w-16 text-xs" required />
      <Button type="submit" size="sm" className="h-8" disabled={pending}>
        {pending ? "…" : "Record"}
      </Button>
      {error && <span className="text-[11px] text-rose-400">{error}</span>}
    </form>
  );
}
