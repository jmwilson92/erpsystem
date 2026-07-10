"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";

/**
 * Shows a one-shot modal after a station change so operators know where to
 * physically move the material / bin.
 */
export function MoveMaterialModal({
  open,
  fromLabel,
  toLabel,
  areaLabel,
  workOrderNumber,
  onDismiss,
}: {
  open: boolean;
  fromLabel?: string | null;
  toLabel: string;
  areaLabel?: string | null;
  workOrderNumber?: string | null;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    setVisible(open);
  }, [open]);

  if (!visible) return null;

  const destination = areaLabel || toLabel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-950 p-6 shadow-2xl">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <MapPin className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-slate-50">
          Move material
        </h2>
        {workOrderNumber && (
          <p className="mt-1 font-mono text-sm text-teal-400">{workOrderNumber}</p>
        )}
        <p className="mt-4 text-base text-slate-200">
          Please take this material to the{" "}
          <strong className="text-amber-300">{destination}</strong>.
        </p>
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
          {fromLabel ? (
            <p>
              From <span className="font-mono text-slate-200">{fromLabel}</span>
              {" → "}
              <span className="font-mono text-slate-200">{toLabel}</span>
            </p>
          ) : (
            <p>
              Destination station:{" "}
              <span className="font-mono text-slate-200">{toLabel}</span>
            </p>
          )}
        </div>
        <Button
          type="button"
          className="mt-6 w-full"
          onClick={() => {
            setVisible(false);
            onDismiss();
          }}
        >
          Acknowledged — material moved
        </Button>
      </div>
    </div>
  );
}
