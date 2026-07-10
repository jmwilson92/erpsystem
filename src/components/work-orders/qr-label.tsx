"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, QrCode } from "lucide-react";

export function WorkOrderQrLabel({
  workOrderId,
  number,
  description,
  partNumber,
  lotHint,
  qrDataUrl,
  qrPayload,
}: {
  workOrderId: string;
  number: string;
  description?: string | null;
  partNumber?: string | null;
  lotHint?: string | null;
  qrDataUrl: string;
  qrPayload: string;
}) {
  const [open, setOpen] = useState(false);

  const print = useCallback(() => {
    const w = window.open("", "_blank", "noopener,noreferrer,width=420,height=560");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>QR ${number}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #0f172a; }
  .label { border: 2px solid #0f172a; padding: 16px; width: 320px; text-align: center; }
  h1 { font-size: 18px; font-family: ui-monospace, monospace; margin: 0 0 4px; }
  p { margin: 2px 0; font-size: 12px; }
  img { width: 220px; height: 220px; margin: 12px auto; display: block; }
  .meta { font-size: 10px; color: #475569; word-break: break-all; margin-top: 8px; }
  @media print { body { margin: 0; } .noprint { display: none; } }
</style></head><body>
<div class="label">
  <h1>${number}</h1>
  <p>${description || "Work order / material lot"}</p>
  ${partNumber ? `<p><strong>Part</strong> ${partNumber}</p>` : ""}
  ${lotHint ? `<p><strong>Lot / ref</strong> ${lotHint}</p>` : ""}
  <img src="${qrDataUrl}" alt="QR ${number}" />
  <p class="meta">${qrPayload}</p>
</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`);
    w.document.close();
  }, [number, description, partNumber, lotHint, qrDataUrl, qrPayload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="inline-flex gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <QrCode className="mr-1 h-4 w-4" />
        QR label
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-lg font-semibold text-teal-400">{number}</p>
                <p className="text-xs text-slate-400">
                  Material / work order QR · scan opens traveler (mobile app phase 2)
                </p>
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-200"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="rounded-lg border border-slate-800 bg-white p-4 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR for ${number}`}
                className="mx-auto h-56 w-56"
              />
              <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{number}</p>
              {partNumber && (
                <p className="text-xs text-slate-600">{partNumber}</p>
              )}
            </div>
            <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
              {qrPayload}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">WO id: {workOrderId}</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" size="sm" onClick={print} className="flex-1">
                <Printer className="mr-1 h-4 w-4" />
                Print label
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
