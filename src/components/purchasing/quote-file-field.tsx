"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Attach (or replace) a supplier quote on a purchase request. The file is read
 * to a data URL and submitted as hidden fields with the server action, which
 * saves it on the PR so it carries onto the PO at convert.
 */
export function QuoteFileField({
  action,
  prId,
  currentName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  prId: string;
  currentName?: string | null;
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
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={prId} />
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-teal-500/40">
        <Paperclip className="h-3.5 w-3.5" />
        {file ? "Change file" : currentName ? "Replace quote" : "Choose quote file"}
        <input
          type="file"
          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={(e) => onFile(e.target.files)}
        />
      </label>
      {file && (
        <>
          <input type="hidden" name="quoteFileUrl" value={file.url} />
          <input type="hidden" name="quoteFileName" value={file.name} />
          <p className="truncate text-[11px] text-slate-400">
            Selected: {file.name}
          </p>
          <Button type="submit" size="sm">
            Attach quote
          </Button>
        </>
      )}
    </form>
  );
}
