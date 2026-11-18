"use client";

import { useState } from "react";
import { actionCarinaConfirm } from "@/app/ai/actions";
import type { AiPendingAction } from "@/lib/services/ai";
import { cn } from "@/lib/utils";

export function CarinaDraftCard({
  pending,
  onResolved,
}: {
  pending: AiPendingAction;
  onResolved: (result: { text: string; href?: string; cancelled?: boolean; voiceApproved?: boolean; pending?: AiPendingAction | null }) => void;
}) {
  const draft = pending.draft;
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!draft) return null;

  async function confirm(voiceApproved = pending.voiceApproved) {
    setBusy(true);
    setError(null);
    try {
      const result = await actionCarinaConfirm({
        pendingAction: { ...pending, voiceApproved },
        pinCode: pin || null,
        voiceApproved,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved({ text: result.text, href: result.href });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-3 mb-2 rounded-xl border border-teal-500/30 bg-slate-950 p-3 text-xs text-slate-200">
      <p className="text-[11px] font-semibold text-teal-300">{draft.title}</p>
      <p className="mt-1 text-[11px] text-slate-400">{draft.summary}</p>
      <ul className="mt-2 space-y-1">
        {draft.changes.map((c, i) => (
          <li key={`${c.entityId}-${c.field}-${i}`} className="rounded-md bg-slate-900/80 px-2 py-1">
            <span className="text-slate-500">{c.entityLabel} · {c.field}</span>
            <div className="text-slate-200">
              {c.from} <span className="text-teal-400">→</span> {c.to}
            </div>
          </li>
        ))}
      </ul>
      {draft.execute.requiresPin && (
        <label className="mt-2 block text-[11px] text-slate-400">
          Sign-off PIN (required with a voice “approve”; not voice-only)
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          />
        </label>
      )}
      {error && (
        <p className="mt-2 text-[11px] text-amber-200">{error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className={cn(
            "rounded-lg bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950",
            busy && "opacity-50"
          )}
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolved({ text: "Cancelled. I didn’t change any records.", cancelled: true })}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        I’m Carina, an AI assistant. You can also say “confirm” or “cancel”.
        Nothing is written until you confirm.
      </p>
    </div>
  );
}
