/**
 * PDF BOM extraction: content-stream text first, then an optional LLM pass.
 * Vision is used only when page images can actually be produced — we do not
 * invent a rasterizer or pretend a scanned drawing was read.
 */
import zlib from "node:zlib";
import { grokChat, grokConfigured } from "@/lib/services/grok";
import { applyColumnMapping, parseCsvGrid, suggestColumnMapping } from "./parse-tabular";
import type { ExtractedBom, ExtractedBomLine } from "./types";

function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function textFromContentStream(content: string): string {
  const pieces: string[] = [];
  const tokenRe = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[(?:(?:\\.|[^\\]])*)\]\s*TJ|\b(?:Td|TD|T\*|Tm)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(content))) {
    const tok = m[0];
    if (/\b(?:Td|TD|T\*|Tm)\b$/.test(tok) && !tok.includes("(")) {
      pieces.push("\n");
      continue;
    }
    if (tok.trim().endsWith("TJ")) {
      const inner = tok.slice(tok.indexOf("[") + 1, tok.lastIndexOf("]"));
      const strs = inner.match(/\((?:\\.|[^\\)])*\)/g) || [];
      pieces.push(strs.map((s) => decodePdfString(s.slice(1, -1))).join(""));
      continue;
    }
    const inner = tok.slice(1, tok.lastIndexOf(")"));
    pieces.push(decodePdfString(inner));
  }
  return pieces.join("").replace(/[ \t]{2,}/g, "\t").replace(/ *\n */g, "\n").trim();
}

function inflatePdfStreams(bytes: Buffer): string {
  const latin = bytes.toString("latin1");
  const chunks: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const payload = Buffer.from(m[1], "latin1");
    // Look behind a short window for /Filter
    const start = Math.max(0, m.index - 400);
    const dict = latin.slice(start, m.index);
    const flate = /\/Filter\s*\/FlateDecode/.test(dict) || /\/FlateDecode/.test(dict);
    try {
      const decoded = flate ? zlib.inflateSync(payload) : payload;
      const text = decoded.toString("latin1");
      const extracted = textFromContentStream(text);
      chunks.push(extracted || text);
    } catch {
      // Not a flate stream we can unpack — still try raw operators.
      chunks.push(textFromContentStream(payload.toString("latin1")));
    }
  }
  // Uncompressed literal text as a backstop (simple fixture PDFs).
  if (chunks.every((c) => !c.trim())) {
    chunks.push(textFromContentStream(latin));
    const parens = latin.match(/\((?:\\.|[^\\)])+\)/g) || [];
    if (parens.length) {
      chunks.push(parens.map((s) => decodePdfString(s.slice(1, -1))).join(" "));
    }
  }
  return chunks.join("\n");
}

/** Visible text from a PDF, best-effort without native rasterizers. */
export function extractPdfPlainText(bytes: Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const raw = inflatePdfStreams(buf);
  return raw
    .replace(/\0/g, " ")
    .replace(/[^\S\n]{2,}/g, "\t")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHeaderLine(line: string): boolean {
  const n = line.toLowerCase();
  return (
    /part\s*(no|number|#|num)/i.test(n) &&
    /(qty|quantity)/i.test(n)
  ) || (
    /\bp\/?n\b/i.test(n) && /(qty|quantity|desc)/i.test(n)
  );
}

function parseTextTable(text: string): ExtractedBomLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex(looksLikeHeaderLine);
  if (headerIdx < 0) {
    // Try whitespace/tab rows that start with a find-number or a PN-like token.
    return rowsFromLooseLines(lines);
  }
  const headerLine = lines[headerIdx];
  const delim = headerLine.includes("\t") ? "\t" : /\s{2,}/;
  const headers = headerLine.split(delim).map((h) => h.trim()).filter(Boolean);
  if (headers.length < 2) return rowsFromLooseLines(lines);
  const mapping = suggestColumnMapping(headers);
  const rows = lines.slice(headerIdx + 1).map((line) => {
    const cells = line.split(delim).map((c) => c.trim());
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });
  const mapped = applyColumnMapping(headers, rows, mapping).lines;
  return mapped.length ? mapped : rowsFromLooseLines(lines);
}

function tokenizeBomLine(line: string): string[] {
  const wide = line.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  if (wide.length >= 3) return wide;
  return line.trim().split(/\s+/).filter(Boolean);
}

function rowsFromLooseLines(lines: string[]): ExtractedBomLine[] {
  const out: ExtractedBomLine[] = [];
  for (const line of lines) {
    if (looksLikeHeaderLine(line)) continue;
    const parts = tokenizeBomLine(line);
    if (parts.length < 2) continue;
    let findNumber: string | undefined;
    let idx = 0;
    if (/^\d+[A-Za-z]?$/.test(parts[0]) && parts.length >= 3) {
      findNumber = parts[0];
      idx = 1;
    }
    const partNumber = (parts[idx] || "").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._\/-]{1,40}$/.test(partNumber)) continue;
    let qtyIdx = -1;
    let uom: string | undefined;
    for (let i = parts.length - 1; i > idx; i--) {
      if (/^[A-Z]{1,6}$/i.test(parts[i]) && i - 1 > idx && /^\d+(\.\d+)?$/.test(parts[i - 1])) {
        uom = parts[i].toUpperCase();
        qtyIdx = i - 1;
        break;
      }
      if (/^\d+(\.\d+)?$/.test(parts[i])) {
        qtyIdx = i;
        break;
      }
    }
    const quantity = qtyIdx > idx ? Number(parts[qtyIdx]) : undefined;
    const description = parts.slice(idx + 1, qtyIdx > idx ? qtyIdx : undefined).join(" ").trim();
    out.push({
      sortOrder: out.length + 1,
      findNumber,
      partNumber,
      description: description || undefined,
      quantity,
      uom,
      rawText: line,
      confidence: quantity && partNumber ? 0.7 : 0.45,
    });
  }
  return out;
}

