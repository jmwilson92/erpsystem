/**
 * Format detection and extraction entrypoint for BOM file import.
 */
import {
  BOM_IMPORT_EXTENSIONS,
  CAD_EXPORT_GUIDANCE,
  MAX_BOM_IMPORT_BYTES,
  extensionOf,
  familyFromFileName,
  type BomColumnMapping,
  type BomSourceFamily,
  type ExtractedBom,
} from "./types";
import { extractTabularBom, parseCsvGrid, parseExcelBuffer } from "./parse-tabular";
import { extractPdfBom } from "./parse-pdf";
import { extractCadBom } from "./parse-cad";

export function assertSupportedUpload(fileName: string, size: number) {
  if (!Number.isFinite(size) || size <= 0) throw new Error("The file is empty");
  if (size > MAX_BOM_IMPORT_BYTES) {
    throw new Error(`Files must be ${Math.round(MAX_BOM_IMPORT_BYTES / (1024 * 1024))} MB or smaller`);
  }
  const ext = extensionOf(fileName);
  if (!(BOM_IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(
      `Unsupported file type (${ext || "unknown"}). Upload a PDF, Excel/CSV, eDrawings (.easm/.edrw/.eprt), or SolidWorks (.sldasm/.sldprt/.slddrw) file.`
    );
  }
}

export async function extractBomFromFile(opts: {
  fileName: string;
  bytes: Uint8Array;
  mime?: string;
  mapping?: BomColumnMapping;
  allowLlm?: boolean;
}): Promise<ExtractedBom> {
  assertSupportedUpload(opts.fileName, opts.bytes.byteLength);
  const family: BomSourceFamily = familyFromFileName(opts.fileName);

  if (family === "CSV") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(opts.bytes);
    const grid = parseCsvGrid(text);
    return extractTabularBom({ family: "CSV", ...grid, mapping: opts.mapping });
  }
  if (family === "EXCEL") {
    const grid = parseExcelBuffer(opts.bytes);
    return extractTabularBom({ family: "EXCEL", ...grid, mapping: opts.mapping });
  }
  if (family === "PDF") {
    return extractPdfBom(opts.bytes, { allowLlm: opts.allowLlm });
  }
  if (family === "SOLIDWORKS" || family === "EDRAWINGS") {
    return extractCadBom(opts.bytes, family, opts.fileName);
  }
  throw new Error("Unsupported file type. " + CAD_EXPORT_GUIDANCE);
}

export function extractTabularCompanion(opts: {
  fileName: string;
  bytes: Uint8Array;
  mapping?: BomColumnMapping;
}): ExtractedBom {
  const family = familyFromFileName(opts.fileName);
  if (family === "CSV") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(opts.bytes);
    const extracted = extractTabularBom({ family: "CSV", ...parseCsvGrid(text), mapping: opts.mapping });
    return { ...extracted, sourceKind: "COMPANION" };
  }
  if (family === "EXCEL") {
    const extracted = extractTabularBom({ family: "EXCEL", ...parseExcelBuffer(opts.bytes), mapping: opts.mapping });
    return { ...extracted, sourceKind: "COMPANION" };
  }
  throw new Error("Companion files must be Excel (.xlsx/.xls) or CSV.");
}

export { suggestColumnMapping } from "./parse-tabular";
