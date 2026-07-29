"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import {
  actionConfirmMfa,
  actionDisableMfa,
  actionStartMfa,
  type MfaState,
} from "@/app/account/mfa-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";

type Status = {
  enabled: boolean;
  pending: boolean;
  recoveryRemaining: number;
  unavailable: null | "no_key" | "not_migrated";
};

function Note({ state }: { state: MfaState }) {
  if (!state || state.kind !== "error") return null;
  return (
    <p className="rounded-lg border border-rose-900/50 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
      {state.message}
    </p>
  );
}

/**
 * Recovery codes are shown exactly once — they're stored hashed, so this is the
 * only moment they exist in readable form. Worth being loud about it.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-amber-600/40 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold text-amber-200">
        Save these recovery codes now — they will not be shown again.
      </p>
      <p className="text-[11px] text-amber-200/80">
        Each works once, and only if you lose your authenticator. Keep them
        somewhere other than the device running the authenticator.
      </p>
      <div className="grid grid-cols-2 gap-1 font-mono text-xs text-slate-200">
        {codes.map((c) => (
          <span key={c} className="rounded bg-slate-950/60 px-2 py-1">
            {c}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(codes.join("\n"));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="flex items-center gap-1.5 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy all"}
      </button>
    </div>
  );
}

export function MfaSetup({ status }: { status: Status }) {
  const [enrol, setEnrol] = useState<MfaState>(null);
  const [confirmState, confirmAction, confirming] = useActionState(
    actionConfirmMfa,
    null
  );
  const [disableState, disableAction, disabling] = useActionState(
    actionDisableMfa,
    null
  );
  const [showDisable, setShowDisable] = useState(false);

  // Enrolment just succeeded — show the codes and nothing else.
  if (confirmState?.kind === "enabled") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          Two-factor authentication is on.
        </p>
        <RecoveryCodes codes={confirmState.recoveryCodes} />
      </div>
    );
  }

  if (status.unavailable === "no_key") {
    return (
      <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-xs text-amber-100">
        <p className="font-semibold">Two-factor isn&apos;t available yet.</p>
        <p className="mt-1 text-amber-200/90">
          Set <code className="rounded bg-slate-950/60 px-1">MFA_SECRET_KEY</code>{" "}
          to a long random value in this environment. Second-factor secrets are
          encrypted with it, so we refuse to store them without one.
        </p>
      </div>
    );
  }

  if (status.unavailable === "not_migrated") {
    return (
      <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-xs text-amber-100">
        <p className="font-semibold">
          Two-factor isn&apos;t set up on this instance yet.
        </p>
        <p className="mt-1 text-amber-200/90">
          The feature is deployed but this instance&apos;s database is missing
          its tables — nothing you can fix from here. Your administrator needs
          to run the schema migration; everything else keeps working meanwhile.
        </p>
      </div>
    );
  }

  if (status.enabled && !disableState) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          On — codes come from your authenticator app.
        </p>
        <p className="text-xs text-slate-500">
          {status.recoveryRemaining} recovery code
          {status.recoveryRemaining === 1 ? "" : "s"} left.
          {status.recoveryRemaining <= 2 &&
            " Turn it off and on again to issue a fresh set."}
        </p>
        {showDisable ? (
          <form action={disableAction} className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Current code (or a recovery code)
              <Input name="code" required className="h-9 w-44" autoComplete="one-time-code" />
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={disabling}>
              <ShieldOff className="h-3.5 w-3.5" />
              {disabling ? "Turning off…" : "Turn off"}
            </Button>
            <button
              type="button"
              onClick={() => setShowDisable(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowDisable(true)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Turn off two-factor
          </button>
        )}
        <Note state={disableState} />
      </div>
    );
  }

  // Mid-enrolment: QR on screen, waiting for the first code.
  if (enrol?.kind === "enrolling") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Scan this with Google Authenticator, 1Password, Authy, or any TOTP app,
          then enter the code it shows.
        </p>
        <div className="flex flex-wrap items-start gap-4">
          <Image
            src={enrol.qrDataUrl}
            alt="Two-factor QR code"
            width={180}
            height={180}
            unoptimized
            className="rounded-lg bg-white p-1"
          />
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500">Can&apos;t scan? Enter this key:</p>
            <code className="block break-all rounded bg-slate-950/60 px-2 py-1 font-mono text-xs text-slate-300">
              {enrol.secret}
            </code>
          </div>
        </div>
        <form action={confirmAction} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            Code from the app
            <Input
              name="code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              className="h-9 w-32 tracking-widest"
            />
          </label>
          <Button type="submit" size="sm" disabled={confirming}>
            {confirming ? "Checking…" : "Turn on"}
          </Button>
          <button
            type="button"
            onClick={() => setEnrol(null)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
        </form>
        <Note state={confirmState} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Off. A password on its own is one stolen credential away from your whole
        ERP — a second factor is the single biggest thing you can turn on here.
      </p>
      <form
        action={async () => {
          setEnrol(await actionStartMfa());
        }}
      >
        <Button type="submit" size="sm">
          <ShieldCheck className="h-3.5 w-3.5" /> Set up two-factor
        </Button>
      </form>
      <Note state={enrol} />
      {disableState?.kind === "disabled" && (
        <p className="text-xs text-slate-500">Two-factor is now off.</p>
      )}
    </div>
  );
}
