"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * "Start your own instance" — the demo's conversion CTA. Records a CONVERT
 * event before navigating so the insights dashboard can show what share of test
 * drives actually reach signup. Beacon is fire-and-forget with `keepalive`, so
 * the click never waits on it.
 */
export function ConvertCta() {
  function report() {
    try {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "CONVERT",
          path: window.location.pathname,
          label: "demo.convert_clicked",
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* never block the click */
    }
  }

  return (
    <Link
      href="/signup"
      onClick={report}
      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-transform hover:scale-[1.03]"
    >
      Start your own instance <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
