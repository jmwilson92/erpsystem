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

export type PurchaseOrderPdfData = {
  number: string;
  orderDate: string;
  promisedDate?: string;
  paymentTerms: string;
  currency: string;
  notes?: string;
  clin?: string;
  projectLabel?: string;
  wbsLabel?: string;
  supplier: {
    name: string;
    code: string;
    address?: string;
    contactName?: string;
    contactEmail?: string;
  };
  shipTo?: string;
  buyerName?: string;
  lines: {
    lineNumber: number;
    partNumber?: string;
    description: string;
    quantity: number;
    uom: string;
    unitCost: number;
    promisedDate?: string;
  }[];
};

/** Vendor-ready purchase order PDF. */
export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData) {
  const pdf = createBrandedPdf("Purchase Order", data.number);
  const { doc, margin } = pdf;
  let y = 100;

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.setFont("helvetica", "bold");
  doc.text("Forge Dynamics LLC", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  y += 12;
  doc.text("1200 Precision Way · Huntsville, AL 35806", margin, y);
  y += 11;
  doc.text("purchasing@forgedynamics.example · CAGE 1FORG", margin, y);

  // Vendor block right
  let ry = 100;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  doc.text("VENDOR", 340, ry);
  ry += 12;
  doc.setFont("helvetica", "normal");
  doc.text(data.supplier.name, 340, ry);
  ry += 11;
  doc.setTextColor(100, 116, 139);
  doc.text(data.supplier.code, 340, ry);
  if (data.supplier.address) {
    const addrLines = doc.splitTextToSize(data.supplier.address, 220);
    ry += 11;
    doc.text(addrLines, 340, ry);
    ry += addrLines.length * 11;
  }
  if (data.supplier.contactName) {
    ry += 4;
    doc.text(data.supplier.contactName, 340, ry);
  }
  if (data.supplier.contactEmail) {
    ry += 11;
    doc.text(data.supplier.contactEmail, 340, ry);
  }

  y = Math.max(y, ry) + 20;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, 612 - margin, y);
  y += 16;

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  const meta = [
    [`PO Number`, data.number],
    [`PO Date`, data.orderDate],
    [`EDD / Promise`, data.promisedDate || "—"],
    [`Terms`, data.paymentTerms],
    [`Currency`, data.currency],
    [`CLIN`, data.clin || "—"],
    [`Project`, data.projectLabel || "—"],
    [`WBS`, data.wbsLabel || "—"],
    [`Buyer`, data.buyerName || "—"],
  ];
  for (const [label, val] of meta) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    doc.text(String(val), margin + 90, y);
    y += 13;
  }

  if (data.shipTo) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text("Ship To", margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    const shipLines = doc.splitTextToSize(data.shipTo, 500);
    doc.text(shipLines, margin, y);
    y += shipLines.length * 12 + 8;
  }

  y += 8;
  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y - 10, 612 - margin * 2, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("#", margin + 4, y);
  doc.text("Part / Description", margin + 24, y);
  doc.text("Qty", 380, y, { align: "right" });
  doc.text("UOM", 420, y);
  doc.text("Unit $", 480, y, { align: "right" });
  doc.text("Ext $", 612 - margin - 4, y, { align: "right" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  let total = 0;
  for (const line of data.lines) {
    if (y > 700) {
      doc.addPage();
      y = margin;
    }
    const ext = line.quantity * line.unitCost;
    total += ext;
    const desc = `${line.partNumber || "—"}${line.description ? ` — ${line.description}` : ""}`;
    const descLines = doc.splitTextToSize(desc, 280);
    doc.text(String(line.lineNumber), margin + 4, y);
    doc.text(descLines, margin + 24, y);
    doc.text(String(line.quantity), 380, y, { align: "right" });
    doc.text(line.uom || "EA", 420, y);
    doc.text(line.unitCost.toLocaleString("en-US", { minimumFractionDigits: 2 }), 480, y, {
      align: "right",
    });
    doc.text(ext.toLocaleString("en-US", { minimumFractionDigits: 2 }), 612 - margin - 4, y, {
      align: "right",
    });
    y += Math.max(14, descLines.length * 11 + 4);
  }

  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(380, y, 612 - margin, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total", 420, y);
  doc.text(
    total.toLocaleString("en-US", { style: "currency", currency: data.currency || "USD" }),
    612 - margin - 4,
    y,
    { align: "right" }
  );

  if (data.notes) {
    y += 28;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("Notes / Instructions", margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    const noteLines = doc.splitTextToSize(data.notes, 512);
    doc.text(noteLines, margin, y);
  }

  y = 740;
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Please acknowledge this PO and confirm delivery date. Configuration controlled — ForgeERP.",
    margin,
    y
  );

  return {
    save(filename: string) {
      doc.save(filename);
    },
    output() {
      return doc.output("blob");
    },
    doc,
  };
}
