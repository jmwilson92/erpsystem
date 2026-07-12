"use client";

import { Printer, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * White-paper frame for printable documents. Always renders light
 * (real paper is white) regardless of the app theme, with a toolbar
 * that hides itself when printing / saving as PDF.
 */
export function PrintFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-neutral-200 print:bg-white">
      <div className="fixed right-4 top-4 z-10 flex gap-2 print:hidden">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-400 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-500"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>
      <div className="mx-auto max-w-[820px] bg-white px-10 py-12 text-neutral-900 shadow-xl print:max-w-none print:px-0 print:py-0 print:shadow-none">
        {children}
      </div>
    </div>
  );
}
