"use client";

import { useState, useTransition } from "react";
import { actionConvertPrToPo } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { useActionLoading } from "@/components/layout/action-loading";

export function ConvertPrToPoButton({ prId }: { prId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { start: startLoading, stop: stopLoading } = useActionLoading();

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set("id", prId);
          startLoading("purchasing");
          startTransition(async () => {
            try {
              await actionConvertPrToPo(fd);
            } catch (e) {
              if (isRedirectError(e)) {
                // Successful convert redirects to PO detail
                return;
              }
              stopLoading();
              setError(
                e instanceof Error
                  ? e.message
                  : "Convert to PO failed — unexpected server response"
              );
            }
          });
        }}
      >
        {pending ? "Converting…" : "Convert to PO"}
      </Button>
      {error && (
        <p className="max-w-xs text-[11px] text-rose-400">{error}</p>
      )}
    </div>
  );
}
