"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ClipboardCheck,
  FlaskConical,
  MapPin,
  Factory,
} from "lucide-react";

type HandoffPayload = {
  at: number;
  area?: string | null;
  areaLabel?: string | null;
  workCenter?: string | null;
  stepTitle?: string | null;
  stepNumber?: number | null;
  readyForPutaway?: boolean;
};

/**
 * Shows after sign-off when the next open step is a different workcenter/area.
 * Payload is stashed in sessionStorage by SignOffStepForm (survives soft refresh).
 */
export function StationHandoffBanner({
  workOrderId,
  workOrderNumber,
  /** Server-computed next open step (persistent until signed) */
  serverHandoff,
}: {
  workOrderId: string;
  workOrderNumber: string;
  serverHandoff?: {
    area: string | null;
    areaLabel: string;
    workCenter: string | null;
    stepTitle: string | null;
    stepNumber: number | null;
    href?: string;
  } | null;
}) {
  const [flash, setFlash] = useState<HandoffPayload | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`wo-handoff-${workOrderId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as HandoffPayload;
      // Only show recent handoff (2 min)
      if (Date.now() - (parsed.at || 0) > 120_000) {
        sessionStorage.removeItem(`wo-handoff-${workOrderId}`);
        return;
      }
      setFlash(parsed);
    } catch {
      /* ignore */
    }
  }, [workOrderId]);

  const data = flash
    ? {
        area: flash.area || null,
        areaLabel:
          flash.areaLabel ||
          flash.area ||
          flash.workCenter ||
          "next station",
        workCenter: flash.workCenter || null,
        stepTitle: flash.stepTitle || null,
        stepNumber: flash.stepNumber ?? null,
        readyForPutaway: !!flash.readyForPutaway,
        href: flash.readyForPutaway
          ? "/receiving?tab=putaway"
          : flash.area === "QA"
            ? "/qa"
            : flash.area === "TEST"
              ? "/test-center"
              : undefined,
      }
    : serverHandoff
      ? { ...serverHandoff, readyForPutaway: false }
      : null;

  if (!data) return null;

  const kind =
    data.readyForPutaway || data.area === "RECEIVING"
      ? "recv"
      : data.area === "QA"
        ? "qa"
        : data.area === "TEST"
          ? "test"
          : "mfg";

  const styles = {
    qa: {
      border: "border-amber-500/40",
      bg: "bg-amber-500/10",
      accent: "text-amber-300",
      Icon: ClipboardCheck,
    },
    test: {
      border: "border-violet-500/40",
      bg: "bg-violet-500/10",
      accent: "text-violet-300",
      Icon: FlaskConical,
    },
    recv: {
      border: "border-teal-500/40",
      bg: "bg-teal-500/10",
      accent: "text-teal-300",
      Icon: MapPin,
    },
    mfg: {
      border: "border-sky-500/40",
      bg: "bg-sky-500/10",
      accent: "text-sky-300",
      Icon: Factory,
    },
  }[kind];

  const Icon = styles.Icon;
  const dest =
    data.workCenter ||
    (kind === "qa" ? "QA" : kind === "test" ? "Test" : data.areaLabel);

  return (
    <div
      id="wo-station-handoff"
      className={cn("rounded-xl border px-4 py-3", styles.border, styles.bg)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", styles.accent)} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              What to do next
            </p>
            <p className={cn("text-lg font-semibold", styles.accent)}>
              {data.readyForPutaway
                ? `Take ${workOrderNumber} to Receiving for putaway`
                : `Take material with ${workOrderNumber} to ${dest}`}
            </p>
            <p className="mt-0.5 text-sm text-slate-300">
              {data.readyForPutaway
                ? "All build steps are done. Walk the finished unit to RCV-01 — put away only on the Receiving putaway board."
                : `Next open work is at ${data.areaLabel}${
                    data.workCenter ? ` · ${data.workCenter}` : ""
                  }${
                    data.stepNumber != null
                      ? ` · step ${data.stepNumber}`
                      : ""
                  }${data.stepTitle ? ` — ${data.stepTitle}` : ""}. Move the physical traveler and material there before signing the next step.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.href && (
            <Link href={data.href}>
              <Button size="sm" variant="secondary">
                {data.readyForPutaway
                  ? "Receiving putaway"
                  : data.area === "QA"
                    ? "QA queue"
                    : data.area === "TEST"
                      ? "Test Center"
                      : "Open"}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
          {flash && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                sessionStorage.removeItem(`wo-handoff-${workOrderId}`);
                setFlash(null);
              }}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
