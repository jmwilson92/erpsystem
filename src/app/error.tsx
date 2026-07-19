"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Segment error boundary — a friendly page instead of the raw Next.js
 * "Application error" text. The digest is shown so support can match it
 * to the server log line.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl">🔧</p>
      <h1 className="text-xl font-semibold text-slate-200">
        Something broke on our side
      </h1>
      <p className="max-w-md text-sm text-slate-400">
        The page hit an unexpected error. Your data is safe — try again, or
        head back to the dashboard. If it keeps happening, tell support what
        you were doing and quote the reference below.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-slate-500">
          Reference: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
