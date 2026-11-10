"use client";
import { useActionState, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DocActionState } from "@/app/docs/actions";

export function DocActionForm({ action, children, submit = "Save", className = "", confirmText }: {
  action: (state: DocActionState, data: FormData) => Promise<DocActionState>;
  children: ReactNode; submit?: string; className?: string; confirmText?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState(async (state: DocActionState, data: FormData) => {
    const pin = formRef.current?.elements.namedItem("pin");
    if (pin instanceof HTMLInputElement) pin.value = "";
    return action(state, data);
  }, {});
  return <form ref={formRef} action={dispatch} className={`space-y-3 ${className}`} onSubmit={e => {
    if (confirmText && !window.confirm(confirmText)) e.preventDefault();
  }}>
    {children}
    {state.error ? <p role="alert" className="text-sm text-rose-400">{state.error}</p> : null}
    {state.ok ? <p role="status" className="text-sm text-teal-400">Saved.</p> : null}
    <Button type="submit" disabled={pending} size="sm">{pending ? "Saving…" : submit}</Button>
  </form>;
}
