/**
 * Excel / CSV BOM table parsing with header auto-mapping.
 */
import * as XLSX from "xlsx";
import { parseDelimited } from "@/lib/services/data-import";
import {
  COLUMN_ALIASES,
  type BomColumnField,
  type BomColumnMapping,
  type ExtractedBom,
  type ExtractedBomLine,
  normalizeHeader,
} from "./types";

const MAPPABLE: Exclude<BomColumnField, "ignore">[] = [
  "partNumber",
  "description",
  "quantity",
  "uom",
  "revision",
  "findNumber",
  "level",
];

export function suggestColumnMapping(headers: string[]): BomColumnMapping {
  const mapping: BomColumnMapping = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));

  const take = (field: Exclude<BomColumnField, "ignore">, aliases: string[]) => {
    if (mapping[field]) return;
    const exact = normalized.find((h) => h.key && !used.has(h.raw) && aliases.includes(h.key));
    if (exact) {
      mapping[field] = exact.raw;
      used.add(exact.raw);
      return;
    }
    const fuzzy = normalized.find(
      (h) => h.key && !used.has(h.raw) && aliases.some((a) => a.length >= 3 && (h.key.includes(a) || a.includes(h.key)))
    );
    if (fuzzy) {
      mapping[field] = fuzzy.raw;
      used.add(fuzzy.raw);
    }
  };

  // Resolve find-number / balloon columns first so "Item No" is not stolen as a PN.
  take("findNumber", ["findnumber", "findno", "find", "balloon", "itemno", "itemnumber", "lineno", "linenumber"]);
  for (const field of MAPPABLE) take(field, COLUMN_ALIASES[field]);
  return mapping;
}

function cell(row: Record<string, string>, header: string | undefined): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

function parseQty(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.+-eE]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseLevel(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function applyColumnMapping(
  headers: string[],
  rows: string[][],
  mapping: BomColumnMapping
): { lines: ExtractedBomLine[]; assemblyPartNumber?: string; assemblyDescription?: string; assemblyRevision?: string } {
  const lines: ExtractedBomLine[] = [];
  let assemblyPartNumber: string | undefined;
  let assemblyDescription: string | undefined;
  let assemblyRevision: string | undefined;
  let skippedAssembly = false;

  rows.forEach((rawRow, idx) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = rawRow[i] ?? "";
    });
    const partNumber = cell(rec, mapping.partNumber).toUpperCase();
    const description = cell(rec, mapping.description);
    const revision = cell(rec, mapping.revision);
    const findNumber = cell(rec, mapping.findNumber);
    const uom = cell(rec, mapping.uom).toUpperCase();
    const quantity = parseQty(cell(rec, mapping.quantity));
    const level = parseLevel(cell(rec, mapping.level));
    const rawText = rawRow.map((c) => c.trim()).filter(Boolean).join(" | ");
    if (!partNumber && !description && quantity == null && !findNumber) return;

    // First level-0 / indent-0 row is treated as the assembly header when present.
    if (!skippedAssembly && (level === 0 || level === 0.0) && partNumber) {
      skippedAssembly = true;
      assemblyPartNumber = partNumber;
      assemblyDescription = description || undefined;
      assemblyRevision = revision || undefined;
      return;
    }

    const missingPn = !partNumber;
    const badQty = quantity == null || !(quantity > 0);
    let confidence = 0.95;
    if (missingPn) confidence -= 0.4;
    if (badQty) confidence -= 0.25;
    if (!description) confidence -= 0.05;
    confidence = Math.max(0.2, Math.min(1, confidence));

    lines.push({
      sortOrder: lines.length + 1,
      level,
      findNumber: findNumber || undefined,
      partNumber: partNumber || undefined,
      description: description || undefined,
      revision: revision || undefined,
      quantity,
      uom: uom || undefined,
      rawText,
      confidence,
      notes: missingPn || badQty ? "Needs a part number and a quantity greater than zero." : undefined,
    });
    void idx;
  });

  return { lines, assemblyPartNumber, assemblyDescription, assemblyRevision };
}

function workbookToGrid(wb: XLSX.WorkBook): { headers: string[]; rows: string[][] } {
  const bomSheet =
    wb.SheetNames.find((n) => /bom|bill\s*of\s*materials|parts\s*list/i.test(n)) ||
    wb.SheetNames[0];
  if (!bomSheet) return { headers: [], rows: [] };
  const sheet = wb.Sheets[bomSheet];
  const grid = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  const nonempty = grid
    .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").trim()) : []))
    .filter((row) => row.some((c) => c !== ""));
  if (nonempty.length === 0) return { headers: [], rows: [] };
  // Pick the first row that looks like headers (has 2+ non-numeric cells).
  let headerIdx = 0;
  for (let i = 0; i < Math.min(8, nonempty.length); i++) {
    const cells = nonempty[i];
    const textish = cells.filter((c) => c && !/^\d+(\.\d+)?$/.test(c)).length;
    if (textish >= 2) {
      headerIdx = i;
      break;
    }
  }
  const headers = nonempty[headerIdx].map((h, i) => h || `Column ${i + 1}`);
  const rows = nonempty.slice(headerIdx + 1).map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    return padded.slice(0, headers.length);
  });
  return { headers, rows };
}

export function parseCsvGrid(text: string): { headers: string[]; rows: string[][] } {
  const table = parseDelimited(text);
  if (table.length === 0) return { headers: [], rows: [] };
  const headers = table[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = table.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    return padded.slice(0, headers.length);
  });
  return { headers, rows };
}

export function parseExcelBuffer(bytes: Uint8Array): { headers: string[]; rows: string[][] } {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });
  return workbookToGrid(wb);
}

export function extractTabularBom(opts: {
  family: "EXCEL" | "CSV";
  headers: string[];
  rows: string[][];
  mapping?: BomColumnMapping;
}): ExtractedBom {
  const mapping = opts.mapping && Object.keys(opts.mapping).length
    ? opts.mapping
    : suggestColumnMapping(opts.headers);
  const applied = applyColumnMapping(opts.headers, opts.rows, mapping);
  const notes: string[] = [];
  if (!mapping.partNumber) notes.push("No part-number column was auto-detected — adjust the mapping.");
  if (!mapping.quantity) notes.push("No quantity column was auto-detected — adjust the mapping.");
  if (applied.lines.length === 0) notes.push("No component rows were found with the current mapping.");
  const preview = [
    opts.headers.join("\t"),
    ...opts.rows.slice(0, 40).map((r) => r.join("\t")),
    opts.rows.length > 40 ? `… ${opts.rows.length - 40} more rows` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    family: opts.family,
    sourceKind: opts.family,
    parseStatus: applied.lines.length ? "PARSED" : "PARTIAL",
    needsExport: false,
    extractionNotes: notes.join(" ") || "Columns were auto-mapped. Adjust them if a field landed on the wrong header.",
    previewText: preview,
    previewKind: "TEXT",
    headers: opts.headers,
    mapping,
    rows: opts.rows,
    lines: applied.lines,
    assemblyPartNumber: applied.assemblyPartNumber,
    assemblyDescription: applied.assemblyDescription,
    assemblyRevision: applied.assemblyRevision,
  };
}
