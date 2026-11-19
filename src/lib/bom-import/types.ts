/** Shared types for file-sourced BOM import. Pure — safe for unit tests. */

export const MAX_BOM_IMPORT_BYTES = 15 * 1024 * 1024;

export const BOM_IMPORT_EXTENSIONS = [
  ".pdf",
  ".xlsx",
  ".xls",
  ".csv",
  ".easm",
  ".edrw",
  ".eprt",
  ".sldasm",
  ".sldprt",
  ".slddrw",
] as const;

export type BomImportExtension = (typeof BOM_IMPORT_EXTENSIONS)[number];

export type BomSourceFamily =
  | "EXCEL"
  | "CSV"
  | "PDF"
  | "SOLIDWORKS"
  | "EDRAWINGS"
  | "UNKNOWN";

export type BomSourceKind =
  | "EXCEL"
  | "CSV"
  | "PDF_TEXT"
  | "PDF_LLM"
  | "SOLIDWORKS"
  | "EDRAWINGS"
  | "COMPANION";

export type BomLineFlag = "MATCHED" | "NEW_ITEM" | "NEEDS_REVIEW" | "INVALID";

export type BomColumnField =
  | "partNumber"
  | "description"
  | "quantity"
  | "uom"
  | "revision"
  | "findNumber"
  | "level"
  | "ignore";

export type BomColumnMapping = Partial<Record<BomColumnField, string>>;

export type ExtractedBomLine = {
  sortOrder: number;
  level?: number;
  findNumber?: string;
  partNumber?: string;
  description?: string;
  revision?: string;
  quantity?: number;
  uom?: string;
  rawText?: string;
  confidence: number;
  notes?: string;
};

export type ExtractedBom = {
  family: BomSourceFamily;
  sourceKind: BomSourceKind;
  parseStatus: "PARSED" | "NEEDS_EXPORT" | "PARTIAL";
  needsExport: boolean;
  extractionNotes: string;
  previewText: string;
  previewKind: "TEXT" | "PDF" | "NONE";
  headers: string[];
  mapping: BomColumnMapping;
  rows: string[][];
  lines: ExtractedBomLine[];
  assemblyPartNumber?: string;
  assemblyDescription?: string;
  assemblyRevision?: string;
};

export const COLUMN_ALIASES: Record<Exclude<BomColumnField, "ignore">, string[]> = {
  partNumber: [
    "partnumber", "partno", "part#", "pn", "p/n", "pno", "itemnumber", "itemno",
    "item#", "item", "component", "componentpn", "material", "materialno",
    "part", "sku", "cagepn",
  ],
  description: [
    "description", "desc", "itemdescription", "partdescription", "noun",
    "name", "title", "componentdescription",
  ],
  quantity: [
    "qty", "quantity", "qtyper", "qtyperassy", "qpa", "qpm", "count",
    "qtyreq", "requiredqty", "amount",
  ],
  uom: ["uom", "um", "unit", "unitofmeasure", "units", "uomcode"],
  revision: ["rev", "revision", "revno", "revid", "drawingrev"],
  findNumber: [
    "findnumber", "findno", "find#", "find", "balloon", "itemno",
    "itemnumber", "lineno", "linenumber", "dashno",
  ],
  level: ["level", "lvl", "indent", "bomlevel", "indentlevel", "depth"],
};

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extensionOf(fileName: string): string {
  const base = fileName.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

export function familyFromFileName(fileName: string): BomSourceFamily {
  switch (extensionOf(fileName)) {
    case ".xlsx":
    case ".xls":
      return "EXCEL";
    case ".csv":
      return "CSV";
    case ".pdf":
      return "PDF";
    case ".sldasm":
    case ".sldprt":
    case ".slddrw":
      return "SOLIDWORKS";
    case ".easm":
    case ".edrw":
    case ".eprt":
      return "EDRAWINGS";
    default:
      return "UNKNOWN";
  }
}

export const CAD_EXPORT_GUIDANCE =
  "SolidWorks and eDrawings files are proprietary binaries. This system can read OLE custom properties and any embedded text or preview it finds, but it cannot reliably extract a BOM table without the SolidWorks or eDrawings application. Export the BOM table to Excel (.xlsx) or a text PDF from SolidWorks (Insert > Tables > Bill of Materials, then Save As / export) or eDrawings, and upload that file — or attach it here as a companion file.";
