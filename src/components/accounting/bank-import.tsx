"use client";

import { useActionState } from "react";
import { actionImportBankTransactions } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { UploadCloud, CheckCircle2, AlertTriangle } from "lucide-react";
import type { BankImportResult } from "@/lib/services/banking";

export function BankImport({
  accounts,
}: {
  accounts: { id: string; name: string }[];
}) {
  const [result, formAction, pending] = useActionState<
    BankImportResult | null,
    FormData
  >(actionImportBankTransactions, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          name="bankAccountId"
          required
          className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="flex items-center text-[11px] text-slate-500">
          Columns: date, description, amount (or debit/credit). Header row first.
        </p>
      </div>
      <textarea
        name="text"
        rows={6}
        required
        placeholder={"date\tdescription\tamount\n2026-07-10\tGRAINGER SUPPLY\t-284.50\n2026-07-11\tCUSTOMER DEPOSIT\t5000"}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600"
      />
      <Button type="submit" size="sm" disabled={pending}>
        <UploadCloud className="mr-1.5 h-4 w-4" />
        {pending ? "Importing…" : "Import transactions"}
      </Button>
      {result && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            result.errors.length === 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          {result.errors.length === 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>
            {result.imported} imported · {result.duplicates} duplicate(s) skipped
            {result.errors.length > 0
              ? ` · ${result.errors.length} error(s): ${result.errors[0].message}`
              : ""}
          </span>
        </div>
      )}
    </form>
  );
}
