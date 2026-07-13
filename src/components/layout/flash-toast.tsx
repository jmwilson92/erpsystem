"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Fires the queued server-action flash toast exactly once, then clears it. */
export function FlashToast({
  message,
  kind,
  stamp,
}: {
  message: string;
  kind: "success" | "error";
  stamp: number;
}) {
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (fired.current === stamp) return;
    fired.current = stamp;
    // Clear before firing so refreshes don't replay it
    document.cookie = "forge-flash=; Max-Age=0; path=/";
    if (kind === "error") toast.error(message);
    else toast.success(message);
  }, [message, kind, stamp]);
  return null;
}
