"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

/** Client search box that updates ?q= on the receiving queue. */
export function ReceivingQueueSearch({
  defaultValue = "",
}: {
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();

  const commit = useCallback(
    (q: string) => {
      const next = new URLSearchParams(sp.toString());
      const trimmed = q.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`);
      });
    },
    [pathname, router, sp]
  );

  return (
    <div className="relative min-w-[200px] flex-1 max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(value);
        }}
        onBlur={() => commit(value)}
        placeholder="Search traveler, PO, vendor…"
        className="h-9 pl-8 text-sm"
        aria-label="Search travelers"
      />
      {pending && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">
          …
        </span>
      )}
    </div>
  );
}
