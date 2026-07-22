"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";

/**
 * Inline document/photo picker for the quality-program forms. Reads the chosen
 * file to a data URL (same convention as WI photos and employee docs) and
 * contributes two hidden fields to the surrounding form, so it can be dropped
 * straight into an existing <form action={…}> without nesting a form.
 */
export function QualityFileField({
  label = "Attach document",
  urlName = "documentUrl",
  nameName = "documentName",
  accept = "application/pdf,image/*,.doc,.docx,.xls,.xlsx",
  className = "",
}: {
  label?: string;
  urlName?: string;
  nameName?: string;
  accept?: string;
  className?: string;
}) {
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    setFile({ url, name: f.name });
  }

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <label className="inline-flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-300 hover:border-teal-500/40">
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{file ? file.name : label}</span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files)}
        />
      </label>
      {file && (
        <>
          <input type="hidden" name={urlName} value={file.url} />
          <input type="hidden" name={nameName} value={file.name} />
          <button
            type="button"
            onClick={() => setFile(null)}
            className="shrink-0 rounded p-1 text-slate-500 hover:text-rose-300"
            title="Remove file"
            aria-label="Remove file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
