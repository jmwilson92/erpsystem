"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

export type PartOption = {
  id: string;
  partNumber: string;
  description: string;
  standardCost: number;
};

type LineRow = {
  key: string;
  partId: string;
  quantity: string;
  unitPrice: string;
};

function newRow(defaultPartId = ""): LineRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    partId: defaultPartId,
    quantity: "",
    unitPrice: "",
  };
}

export function SalesLineItemsEditor({
  parts,
  defaultPartId = "",
  initialRows = 4,
}: {
  parts: PartOption[];
  defaultPartId?: string;
  initialRows?: number;
}) {
  const [rows, setRows] = useState<LineRow[]>(() =>
    Array.from({ length: initialRows }, () => newRow(defaultPartId))
  );

  function addRow() {
    setRows((r) => [...r, newRow(defaultPartId)]);
  }

  function removeRow(key: string) {
    setRows((r) => (r.length <= 1 ? r : r.filter((x) => x.key !== key)));
  }

  function updateRow(key: string, patch: Partial<LineRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function onPartChange(key: string, partId: string) {
    const part = parts.find((p) => p.id === partId);
    updateRow(key, {
      partId,
      unitPrice: part ? String(part.standardCost) : "",
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase text-slate-500">
          <tr>
            <th className="w-10 px-2 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Part number</th>
            <th className="w-28 px-3 py-2 text-right">Qty</th>
            <th className="w-36 px-3 py-2 text-right">Unit price</th>
            <th className="w-12 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.key} className="border-t border-slate-800">
              <td className="px-2 py-2 text-center text-xs text-slate-600">{idx + 1}</td>
              <td className="px-3 py-2">
                <select
                  name="partId"
                  className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                  value={row.partId}
                  onChange={(e) => onPartChange(row.key, e.target.value)}
                >
                  <option value="">— Select part —</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} — {p.description}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <Input
                  name="quantity"
                  type="number"
                  min={0}
                  step="any"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  placeholder="0"
                  className="ml-auto h-9 w-24 text-right"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  name="unitPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.unitPrice}
                  onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                  placeholder="0.00"
                  className="ml-auto h-9 w-32 text-right"
                />
              </td>
              <td className="px-2 py-2 text-center">
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  disabled={rows.length <= 1}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400 disabled:opacity-30"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" />
          Add line
        </Button>
      </div>
    </div>
  );
}
