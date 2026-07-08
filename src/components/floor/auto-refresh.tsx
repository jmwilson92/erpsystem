"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function FloorAutoRefresh({ intervalSec = 30 }: { intervalSec?: number }) {
  const router = useRouter();
  const [sec, setSec] = useState(intervalSec);

  useEffect(() => {
    const t = setInterval(() => {
      setSec((s) => {
        if (s <= 1) {
          router.refresh();
          return intervalSec;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [router, intervalSec]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs tabular-nums text-slate-500">Refresh {sec}s</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          router.refresh();
          setSec(intervalSec);
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </Button>
    </div>
  );
}
