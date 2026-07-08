import { cn, statusColor } from "@/lib/utils";

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        statusColor(status),
        className
      )}
    >
      {label}
    </span>
  );
}
