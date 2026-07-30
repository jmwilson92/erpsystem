"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Failures that mean "your browser is holding a build that no longer exists"
 * rather than "this code is broken".
 *
 * Every deploy renames the JS chunks, so anyone with a tab open when one lands
 * requests a URL that 404s. Webpack then calls `undefined` as a module factory,
 * which surfaces as the oddly generic "Cannot read properties of undefined
 * (reading 'call')". A reload fetches the new manifest and the page works.
 */
const STALE_BUILD_RE =
  /ChunkLoadError|Loading chunk \S+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|undefined \(reading 'call'\)/i;

const RELOAD_KEY = "protessera:stale-build-reload";

/**
 * How long before another automatic reload is allowed.
 *
 * A stale chunk is fixed by the first reload, so a second failure arriving
 * seconds later means reloading is not helping — show the error instead of
 * spinning. A failure minutes later is a different deploy and worth retrying,
 * which is why this is a timestamp rather than a one-shot flag: a flag would
 * make the very first deploy of a session the only one that self-heals.
 */
const RELOAD_COOLDOWN_MS = 30_000;

/** Returns true when it kicked off a reload and the caller should stop. */
function tryRecoverStaleBuild(message: string): boolean {
  if (!STALE_BUILD_RE.test(message)) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode, embedded webview). Without somewhere to
    // record the attempt we cannot detect a loop, so don't start one.
    return false;
  }
  window.location.reload();
  return true;
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[protessera] route error", error.digest || error.message);
    const message = error.message || "";
    const stale = STALE_BUILD_RE.test(message);

    // Report to the owner insights dashboard so a visitor hitting a broken page
    // is something we find out about, not something we hope gets emailed in.
    // Reported BEFORE any reload, and `keepalive` is what lets the request
    // outlive the navigation — otherwise self-healing would also hide how often
    // this happens.
    try {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ERROR",
          path: window.location.pathname,
          label: message || "route error",
          // A stale chunk is expected fallout from deploying, not a defect, so
          // it should not sit in the queue at the same weight as a real break.
          severity: stale ? "warn" : "error",
          detail: {
            digest: error.digest ?? null,
            boundary: "route",
            staleBuild: stale,
          },
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* never let reporting break the error page itself */
    }

    tryRecoverStaleBuild(message);
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
