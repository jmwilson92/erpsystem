"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Records a PAGE event on every route change so we can see which parts of the
 * ERP test drivers actually explore.
 *
 * Mounted only for demo sessions (see layout) — the goal is learning what
 * prospects do, not logging every click a paying customer makes in their own
 * instance. The server derives session/source from cookies; this only sends the
 * route. Uses `keepalive` so the last page before someone leaves still lands.
 */
export function TelemetryBeacon({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !pathname) return;
    // Print/telemetry routes aren't interesting and would double-count.
    if (pathname.startsWith("/api") || pathname.startsWith("/print")) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const body = JSON.stringify({ kind: "PAGE", path: pathname });
    try {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* never let telemetry break the page */
    }
  }, [enabled, pathname]);

  return null;
}
