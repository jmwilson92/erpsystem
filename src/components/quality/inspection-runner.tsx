"use client";

import { useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Step = { label: string };
type Row = { label: string; ok: boolean; note: string; photoUrl: string; photoName: string };

/**
 * Walk a station/zone through the program's inspection template: pass/fail each
 * step, add a note, and attach a photo. Saving snapshots the whole run to the
 * inspection history (server action).
 */
export function InspectionRunner({
  action,
  hiddenFields,
  steps,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  steps: Step[];
}) {
  const [rows, setRows] = useState<Row[]>(
    steps.map((s) => ({ label: s.label, ok: true, note: "", photoUrl: "", photoName: "" }))
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

  const passed = rows.every((r) => r.ok);

  if (steps.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No inspection template yet — define the steps above, then run the inspection.
      </p>
    );
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
                <button
                  type="button"
                  onClick={() => set(i, { ok: true })}
                  className={`px-2 py-1 text-xs ${r.ok ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400"}`}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => set(i, { ok: false })}
                  className={`px-2 py-1 text-xs ${!r.ok ? "bg-rose-500/20 text-rose-300" : "text-slate-400"}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-teal-500/40">
                <Camera className="h-3.5 w-3.5" />
                {r.photoName ? "Photo ✓" : "Photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(i, e.target.files)} />
              </label>
            </div>
            <input
              value={r.note}
              onChange={(e) => set(i, { note: e.target.value })}
              placeholder="Note (optional)"
              className="mt-1.5 h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            />
          </div>
        ))}
      </div>

      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Overall notes (optional)" rows={2} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          <Check className="mr-1 h-3.5 w-3.5" /> Save inspection
        </Button>
        <span className={`text-xs ${passed ? "text-emerald-400" : "text-amber-400"}`}>
          {rows.filter((r) => r.ok).length}/{rows.length} pass
        </span>
      </div>
    </form>
  );
}
