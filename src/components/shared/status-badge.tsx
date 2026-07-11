import Link from "next/link";
import { cn, statusColor } from "@/lib/utils";
import { Info } from "lucide-react";

/**
 * Status tag. Pass `hint` to explain what is driving the status (shown
 * on hover) and `href` to make the tag link to the driving record
 * (e.g. ON HOLD → the NCR/MRB that holds it).
 */
export function StatusBadge({
  status,
  className,
  hint,
  href,
}: {
  status: string;
  className?: string;
  hint?: string | null;
  href?: string | null;
}) {
  const label = status.replace(/_/g, " ");
  const body = (
    <span
      title={hint || undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        statusColor(status),
        href && "cursor-pointer hover:ring-1 hover:ring-current",
        className
      )}
    >
      {label}
      {hint && <Info className="h-3 w-3 opacity-60" />}
    </span>
  );
  if (href) {
    return (
      <Link href={href} title={hint || undefined}>
        {body}
      </Link>
    );
  }
  return body;
}
