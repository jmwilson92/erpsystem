"use client";

import { useState, useTransition } from "react";
import { actionUpdateCar } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText } from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export function CarUpdateForm({
  dispositionId,
  carStatus,
  carResponse,
  carNotes,
  existingAttachments,
}: {
  dispositionId: string;
  carStatus: string;
  carResponse: string;
  carNotes: string;
  existingAttachments: { url: string; fileName?: string; caption?: string }[];
}) {
  const [docs, setDocs] = useState<
    { url: string; fileName: string; caption: string }[]
  >([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    setDocs((p) => [...p, ...next].slice(0, 12));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    docs.forEach((d, i) => {
      fd.set(`car_doc_${i}`, d.url);
      fd.set(`car_doc_name_${i}`, d.fileName);
      if (d.caption) fd.set(`car_doc_caption_${i}`, d.caption);
    });
    startTransition(async () => {
      try {
        await actionUpdateCar(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
      <input type="hidden" name="dispositionId" value={dispositionId} />
      <div>
        <label className="text-[10px] uppercase text-slate-500">
          CAR status
        </label>
        <select
          name="carStatus"
          className={`${selectClass} mt-1`}
          defaultValue={carStatus === "CLOSED" ? "VERIFIED" : carStatus || "OPEN"}
        >
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESPONSE_RECEIVED">Response received</option>
          <option value="VERIFIED">Verified (closes CAR)</option>
        </select>
        <p className="mt-1 text-[10px] text-slate-600">
          Verified is the final step and automatically closes the CAR.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label className="text-[10px] uppercase text-slate-500">
          Supplier / owner response
        </label>
        <Textarea
          name="carResponse"
          rows={2}
          className="mt-1"
          defaultValue={carResponse}
          placeholder="Root cause, containment, corrective action..."
        />
      </div>
      <div className="sm:col-span-2">
        <label className="text-[10px] uppercase text-slate-500">
          Internal notes
        </label>
        <Textarea
          name="carNotes"
          rows={2}
          className="mt-1"
          defaultValue={carNotes}
        />
      </div>
      <div className="sm:col-span-2 rounded border border-slate-800 p-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
          <FileText className="h-3.5 w-3.5" />
          Vendor email / acknowledgment attachments
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.eml,.msg,.doc,.docx"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {existingAttachments.length > 0 && (
          <p className="mt-1 text-[10px] text-slate-500">
            {existingAttachments.length} existing attachment(s)
          </p>
        )}
        {docs.length > 0 && (
          <p className="mt-1 text-[10px] text-emerald-400">
            {docs.length} new file(s) ready to upload
          </p>
        )}
      </div>
      {error && <p className="sm:col-span-2 text-xs text-rose-400">{error}</p>}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          Update CAR
        </Button>
      </div>
    </form>
  );
}
