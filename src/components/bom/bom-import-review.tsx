"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionApproveBomImport,
  actionAttachBomImportCompanion,
  actionDiscardBomImport,
  actionRemapBomImport,
  actionUpdateBomImportReview,
} from "@/app/actions";
import type { BomColumnField, BomColumnMapping } from "@/lib/bom-import/types";

type Line = {
  id: string;
  sortOrder: number;
  level: number | null;
  findNumber: string | null;
  partNumber: string | null;
  description: string | null;
  revision: string | null;
  quantity: number | null;
  uom: string | null;
  confidence: number | null;
  flag: string;
  matchedPartId: string | null;
  createNewItem: boolean;
  notes: string | null;
};

type Grid = { mapping?: BomColumnMapping; headers?: string[]; rows?: string[][] };

const FIELDS: { key: Exclude<BomColumnField, "ignore">; label: string }[] = [
  { key: "partNumber", label: "Part number" },
  { key: "description", label: "Description" },
  { key: "quantity", label: "Qty" },
  { key: "uom", label: "UoM" },
  { key: "revision", label: "Rev" },
  { key: "findNumber", label: "Find no." },
  { key: "level", label: "Level" },
];

function flagClass(flag: string) {
  if (flag === "MATCHED") return "bg-emerald-500/15 text-emerald-300";
  if (flag === "NEW_ITEM") return "bg-amber-500/15 text-amber-300";
  if (flag === "INVALID") return "bg-red-500/15 text-red-300";
  return "bg-slate-700/60 text-slate-300";
}

