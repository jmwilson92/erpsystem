"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Periodically re-runs the server component so the dashboard reflects live
 * traffic without a manual reload.
 *
 * Pauses while the tab is hidden and refreshes immediately on return: a
 * dashboard left open in a background tab shouldn't keep querying, and coming
 * back to stale numbers is exactly when you want fresh ones.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [last, setLast] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const refresh = () => {
      router.refresh();
      setLast(Date.now());
    };

    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      setPaused(hidden);
      if (!hidden) refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, seconds * 1000);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <RefreshCw className="h-3 w-3" aria-hidden />
      {paused ? (
        "paused"
      ) : (
        <>
          auto-refreshing every {seconds}s
          <Since from={last} />
        </>
      )}
      <button
        type="button"
        onClick={() => {
          router.refresh();
          setLast(Date.now());
        }}
        className="rounded border border-slate-800 px-1.5 py-0.5 text-slate-400 hover:border-slate-700 hover:text-slate-200"
      >
        Refresh now
      </button>
    </span>
  );
}

/** Ticks once a second so "updated Ns ago" doesn't sit there lying. */
function Since({ from }: { from: number }) {
  const [now, setNow] = useState(from);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [from]);
  const secs = Math.max(0, Math.round((now - from) / 1000));
  return <span className="tabular-nums">· updated {secs}s ago</span>;
}
