"use client";

import { useEffect } from "react";

/**
 * Keep the demo alive while the tab is open. Do NOT destroy on `pagehide` —
 * that races with server actions (start/end test drive) and produces
 * Next.js "unexpected response was received from the server".
 *
 * Teardown paths:
 *  - explicit "End test drive"
 *  - idle sweep (DEMO_IDLE_MINUTES)
 *  - optional delayed leave when the tab is hidden for a long stretch
 */
export function DemoLeaveBeacon() {
  useEffect(() => {
    const ping = () => {
      try {
        void fetch("/api/demo/ping", {
          method: "POST",
          keepalive: true,
          credentials: "same-origin",
        });
      } catch {
        /* ignore */
      }
    };

    ping();
    const id = window.setInterval(ping, 60_000);

    // Only schedule a soft leave after the tab has been backgrounded a while.
    // Cancelled if they come back and we ping again.
    let leaveTimer: number | undefined;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        leaveTimer = window.setTimeout(() => {
          try {
            navigator.sendBeacon?.("/api/demo/leave");
          } catch {
            /* ignore */
          }
        }, 5 * 60_000); // 5 minutes backgrounded
      } else if (leaveTimer) {
        window.clearTimeout(leaveTimer);
        leaveTimer = undefined;
        ping();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      if (leaveTimer) window.clearTimeout(leaveTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
