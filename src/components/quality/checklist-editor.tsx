"use client";

import { useState } from "react";
import { Plus, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ChecklistItem = { label: string; checked: boolean };

/**
 * Editable checklist used for broken-tool piece recovery, tool-report next
 * steps, and inspection/audit step templates. Items serialize to a hidden
 * field ({labelKey, checkedKey}) so the surrounding server-action form can
 * persist them. `labelKey`/`checkedKey` map onto whatever JSON shape the
 * backing model expects (e.g. piece/gathered, step/done).
 */
export function ChecklistEditor({
  action,
  hiddenFields,
  fieldName,
  labelKey,
  checkedKey,
  initial,
  addPlaceholder = "Add item…",
  checkedLabel = "done",
  submitLabel = "Save",
  readOnly = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  fieldName: string;
  labelKey: string;
  checkedKey: string;
  initial: ChecklistItem[];
  addPlaceholder?: string;
  checkedLabel?: string;
  submitLabel?: string;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initial);
  const [draft, setDraft] = useState("");

  const serialized = JSON.stringify(items.map((it) => ({ [labelKey]: it.label, [checkedKey]: it.checked })));

  function add() {
    const label = draft.trim();
    if (!label) return;
    setItems((xs) => [...xs, { label, checked: false }]);
    setDraft("");
  }

  return (
    <form action={action} className="space-y-2">
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name={fieldName} value={serialized} />

      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={it.checked}
              disabled={readOnly}
              onChange={(e) => setItems((xs) => xs.map((x, idx) => (idx === i ? { ...x, checked: e.target.checked } : x)))}
            />
            <span className={`flex-1 ${it.checked ? "text-slate-500 line-through" : "text-slate-200"}`}>{it.label}</span>
            <span className="text-[10px] uppercase text-slate-500">{it.checked ? checkedLabel : ""}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setItems((xs) => xs.filter((_, idx) => idx !== i))}
                className="text-slate-600 hover:text-rose-400"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-500">Nothing yet.</p>}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={addPlaceholder}
            className="h-8"
          />
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Button type="submit" size="sm" className="h-8">
        <Check className="mr-1 h-3.5 w-3.5" /> {submitLabel}
      </Button>
    </form>
  );
}
