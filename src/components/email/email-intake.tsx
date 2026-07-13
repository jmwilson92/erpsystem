"use client";

import { useActionState } from "react";
import { actionParseInboundEmail } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const selectClass =
  "h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export function EmailIntake() {
  const [state, formAction, pending] = useActionState(
    actionParseInboundEmail,
    null
  );

  return (
    <form action={formAction} className="space-y-2">
      <Textarea
        name="raw"
        required
        rows={8}
        placeholder={`From: buyer@northstar.example\nSubject: RFQ — connectors\n\nHi — please quote 25x CON-4400 for our Q3 build.`}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <select name="kind" className={selectClass} defaultValue="RFQ">
          <option value="RFQ">RFQ → draft quote</option>
          <option value="PO_ACK">PO acknowledgment</option>
          <option value="OTHER">Other — just log</option>
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Parsing…" : "Parse e-mail"}
        </Button>
      </div>
      {state && (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            state.ok
              ? "border-emerald-900/50 bg-emerald-500/5 text-emerald-300"
              : "border-rose-900/50 bg-rose-500/5 text-rose-300"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
