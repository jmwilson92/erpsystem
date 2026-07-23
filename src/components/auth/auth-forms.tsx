"use client";

import { useActionState, useState } from "react";
import {
  actionLogin,
  actionBootstrapInstance,
  actionAcceptInvite,
  actionClaimTenant,
  actionRequestPasswordReset,
  actionChangePassword,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Feedback({
  state,
}: {
  state: { ok: boolean; message: string } | null;
}) {
  if (!state) return null;
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-xs ${
        state.ok
          ? "border-emerald-900/50 bg-emerald-500/5 text-emerald-300"
          : "border-rose-900/50 bg-rose-500/5 text-rose-300"
      }`}
    >
      {state.message}
    </p>
  );
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(actionLogin, null);
  const [forgot, setForgot] = useState(false);
  const [resetState, resetAction, resetPending] = useActionState(
    actionRequestPasswordReset,
    null
  );

  if (forgot) {
    return (
      <form action={resetAction} className="space-y-3">
        <p className="text-sm text-slate-400">
          Enter your e-mail — we&apos;ll send a reset link.
        </p>
        <Input name="email" type="email" required placeholder="you@company.com" />
        <Feedback state={resetState} />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={resetPending} className="flex-1">
            {resetPending ? "Sending…" : "Send reset link"}
          </Button>
          <button
            type="button"
            onClick={() => setForgot(false)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Back to login
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        defaultValue={state?.email || ""}
        key={state?.email || "email"}
      />
      <Input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
      />
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <button
        type="button"
        onClick={() => setForgot(true)}
        className="w-full text-center text-xs text-slate-500 hover:text-slate-300"
      >
        Forgot password?
      </button>
    </form>
  );
}

export function BootstrapForm() {
  const [state, formAction, pending] = useActionState(
    actionBootstrapInstance,
    null
  );
  return (
    <form action={formAction} className="space-y-3">
      <Input name="name" placeholder="Your name" autoComplete="name" />
      <Input
        name="email"
        type="email"
        required
        placeholder="you@company.com"
        autoComplete="email"
      />
      <Input
        name="password"
        type="password"
        required
        minLength={8}
        placeholder="Choose a password (min 8 chars)"
        autoComplete="new-password"
      />
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Setting up…" : "Claim this instance"}
      </Button>
    </form>
  );
}

export function ClaimTenantForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(actionClaimTenant, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Input name="name" placeholder="Your name (optional)" autoComplete="name" />
      <Input
        name="password"
        type="password"
        required
        minLength={8}
        placeholder="Choose a password (min 8 chars)"
        autoComplete="new-password"
      />
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Setting up…" : "Set password & enter ForgeRP"}
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    actionAcceptInvite,
    null
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Input name="name" placeholder="Your name (optional)" autoComplete="name" />
      <Input
        name="password"
        type="password"
        required
        minLength={8}
        placeholder="Choose a password (min 8 chars)"
        autoComplete="new-password"
      />
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Activating…" : "Set password & sign in"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    actionChangePassword,
    null
  );
  return (
    <form action={formAction} className="space-y-2">
      <Input
        name="currentPassword"
        type="password"
        placeholder="Current password (blank if none yet)"
        autoComplete="current-password"
      />
      <Input
        name="newPassword"
        type="password"
        required
        minLength={8}
        placeholder="New password (min 8 chars)"
        autoComplete="new-password"
      />
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
