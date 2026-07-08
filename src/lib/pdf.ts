/**
 * Branded PDF generation helpers using jsPDF.
 * Use from client components or server actions for travelers, POs, packing lists, etc.
 */
import { jsPDF } from "jspdf";

export type PdfDocType =
  | "Work Order Traveler"
  | "Purchase Order"
  | "Packing List"
  | "Inspection Report"
  | "MRB Record"
  | "Invoice";

export function createBrandedPdf(docType: PdfDocType, title: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;

  // Header bar
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 612, 56, "F");
  doc.setFillColor(20, 184, 166); // teal-500
  doc.rect(0, 56, 612, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("ForgeERP", margin, 32);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(docType, 612 - margin, 32, { align: "right" });

  y = 80;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, margin, y);
  y += 20;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 24;

  return {
    doc,
    margin,
    y,
    line(text: string, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) {
      if (y > 720) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(opts?.size || 10);
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      if (opts?.color) doc.setTextColor(...opts.color);
      else doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(text, 612 - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 14 + 4;
    },
    gap(n = 8) {
      y += n;
    },
    save(filename: string) {
      doc.save(filename);
    },
    output() {
      return doc.output("blob");
    },
  };
}

/** Example: generate a simple WO traveler PDF payload as base64 data URI (server-safe). */
export function generateWorkOrderTravelerPdf(data: {
  number: string;
  partNumber?: string;
  quantity: number;
  status: string;
  steps: { stepNumber: number; title: string; status?: string }[];
}) {
  const pdf = createBrandedPdf("Work Order Traveler", data.number);
  pdf.line(`Part: ${data.partNumber || "N/A"}  |  Qty: ${data.quantity}  |  Status: ${data.status}`);
  pdf.gap(8);
  pdf.line("Operations / Steps", { bold: true, size: 11 });
  for (const s of data.steps) {
    pdf.line(
      `${s.stepNumber}. ${s.title}${s.status ? `  [${s.status}]` : ""}  ________  Date ______  Sign ______`
    );
  }
  pdf.gap(16);
  pdf.line("Configuration controlled document — ForgeERP", {
    size: 8,
    color: [148, 163, 184],
  });
  return pdf;
}
