"use client";

import { useState, useTransition } from "react";
import { actionCompleteReceivingInspection } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText } from "lucide-react";
import { useActionLoading } from "@/components/layout/action-loading";

export function CompleteInspectionForm({
  inspectionId,
  typeLabel,
  requireDocs = true,
}: {
  inspectionId: string;
  typeLabel: string;
  /** Pass/Fail only after documentation is attached (default true). */
  requireDocs?: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [measured, setMeasured] = useState("");
  const [docs, setDocs] = useState<
    { url: string; fileName: string; caption: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { start: startLoading, stop: stopLoading } = useActionLoading();

  const canDecide = !requireDocs || docs.length > 0;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; fileName: string; caption: string }[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      next.push({
        url,
        fileName: file.name,
        caption: file.name.replace(/\.[^.]+$/, ""),
      });
    }
    setDocs((p) => [...p, ...next].slice(0, 8));
    setError(null);
  }

  function submit(result: "PASS" | "FAIL") {
    setError(null);
    if (requireDocs && docs.length === 0) {
      setError("Upload test documentation before Pass or Fail");
      return;
    }
    const fd = new FormData();
    fd.set("inspectionId", inspectionId);
    fd.set("result", result);
    if (notes) fd.set("notes", notes);
    if (measured) fd.set("measuredValue", measured);
    docs.forEach((d, i) => {
      fd.set(`doc_${i}`, d.url);
      fd.set(`doc_name_${i}`, d.fileName);
      if (d.caption) fd.set(`doc_caption_${i}`, d.caption);
    });
    startLoading("quality");
    startTransition(async () => {
      try {
        await actionCompleteReceivingInspection(fd);
        window.location.reload();
      } catch (e) {
        stopLoading();
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <div className="space-y-2 rounded border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-xs font-medium text-slate-300">
        Complete {typeLabel}
      </p>
      <Input
        className="h-8 text-xs"
        placeholder="Measured / result notes"
        value={measured}
        onChange={(e) => setMeasured(e.target.value)}
      />
      <Textarea
        className="text-xs"
        rows={2}
        placeholder="Inspector notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div
        className={`rounded border px-2 py-2 ${
          docs.length === 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-emerald-500/30 bg-emerald-500/5"
        }`}
      >
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
          <FileText className="h-3.5 w-3.5" />
          {requireDocs ? "Test documentation * (required)" : "Attach paperwork"}
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {docs.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-emerald-400">
              {docs.length} file(s) ready
            </span>
            <button
              type="button"
              className="text-[10px] text-slate-500 underline"
              onClick={() => setDocs([])}
            >
              clear
            </button>
          </div>
        ) : (
          requireDocs && (
            <p className="mt-1 text-[10px] text-amber-300/90">
              Upload report / photos / certs first — then Pass / Fail unlocks.
            </p>
          )
        )}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          disabled={pending || !canDecide}
          onClick={() => submit("PASS")}
          title={!canDecide ? "Upload documentation first" : undefined}
        >
          Pass
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !canDecide}
          onClick={() => submit("FAIL")}
          title={!canDecide ? "Upload documentation first" : undefined}
        >
          Fail → NCR
        </Button>
      </div>
    </div>
  );
}
