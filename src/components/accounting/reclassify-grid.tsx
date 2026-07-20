"use client";

import { useState } from "react";
import { actionReclassifyLines } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ArrowRightLeft } from "lucide-react";

type Line = {
  id: string;
  date: string | Date;
  jeNumber: string;
  source: string | null;
  accountCode: string;
  accountName: string;
  memo: string | null;
  chargeCode: string | null;
  amount: number;
};

const COLS =
  "grid grid-cols-[1.5rem_5.5rem_5rem_5.5rem_minmax(9rem,1.3fr)_minmax(7rem,1fr)_5rem_6rem] items-center gap-x-2";

export function ReclassifyGrid({
  lines,
  accounts,
  activeAcct,
}: {
  lines: Line[];
  accounts: { id: string; code: string; name: string }[];
  activeAcct?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allChecked = lines.length > 0 && selected.size === lines.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(lines.map((l) => l.id)));
  const selNet = lines
    .filter((l) => selected.has(l.id))
    .reduce((s, l) => s + l.amount, 0);

  return (
    <form action={actionReclassifyLines}>
      <input type="hidden" name="acct" value={activeAcct || ""} />

      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
        <Button type="submit" size="sm" disabled={selected.size === 0}>
          <ArrowRightLeft className="mr-1.5 h-4 w-4" />
          Reclassify
        </Button>
        <span className="text-sm text-slate-400">
          <span className="font-medium text-slate-200">{selected.size}</span> line
          {selected.size === 1 ? "" : "s"} selected
          {selected.size > 0 && (
            <span className="ml-1 font-mono tabular-nums text-slate-300">
              {formatCurrency(selNet)}
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">move to</span>
          <select
            name="toAccountId"
            required
            defaultValue=""
            className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
          >
            <option value="" disabled>
              Choose account…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-slate-600">
        Select lines, choose the account they belong in, and Reclassify. Moves
        posted lines to the new account and rebalances both — one page (up to
        200 lines) at a time. Closed periods are locked.
      </p>

      {/* Grid */}
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <div
          className={`${COLS} border-b border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500`}
        >
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            aria-label="Select all"
            className="h-3.5 w-3.5 accent-teal-500"
          />
          <span>Date</span>
          <span>Source</span>
          <span>JE #</span>
          <span>Account</span>
          <span>Memo</span>
          <span>Charge</span>
          <span className="text-right">Net amount</span>
        </div>
        <div className="max-h-[32rem] overflow-y-auto">
          {lines.map((l) => (
            <label
              key={l.id}
              className={`${COLS} cursor-pointer border-b border-slate-900/70 px-3 py-1 text-[12px] hover:bg-slate-900/40 ${
                selected.has(l.id) ? "bg-teal-500/5" : ""
              }`}
            >
              <input
                type="checkbox"
                name="lineIds"
                value={l.id}
                checked={selected.has(l.id)}
                onChange={() => toggle(l.id)}
                className="h-3.5 w-3.5 accent-teal-500"
              />
              <span className="text-slate-500">{formatDate(l.date)}</span>
              <span className="truncate text-slate-500">{l.source || "—"}</span>
              <span className="font-mono text-sky-400">{l.jeNumber}</span>
              <span className="truncate text-slate-300">
                <span className="font-mono text-slate-500">{l.accountCode}</span>{" "}
                {l.accountName}
              </span>
              <span className="truncate text-slate-400">{l.memo || "—"}</span>
              <span className="truncate text-slate-500">{l.chargeCode || "—"}</span>
              <span
                className={`text-right font-mono tabular-nums ${
                  l.amount < 0 ? "text-rose-400" : "text-slate-300"
                }`}
              >
                {formatCurrency(l.amount)}
              </span>
            </label>
          ))}
          {lines.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">
              No posted journal lines for this filter.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
