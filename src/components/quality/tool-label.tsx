"use client";

import { Printer, Download, QrCode } from "lucide-react";

/**
 * A print-ready tool label. The card itself is sized like a physical asset
 * label; the toolbar (hidden on print) offers Print and a DXF download for
 * laser etching.
 */
export function ToolLabel({
  id,
  identifier,
  name,
  program,
  needsCalibration,
}: {
  id: string;
  identifier: string;
  name: string;
  program: string;
  needsCalibration: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
        >
          <Printer className="h-4 w-4" /> Print label
        </button>
        <a
          href={`/api/quality/tools/${id}/dxf`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-teal-500/40"
        >
          <Download className="h-4 w-4" /> DXF for laser etcher
        </a>
      </div>

      <div className="tool-label mx-auto flex w-[3.5in] flex-col gap-1 rounded-lg border-2 border-slate-900 bg-white p-4 text-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {program}
          </span>
          <QrCode className="h-8 w-8 text-slate-800" aria-hidden />
        </div>
        <p className="font-mono text-2xl font-bold leading-tight">{identifier}</p>
        <p className="text-sm text-slate-700">{name}</p>
        {needsCalibration && (
          <span className="mt-1 inline-block w-fit rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
            Calibration controlled
          </span>
        )}
      </div>

      <style>{`
        @media print {
          body { background: #fff; }
          .tool-label { border-color: #000; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}
