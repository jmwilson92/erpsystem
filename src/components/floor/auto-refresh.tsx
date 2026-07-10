"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function FloorAutoRefresh({ intervalSec = 30 }: { intervalSec?: number }) {
  const router = useRouter();
  const [sec, setSec] = useState(intervalSec);
  const routerRef = useRef(router);
  const remainingRef = useRef(intervalSec);
  routerRef.current = router;

  useEffect(() => {
    remainingRef.current = intervalSec;
    setSec(intervalSec);

    const t = setInterval(() => {
      remainingRef.current -= 1;
      if (remainingRef.current <= 0) {
        remainingRef.current = intervalSec;
        // Must not call router.refresh() inside a setState updater
        routerRef.current.refresh();
      }
      setSec(remainingRef.current);
    }, 1000);

    return () => clearInterval(t);
  }, [intervalSec]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs tabular-nums text-slate-500">Refresh {sec}s</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          remainingRef.current = intervalSec;
          setSec(intervalSec);
          router.refresh();
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </Button>
    </div>
  );
}
