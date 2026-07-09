"use client";

import { Button } from "@/components/ui/button";
import {
  generatePurchaseOrderPdf,
  type PurchaseOrderPdfData,
} from "@/lib/pdf";
import { FileDown, Printer } from "lucide-react";

export function PoPdfActions({ data }: { data: PurchaseOrderPdfData }) {
  function download() {
    const pdf = generatePurchaseOrderPdf(data);
    pdf.save(`${data.number}.pdf`);
  }

  function print() {
    const pdf = generatePurchaseOrderPdf(data);
    const blob = pdf.output();
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) {
      w.onload = () => {
        w.focus();
        w.print();
      };
    }
    // Fallback: just download if popup blocked
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" onClick={print}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button type="button" size="sm" onClick={download}>
        <FileDown className="h-4 w-4" />
        Save PDF
      </Button>
    </div>
  );
}
