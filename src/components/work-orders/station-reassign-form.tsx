"use client";

import { useEffect, useState, useTransition } from "react";
import { actionReassignWoStation } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { MoveMaterialModal } from "@/components/work-orders/move-material-modal";

type Station = {
  code: string;
  name: string;
  area: string;
};

const AREA_LABELS: Record<string, string> = {
  MANUFACTURING: "Manufacturing / Assembly area",
  QA: "QA area",
  TEST: "Test area",
  SHIPPING: "Shipping area",
  RECEIVING: "Receiving area",
};

export function StationReassignForm({
  workOrderId,
  workOrderNumber,
  currentWorkCenter,
  stations,
  selectClass,
}: {
  workOrderId: string;
  workOrderNumber: string;
  currentWorkCenter?: string | null;
  stations: Station[];
  selectClass: string;
}) {
  const [pending, startTransition] = useTransition();
  const [move, setMove] = useState<{
    from: string;
    to: string;
    areaLabel: string;
  } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const toCode = String(fd.get("workCenterCode") || "");
    if (!toCode || toCode === currentWorkCenter) return;

    startTransition(async () => {
      try {
        await actionReassignWoStation(fd);
      } catch {
        /* revalidate may throw NEXT_REDIRECT-like errors in some runtimes */
      }
      window.location.href = `/work-orders/${workOrderId}?moved=${encodeURIComponent(toCode)}&from=${encodeURIComponent(currentWorkCenter || "")}`;
    });
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-2">
        <input type="hidden" name="workOrderId" value={workOrderId} />
        <select
          name="workCenterCode"
          className={selectClass}
          defaultValue={currentWorkCenter || ""}
          required
        >
          <option value="" disabled>
            Route to…
          </option>
          {["MANUFACTURING", "QA", "TEST", "SHIPPING", "RECEIVING"].map(
            (area) => (
              <optgroup key={area} label={area}>
                {stations
                  .filter((s) => s.area === area)
                  .map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} · {s.name}
                    </option>
                  ))}
              </optgroup>
            )
          )}
        </select>
        <div className="flex items-center justify-between gap-2">
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">
            <input
              type="checkbox"
              name="force"
              className="rounded border-slate-600"
            />
            Force
          </label>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={pending}
          >
            {pending ? "Moving…" : "Move"}
          </Button>
        </div>
      </form>
      {move && (
        <MoveMaterialModal
          open
          fromLabel={move.from}
          toLabel={move.to}
          areaLabel={move.areaLabel}
          workOrderNumber={workOrderNumber}
          onDismiss={() => setMove(null)}
        />
      )}
    </>
  );
}

/** Server-rendered helper: show move modal when ?moved= is present after reassignment */
export function MoveMaterialFromQuery({
  workOrderNumber,
  stations,
  currentWorkCenter,
}: {
  workOrderNumber: string;
  stations: Station[];
  currentWorkCenter?: string | null;
}) {
  const [state, setState] = useState<{
    from: string;
    to: string;
    areaLabel: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const moved = sp.get("moved");
    if (!moved) return;
    const from = sp.get("from") || currentWorkCenter || "—";
    const st = stations.find((s) => s.code === moved);
    setState({
      from,
      to: moved,
      areaLabel: AREA_LABELS[st?.area || ""] || st?.name || moved,
    });
  }, [stations, currentWorkCenter]);

  if (!state) return null;
  return (
    <MoveMaterialModal
      open
      fromLabel={state.from}
      toLabel={state.to}
      areaLabel={state.areaLabel}
      workOrderNumber={workOrderNumber}
      onDismiss={() => {
        setState(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("moved");
        url.searchParams.delete("from");
        window.history.replaceState({}, "", url.pathname + url.search);
      }}
    />
  );
}
