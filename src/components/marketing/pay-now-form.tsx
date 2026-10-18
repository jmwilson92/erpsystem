"use client";

import { useFormStatus } from "react-dom";
import { actionStartPublicCheckout } from "@/app/pricing/actions";

function SubmitButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Opening checkout…" : label}
    </button>
  );
}

/**
 * Public pay-now. No login. Shop seat count defaults to 1 ($10/mo) unless the
 * form includes its own `seats` field.
 */
export function PayNowForm({
  plan,
  seats,
  label = "Pay now",
  className,
  children,
}: {
  plan: string;
  seats?: number;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <form action={actionStartPublicCheckout} className="space-y-2">
      <input type="hidden" name="plan" value={plan} />
      {seats != null && (
        <input type="hidden" name="seats" value={String(seats)} />
      )}
      {children}
      <SubmitButton label={label} className={className} />
    </form>
  );
}
