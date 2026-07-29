"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[protessera] route error", error.digest || error.message);
    // Report to the owner insights dashboard so a visitor hitting a broken page
    // is something we find out about, not something we hope gets emailed in.
    try {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ERROR",
          path: window.location.pathname,
          label: error.message || "route error",
          severity: "error",
          detail: { digest: error.digest ?? null, boundary: "route" },
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* never let reporting break the error page itself */
    }
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-400">
        Something went wrong
      </p>
      <h1 className="max-w-md text-xl font-semibold text-slate-100">
        This page hit an unexpected error
      </h1>
      <p className="max-w-sm text-sm text-slate-400">
        Try again. If it keeps happening, note the reference below and contact
        your admin.
      </p>
      {error.digest && (
        <p className="font-mono text-[11px] text-slate-600">
          ref {error.digest}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
        >
          Command center
        </Link>
      </div>
    </div>
  );
}
