"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DocActionForm } from "./action-form";
import { actionSearchDocTargets, actionLinkDocRecord } from "@/app/docs/actions";
const TYPES = [["TASK", "Engineering task / ticket"], ["TICKET", "Legacy ticket"], ["WORK_ORDER", "Work order"], ["PART", "Part / item"], ["NCR", "NCR"], ["PROGRAM", "PMO program"], ["PAGE", "Docs page"]];
export function DocLinkPicker({ pageId }: { pageId: string }) {
  const [type, setType] = useState("TASK"), [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className="space-y-3"><div className="flex flex-wrap gap-2"><select aria-label="Record type" value={type} onChange={e => { setType(e.target.value); setResults([]); }} className="rounded border border-slate-700 bg-slate-950 px-2 text-sm">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><Input aria-label="Find record" value={q} onChange={e => setQ(e.target.value)} placeholder="Number or name…" maxLength={100} className="w-48" /><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => { try { setError(""); setResults(await actionSearchDocTargets(type, q)); } catch { setError("Search unavailable. Check your record-view permission."); } })}>{pending ? "Searching…" : "Find records"}</Button></div>
    {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
    {results.length ? <DocActionForm key={type + q + results.map(r => r.id).join("")} action={actionLinkDocRecord} submit="Link record"><input type="hidden" name="pageId" value={pageId} /><input type="hidden" name="type" value={type} /><select name="targetId" aria-label="Select record to link" required className="h-10 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm">{results.filter(r => r.id !== pageId || type !== "PAGE").map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></DocActionForm> : <p className="text-xs text-slate-500">Find a record to link it in both directions. Only accessible records in this company appear.</p>}
  </div>;
}
