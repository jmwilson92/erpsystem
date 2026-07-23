"use client";

import { useActionState } from "react";
import { actionReissueOnboarding } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Owner control: mint + copy a fresh onboarding link for one tenant. */
export function TenantOnboardLink({ tenantId }: { tenantId: string }) {
  const [state, formAction, pending] = useActionState(
    actionReissueOnboarding,
    null
  );
  return (
    <div className="space-y-1.5">
      <form action={formAction}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Generating…" : "Onboarding link"}
        </Button>
      </form>
      {state?.url && (
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-teal-300"
        />
      )}
      {state && !state.ok && (
        <p className="text-[11px] text-rose-300">{state.message}</p>
      )}
    </div>
  );
}
