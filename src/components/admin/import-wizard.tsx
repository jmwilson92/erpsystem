"use client";

import { useActionState, useState } from "react";
import { actionImportData } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Package,
  Building2,
  Award,
  Users2,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { ImportResult } from "@/lib/services/data-import";

const ENTITIES = [
  {
    key: "parts",
    label: "Items / parts",
    icon: Package,
    headers: "partNumber, description, uom, standardCost, leadTimeDays, minStock, maxStock, partType, sourcingMethod",
    example: "BRK-1001\tSteel mounting bracket\tEA\t12.50\t14\t10\t50\tBUY\tPURCHASE",
    key2: "part number",
  },
  {
    key: "customers",
    label: "Customers",
    icon: Building2,
    headers: "name, code, contactEmail, paymentTerms, creditLimit",
    example: "Acme Aerospace\tACME\tpo@acme.example\tNET30\t250000",
    key2: "customer name",
  },
  {
    key: "suppliers",
    label: "Suppliers",
    icon: Award,
    headers: "name, code, contactName, contactEmail, paymentTerms",
    example: "Precision Metals Inc\tPMI\tSam Lee\tsales@pmi.example\tNET30",
    key2: "supplier name",
  },
  {
    key: "people",
    label: "People",
    icon: Users2,
    headers: "name, email, title, department, role, managerEmail",
    example: "Jordan Smith\tjordan@yourco.com\tMachinist\tProduction\tOPERATOR\ttaylor@yourco.com",
    key2: "email",
  },
] as const;

export function ImportWizard() {
  const [entity, setEntity] = useState<(typeof ENTITIES)[number]["key"]>("parts");
  const [result, formAction, pending] = useActionState<ImportResult | null, FormData>(
    actionImportData,
    null
  );
  const active = ENTITIES.find((e) => e.key === entity)!;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={() => setEntity(e.key)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              entity === e.key
                ? "border-teal-500/60 bg-teal-500/10"
                : "border-slate-800 hover:border-slate-700"
            }`}
          >
            <e.icon
              className={`h-5 w-5 ${entity === e.key ? "text-teal-400" : "text-slate-500"}`}
            />
            <p className="mt-2 text-sm font-medium text-slate-200">{e.label}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Paste your {active.label.toLowerCase()}
          </CardTitle>
          <p className="text-xs text-slate-500">
            Copy the rows straight out of Excel or a CSV — header row first.
            Columns are matched by name in any order; extra columns are
            ignored. Rows are matched by {active.key2}, so re-running an
            import updates instead of duplicating.
          </p>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="entity" value={entity} />
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-slate-500">
              <p className="text-slate-400">Recognized columns:</p>
              <p className="break-all">{active.headers}</p>
            </div>
            <textarea
              name="text"
              rows={10}
              required
              placeholder={`${active.headers.replace(/, /g, "\t")}\n${active.example}`}
              className="w-full rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600"
            />
            <Button type="submit" disabled={pending}>
              <UploadCloud className="mr-1.5 h-4 w-4" />
              {pending ? "Importing…" : "Import rows"}
            </Button>
          </form>

          {result && (
            <div className="mt-4 space-y-2">
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
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
                  {result.created} created · {result.updated} updated
                  {result.errors.length > 0
                    ? ` · ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} failed`
                    : " — all rows in."}
                </span>
              </div>
              {result.errors.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-3 text-xs text-slate-400">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-rose-400">
                        Row {e.row}:
                      </span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
