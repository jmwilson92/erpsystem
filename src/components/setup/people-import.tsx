"use client";

import { useActionState, useRef, useState } from "react";
import { actionImportData } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Download,
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { ImportResult } from "@/lib/services/data-import";

const HEADERS = ["name", "email", "title", "department", "role", "managerEmail"];
const EXAMPLES = [
  ["Taylor Reed", "taylor@yourco.com", "Plant Manager", "Operations", "ADMIN", ""],
  ["Jordan Smith", "jordan@yourco.com", "Machinist", "Production", "OPERATOR", "taylor@yourco.com"],
  ["Sam Chen", "sam@yourco.com", "Buyer", "Purchasing", "PURCHASING", "taylor@yourco.com"],
];

/**
 * Bulk-add people at setup: download a CSV template, fill it in Excel, upload
 * (or paste) it, and everyone is created in one go. Managers are wired by
 * managerEmail; existing people are skipped so re-uploading is safe.
 */
export function PeopleImport() {
  const [result, formAction, pending] = useActionState<ImportResult | null, FormData>(
    actionImportData,
    null
  );
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const csv =
      HEADERS.join(",") + "\n" + EXAMPLES.map((r) => r.join(",")).join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "forgerp-people-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-teal-400" />
        <div>
          <p className="text-sm font-medium text-slate-200">
            Add everyone at once from a spreadsheet
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-slate-400">
            <li>Download the template — it has the columns and a few example rows.</li>
            <li>
              Fill one row per person in Excel/Sheets. <span className="text-slate-300">name</span> and{" "}
              <span className="text-slate-300">email</span> are required; role is one of ADMIN, MANAGER,
              PM, CM, QUALITY, PURCHASING, ACCOUNTING, HR, or OPERATOR (defaults to OPERATOR).
              Set <span className="text-slate-300">managerEmail</span> to a manager already in the file
              or your org to wire the reporting chain.
            </li>
            <li>Save as CSV, upload it below, and import — everyone is added in one shot.</li>
          </ol>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="mr-1.5 h-4 w-4" />
          Download CSV template
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <UploadCloud className="mr-1.5 h-4 w-4" />
          {fileName ? "Choose a different file" : "Upload filled CSV"}
        </Button>
        {fileName && (
          <span className="text-[11px] text-teal-300">{fileName} loaded</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFile}
        />
      </div>

      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="entity" value="people" />
        <input type="hidden" name="mode" value="skip" />
        <textarea
          name="text"
          rows={6}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={HEADERS.join(",") + "\n" + EXAMPLES[0].join(",")}
          className="w-full rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
        />
        <p className="text-[11px] text-slate-500">
          Uploading a CSV fills this box — you can tweak rows here before importing.
          People who already exist (matched by email) are skipped.
        </p>
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          <UploadCloud className="mr-1.5 h-4 w-4" />
          {pending ? "Importing…" : "Import everyone"}
        </Button>
      </form>

      {result && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
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
            {result.created} added · {result.updated} updated · {result.skipped} skipped
            {result.errors.length > 0
              ? ` · ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} failed (${result.errors[0].message})`
              : " — done."}
          </span>
        </div>
      )}
    </div>
  );
}
