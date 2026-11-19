"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { actionImportBomFile } from "@/app/actions";
import { MAX_BOM_IMPORT_BYTES } from "@/lib/bom-import/types";

type State = { error?: string } | null;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Reading file…" : "Upload and extract"}
    </Button>
  );
}

export function BomImportUploadForm() {
  const [state, action] = useActionState(async (_prev: State, formData: FormData): Promise<State> => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) return { error: "Choose a file to upload." };
    if (file.size > MAX_BOM_IMPORT_BYTES) {
      return { error: `Files must be ${Math.round(MAX_BOM_IMPORT_BYTES / (1024 * 1024))} MB or smaller.` };
    }
    try {
      await actionImportBomFile(formData);
      return null;
    } catch (err) {
      if (typeof err === "object" && err && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw err;
      return { error: err instanceof Error ? err.message : "Import failed." };
    }
  }, null);

  return (
    <form action={action} className="space-y-4">
      <input
        type="file"
        name="file"
        required
        accept=".pdf,.xlsx,.xls,.csv,.easm,.edrw,.eprt,.sldasm,.sldprt,.slddrw,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-slate-100"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <Submit />
    </form>
  );
}
