"use client";

import { useState } from "react";
import { ClipboardCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Tool = { id: string; identifier: string; name: string };
type Row = { toolId: string; identifier: string; name: string; present: boolean; ok: boolean; note: string };

/**
 * Run a tool check on a toolbox: tick each tool present + OK as you verify it.
 * On save the whole checklist is snapshotted to the toolbox's inspection
 * history (a server action) so auditors can pull the report later.
 */
export function ToolboxInspectionPanel({
  toolboxId,
  tools,
  action,
}: {
  toolboxId: string;
  tools: Tool[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(
    tools.map((t) => ({ toolId: t.id, identifier: t.identifier, name: t.name, present: true, ok: true, note: "" }))
  );
  const [notes, setNotes] = useState("");

  const allGood = rows.every((r) => r.present && r.ok);

  function set(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  if (tools.length === 0) return null;

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Start inspection
      </Button>
    );
  }

  return (
    <form action={action} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <input type="hidden" name="toolboxId" value={toolboxId} />
      <input type="hidden" name="results" value={JSON.stringify(rows)} />
      <input type="hidden" name="notes" value={notes} />
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Tool check — tick each tool as you verify it
      </p>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={r.toolId} className="flex flex-wrap items-center gap-3 rounded border border-slate-800/60 px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-mono text-xs text-teal-400">{r.identifier}</span>
              <span className="ml-2 text-slate-300">{r.name}</span>
            </span>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={r.present} onChange={(e) => set(i, { present: e.target.checked })} />
              Present
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={r.ok}
                onChange={(e) => set(i, { ok: e.target.checked })}
                disabled={!r.present}
              />
              Good condition
            </label>
            <input
              value={r.note}
              onChange={(e) => set(i, { note: e.target.value })}
              placeholder="note"
              className="h-7 w-28 rounded border border-slate-700 bg-slate-950 px-1.5 text-xs text-slate-200"
            />
          </div>
        ))}
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Overall notes (optional)"
        rows={2}
        className="mt-2"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm" className="h-8">
          <Check className="mr-1 h-3.5 w-3.5" /> Save inspection
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className={`text-xs ${allGood ? "text-emerald-400" : "text-amber-400"}`}>
          {rows.filter((r) => r.present && r.ok).length}/{rows.length} verified
        </span>
      </div>
    </form>
  );
}