function parseJsonLines(payload: string): ExtractedBomLine[] {
  const match = payload.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const rows = JSON.parse(match[0]) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.map((row, i) => {
      const quantity = row.quantity == null || row.quantity === "" ? undefined : Number(row.quantity);
      return {
        sortOrder: i + 1,
        level: row.level == null ? undefined : Number(row.level),
        findNumber: row.findNumber ? String(row.findNumber) : undefined,
        partNumber: row.partNumber ? String(row.partNumber).toUpperCase() : undefined,
        description: row.description ? String(row.description) : undefined,
        revision: row.revision ? String(row.revision) : undefined,
        quantity: Number.isFinite(quantity) ? quantity : undefined,
        uom: row.uom ? String(row.uom).toUpperCase() : undefined,
        rawText: JSON.stringify(row),
        confidence: 0.6,
      } satisfies ExtractedBomLine;
    }).filter((l) => l.partNumber || l.description);
  } catch {
    return [];
  }
}

export async function llmParseBomText(text: string): Promise<ExtractedBomLine[]> {
  if (!grokConfigured()) return [];
  const clipped = text.slice(0, 12000);
  const raw = await grokChat({
    temperature: 0,
    maxTokens: 1000,
    timeoutMs: 25000,
    system:
      "You extract bill-of-materials tables. Return ONLY a JSON array of objects with keys partNumber, description, quantity, uom, revision, findNumber, level. Do not wrap in markdown. Skip title/header rows. quantity must be numeric.",
    user: clipped,
  });
  return parseJsonLines(raw);
}

function gridFromLines(lines: ExtractedBomLine[]): { headers: string[]; rows: string[][] } {
  const headers = ["Find", "Part Number", "Description", "Rev", "Qty", "UoM", "Level"];
  const rows = lines.map((l) => [
    l.findNumber || "",
    l.partNumber || "",
    l.description || "",
    l.revision || "",
    l.quantity == null ? "" : String(l.quantity),
    l.uom || "",
    l.level == null ? "" : String(l.level),
  ]);
  return { headers, rows };
}

export async function extractPdfBom(
  bytes: Uint8Array,
  opts?: { allowLlm?: boolean }
): Promise<ExtractedBom> {
  const text = extractPdfPlainText(bytes);
  let lines = text ? parseTextTable(text) : [];
  let sourceKind: ExtractedBom["sourceKind"] = "PDF_TEXT";
  const notes: string[] = [];

  const weak = lines.length < 1 || lines.every((l) => !l.partNumber || l.quantity == null);
  if (weak && opts?.allowLlm !== false && text.trim().length >= 40) {
    try {
      const llmLines = await llmParseBomText(text);
      if (llmLines.length > lines.length) {
        lines = llmLines;
        sourceKind = "PDF_LLM";
        notes.push("The BOM table was read with a second-pass language model over the extracted PDF text.");
      }
    } catch {
      notes.push("A language-model pass over the PDF text was unavailable. The text-only parse is shown.");
    }
  }

  if (!text.trim()) {
    notes.push(
      "This PDF has no extractable text (it is likely a scanned drawing). This environment cannot rasterize pages for a vision pass. Export the BOM table to Excel or a text-based PDF and upload that, or attach it as a companion file."
    );
    return {
      family: "PDF",
      sourceKind: "PDF_TEXT",
      parseStatus: "NEEDS_EXPORT",
      needsExport: true,
      extractionNotes: notes.join(" "),
      previewText: "",
      previewKind: "PDF",
      headers: [],
      mapping: {},
      rows: [],
      lines: [],
    };
  }

  if (lines.length === 0) {
    notes.push(
      "Text was extracted, but no BOM table could be recognized. Adjust nothing here — export the table to Excel or a text PDF, or attach a companion file."
    );
  }

  const grid = lines.length ? gridFromLines(lines) : parseCsvGrid(text);
  return {
    family: "PDF",
    sourceKind,
    parseStatus: lines.length ? "PARSED" : "NEEDS_EXPORT",
    needsExport: lines.length === 0,
    extractionNotes: notes.join(" ") || "BOM rows were read from the PDF text layer.",
    previewText: text.slice(0, 8000),
    previewKind: "PDF",
    headers: grid.headers,
    mapping: suggestColumnMapping(grid.headers),
    rows: grid.rows,
    lines,
  };
}
