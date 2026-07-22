"use client";

import { useState } from "react";
import { Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Step = { label: string };
type Finding = "OK" | "NCR" | "OFI";
type Row = {
  label: string;
  finding: Finding;
  note: string;
  photoUrl: string;
  photoName: string;
  correctiveAction: string;
  reinspectBy: string;
};

const OPTIONS: { value: Finding; label: string; cls: string }[] = [
  { value: "OK", label: "OK", cls: "bg-emerald-500/20 text-emerald-300" },
  { value: "OFI", label: "OFI", cls: "bg-sky-500/20 text-sky-300" },
  { value: "NCR", label: "NCR", cls: "bg-rose-500/20 text-rose-300" },
];

/**
 * Run an internal audit through the program template. Each clause is OK, an OFI
 * (logged), or an NCR (which captures a corrective action + reinspect-by date).
 * Saving records the run and opens tracked findings for every NCR/OFI.
 */
export function AuditRunner({
  action,
  hiddenFields,
  steps,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  steps: Step[];
}) {
  const [rows, setRows] = useState<Row[]>(
    steps.map((s) => ({ label: s.label, finding: "OK", note: "", photoUrl: "", photoName: "", correctiveAction: "", reinspectBy: "" }))
  );
  const [notes, setNotes] = useState("");

  function set(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onPhoto(i: number, files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    set(i, { photoUrl: url, photoName: f.name });
  }

  const ncrs = rows.filter((r) => r.finding === "NCR").length;
  const ofis = rows.filter((r) => r.finding === "OFI").length;

  if (steps.length === 0) {
    return <p className="text-sm text-slate-500">No audit template yet — define the clauses above, then run the audit.</p>;
  }

  return (
    <form action={action} className="space-y-2">
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="results" value={JSON.stringify(rows)} />
      <input type="hidden" name="notes" value={notes} />

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm text-slate-200">{r.label}</span>
              <div className="flex overflow-hidden rounded-md border border-slate-700">
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set(i, { finding: o.value })}
                    className={`px-2 py-1 text-[11px] font-medium ${r.finding === o.value ? o.cls : "text-slate-400"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-teal-500/40">
                <Camera className="h-3.5 w-3.5" />
                {r.photoName ? "✓" : "Photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(i, e.target.files)} />
              </label>
            </div>
            <input
              value={r.note}
              onChange={(e) => set(i, { note: e.target.value })}
              placeholder="Objective evidence / note"
              className="mt-1.5 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            />
            {r.finding === "NCR" && (
              <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded border border-rose-500/30 bg-rose-500/5 p-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-slate-500">Corrective action</label>
                  <Input
                    value={r.correctiveAction}
                    onChange={(e) => set(i, { correctiveAction: e.target.value })}
                    placeholder="What will be done"
                    className="h-8"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-slate-500">Reinspect by</label>
                  <Input
                    type="date"
                    value={r.reinspectBy}
                    onChange={(e) => set(i, { reinspectBy: e.target.value })}
                    className="h-8"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Audit summary (optional)" rows={2} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">
          <Check className="mr-1 h-3.5 w-3.5" /> Save audit
        </Button>
        <span className="text-xs text-slate-500">
          {ncrs > 0 && <span className="text-rose-400">{ncrs} NCR</span>}
          {ncrs > 0 && ofis > 0 && " · "}
          {ofis > 0 && <span className="text-sky-400">{ofis} OFI</span>}
          {ncrs === 0 && ofis === 0 && "no findings"}
        </span>
      </div>
    </form>
  );
}
