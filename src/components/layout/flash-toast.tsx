"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { askCarinaAboutError, reportClientError } from "@/lib/carina-error-client";

/** Fires the queued server-action flash toast exactly once, then clears it. */
export function FlashToast({
  message,
  kind,
  stamp,
  errorCode,
  correlationId,
  route,
  entityType,
  entityId,
  action,
}: {
  message: string;
  kind: "success" | "error";
  stamp: number;
  errorCode?: string;
  correlationId?: string;
  route?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
}) {
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (fired.current === stamp) return;
    fired.current = stamp;
    // Clear before firing so refreshes don't replay it
    document.cookie = "forge-flash=; Max-Age=0; path=/";
    if (kind === "error") {
      const event = reportClientError({
        message,
        source: "action",
        errorCode,
        correlationId,
        route,
        entityType,
        entityId,
        actionAttempted: action,
      });
      toast.error(message, {
        action: {
          label: "Ask Carina",
          onClick: () => askCarinaAboutError(event),
        },
      });
    } else toast.success(message);
  }, [message, kind, stamp, errorCode, correlationId, route, entityType, entityId, action]);
  return null;
}