export function BomImportReviewForm(props: {
  importId: string;
  fileName: string;
  sourceKind: string;
  needsExport: boolean;
  extractionNotes: string | null;
  previewText: string | null;
  previewKind: string | null;
  fileUrl: string;
  fileMime: string | null;
  companionFileName: string | null;
  columnMappingJson: string | null;
  assemblyPartNumber: string;
  assemblyDescription: string;
  assemblyRevision: string;
  lines: Line[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assemblyPartNumber, setAssemblyPartNumber] = useState(props.assemblyPartNumber);
  const [assemblyDescription, setAssemblyDescription] = useState(props.assemblyDescription);
  const [assemblyRevision, setAssemblyRevision] = useState(props.assemblyRevision || "A");
  const [lines, setLines] = useState(props.lines);
  const grid = useMemo<Grid>(() => {
    try {
      return props.columnMappingJson ? (JSON.parse(props.columnMappingJson) as Grid) : {};
    } catch {
      return {};
    }
  }, [props.columnMappingJson]);
  const [mapping, setMapping] = useState<BomColumnMapping>(grid.mapping || {});

  function patchLine(id: string, patch: Partial<Line>) {
    setLines((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function run(label: string, fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        if (typeof err === "object" && err && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw err;
        setError(err instanceof Error ? err.message : label);
      }
    });
  }

  const previewIsPdf = (props.previewKind === "PDF" || props.fileMime === "application/pdf") && props.fileUrl.startsWith("data:application/pdf");

  return (
    <div className="space-y-4">
      {props.needsExport && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">This file did not yield a BOM table that can be trusted automatically.</p>
          <p className="mt-2 text-amber-100/80">{props.extractionNotes}</p>
          <form
            className="mt-3 flex flex-wrap items-center gap-3"
            action={(formData) =>
              run("Companion upload failed", async () => {
                await actionAttachBomImportCompanion(formData);
              })
            }
          >
            <input type="hidden" name="importId" value={props.importId} />
            <input
              type="file"
              name="file"
              required
              accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="text-sm file:mr-2 file:rounded-md file:border file:border-amber-700 file:bg-slate-950 file:px-2 file:py-1 file:text-slate-100"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              Attach Excel or CSV companion
            </Button>
          </form>
        </div>
      )}

      {props.extractionNotes && !props.needsExport && (
        <p className="text-sm text-slate-400">{props.extractionNotes}</p>
      )}
      {props.companionFileName && (
        <p className="text-xs text-slate-500">Companion table: {props.companionFileName}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <h2 className="mb-2 text-sm font-medium text-slate-200">Source preview — {props.fileName}</h2>
          {previewIsPdf ? (
            <iframe title="Source PDF" src={props.fileUrl} className="h-[28rem] w-full rounded border border-slate-800 bg-white" />
          ) : props.previewText ? (
            <pre className="h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              {props.previewText}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">No text preview is available for this file.</p>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <h2 className="text-sm font-medium text-slate-200">Draft BOM to review</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[10px] uppercase text-slate-500">
              Assembly part number
              <Input value={assemblyPartNumber} onChange={(e) => setAssemblyPartNumber(e.target.value)} className="mt-0.5 h-9" />
            </label>
            <label className="text-[10px] uppercase text-slate-500 sm:col-span-2">
              Assembly description
              <Input value={assemblyDescription} onChange={(e) => setAssemblyDescription(e.target.value)} className="mt-0.5 h-9" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Revision
              <Input value={assemblyRevision} onChange={(e) => setAssemblyRevision(e.target.value)} className="mt-0.5 h-9" />
            </label>
          </div>

          {grid.headers && grid.headers.length > 0 && (
            <form
              className="rounded-md border border-slate-800 p-2"
              action={() =>
                run("Remap failed", async () => {
                  await actionRemapBomImport(props.importId, mapping);
                })
              }
            >
              <p className="mb-2 text-[10px] uppercase text-slate-500">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FIELDS.map((field) => (
                  <label key={field.key} className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="w-24 shrink-0 text-slate-500">{field.label}</span>
                    <select
                      className="h-8 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2"
                      value={mapping[field.key] || ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value || undefined }))}
                    >
                      <option value="">—</option>
                      {grid.headers!.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Button type="submit" size="sm" variant="outline" className="mt-2" disabled={pending}>
                Re-apply mapping
              </Button>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="p-1">Find</th>
                  <th className="p-1">Part #</th>
                  <th className="p-1">Description</th>
                  <th className="p-1">Qty</th>
                  <th className="p-1">UoM</th>
                  <th className="p-1">Flag</th>
                  <th className="p-1">New item</th>
                  <th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-slate-800 align-top">
                    <td className="p-1">
                      <Input className="h-8 w-16" value={line.findNumber || ""} onChange={(e) => patchLine(line.id, { findNumber: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 w-28 font-mono" value={line.partNumber || ""} onChange={(e) => patchLine(line.id, { partNumber: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 min-w-[10rem]" value={line.description || ""} onChange={(e) => patchLine(line.id, { description: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8 w-16"
                        type="number"
                        step="any"
                        value={line.quantity ?? ""}
                        onChange={(e) => patchLine(line.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 w-16" value={line.uom || ""} onChange={(e) => patchLine(line.id, { uom: e.target.value })} />
                    </td>
                    <td className="p-1">
                      <span className={`inline-flex rounded px-1.5 py-0.5 ${flagClass(line.flag)}`}>{line.flag.replace("_", " ")}</span>
                      <div className="mt-0.5 text-[10px] text-slate-500">{Math.round((line.confidence || 0) * 100)}%</div>
                    </td>
                    <td className="p-1">
                      {line.flag === "NEW_ITEM" || line.createNewItem ? (
                        <input
                          type="checkbox"
                          checked={line.createNewItem}
                          onChange={(e) => patchLine(line.id, { createNewItem: e.target.checked })}
                          aria-label={`Create new item for ${line.partNumber || "line"}`}
                        />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-1">
                      <button
                        type="button"
                        className="text-slate-500 hover:text-red-300"
                        onClick={() => setLines((rows) => rows.filter((r) => r.id !== line.id))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.some((l) => l.notes) && (
            <ul className="list-disc space-y-1 pl-5 text-[11px] text-slate-500">
              {lines.filter((l) => l.notes).map((l) => (
                <li key={l.id}>{l.partNumber || "Line"}: {l.notes}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run("Save failed", async () => {
              await actionUpdateBomImportReview({
                importId: props.importId,
                assemblyPartNumber,
                assemblyDescription,
                assemblyRevision,
                lines: lines.map((l) => ({
                  id: l.id,
                  sortOrder: l.sortOrder,
                  findNumber: l.findNumber,
                  partNumber: l.partNumber,
                  description: l.description,
                  revision: l.revision,
                  quantity: l.quantity,
                  uom: l.uom,
                  createNewItem: l.createNewItem,
                })),
              });
            })
          }
        >
          Save review
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            run("Approve failed", async () => {
              await actionUpdateBomImportReview({
                importId: props.importId,
                assemblyPartNumber,
                assemblyDescription,
                assemblyRevision,
                lines: lines.map((l) => ({
                  id: l.id,
                  sortOrder: l.sortOrder,
                  findNumber: l.findNumber,
                  partNumber: l.partNumber,
                  description: l.description,
                  revision: l.revision,
                  quantity: l.quantity,
                  uom: l.uom,
                  createNewItem: l.createNewItem,
                })),
              });
              await actionApproveBomImport(props.importId);
            })
          }
        >
          Approve draft BOM
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run("Discard failed", async () => {
              await actionDiscardBomImport(props.importId);
            })
          }
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
