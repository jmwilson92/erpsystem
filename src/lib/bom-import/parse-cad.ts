/**
 * SolidWorks / eDrawings readers. These formats are proprietary.
 * We only surface what is genuinely present in the OLE compound file
 * (custom properties, preview, embedded XML/CSV-like text). We never
 * invent a BOM table.
 */
import * as XLSX from "xlsx";
import { CAD_EXPORT_GUIDANCE, type ExtractedBom, type ExtractedBomLine } from "./types";
import { applyColumnMapping, parseCsvGrid, suggestColumnMapping } from "./parse-tabular";

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

type CfbFile = {
  FullPaths: string[];
  FileIndex: Array<{ name?: string; size?: number; content?: Buffer | Uint8Array | number[] | string }>;
};

function asBuffer(content: unknown): Buffer | null {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (Array.isArray(content)) return Buffer.from(content);
  if (typeof content === "string") return Buffer.from(content, "binary");
  return null;
}

function readableStrings(buf: Buffer): string[] {
  const out: string[] = [];
  // UTF-16LE runs of printable chars
  let run: number[] = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8);
    if (buf[i + 1] === 0 && c >= 32 && c < 127) run.push(c);
    else {
      if (run.length >= 4) out.push(String.fromCharCode(...run));
      run = [];
    }
  }
  if (run.length >= 4) out.push(String.fromCharCode(...run));
  // ASCII runs
  const ascii = buf.toString("latin1");
  const matches = ascii.match(/[\x20-\x7e]{6,}/g) || [];
  out.push(...matches.map((s) => s.trim()).filter(Boolean));
  return out;
}

function looksLikeBomHeader(s: string): boolean {
  const n = s.toLowerCase();
  return /part\s*(number|no|#)/i.test(n) && /(qty|quantity)/i.test(n);
}

function tryParseEmbeddedTable(strings: string[]): ExtractedBomLine[] {
  const blob = strings.join("\n");
  // XML-ish rows
  const itemTags = blob.match(/<Item[\s\S]*?<\/Item>|<Row[\s\S]*?<\/Row>/gi) || [];
  if (itemTags.length >= 1) {
    const lines: ExtractedBomLine[] = [];
    for (const tag of itemTags) {
      const attr = (name: string) => {
        const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, "i"));
        return m ? m[1] : "";
      };
      const text = (name: string) => {
        const m = tag.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"));
        return m ? m[1] : "";
      };
      const partNumber = (attr("PartNumber") || attr("partNumber") || text("PartNumber") || text("Name") || "").toUpperCase();
      const description = attr("Description") || text("Description");
      const qtyRaw = attr("Qty") || attr("Quantity") || text("Qty") || text("Quantity");
      const quantity = qtyRaw ? Number(qtyRaw) : undefined;
      if (!partNumber && !description) continue;
      lines.push({
        sortOrder: lines.length + 1,
        partNumber: partNumber || undefined,
        description: description || undefined,
        quantity: Number.isFinite(quantity) ? quantity : undefined,
        uom: (attr("Uom") || attr("UOM") || text("UOM") || "").toUpperCase() || undefined,
        rawText: tag.slice(0, 300),
        confidence: 0.55,
      });
    }
    if (lines.length) return lines;
  }

  const tableish = strings.filter((s) => s.includes(",") || s.includes("\t") || looksLikeBomHeader(s));
  if (tableish.length >= 2 && tableish.some(looksLikeBomHeader)) {
    const csv = tableish.join("\n");
    const grid = parseCsvGrid(csv);
    if (grid.headers.length && grid.rows.length) {
      return applyColumnMapping(grid.headers, grid.rows, suggestColumnMapping(grid.headers)).lines;
    }
  }
  return [];
}

function extractProperties(strings: string[]): Record<string, string> {
  const props: Record<string, string> = {};
  const keys = [
    "PartNumber", "Part Number", "Number", "Description", "Revision",
    "Title", "Author", "FileName", "SW-File Name", "SW-Last Saved With",
    "Configuration", "Material", "Base Item",
  ];
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i].trim();
    for (const key of keys) {
      if (s === key && strings[i + 1] && !props[key]) {
        const val = strings[i + 1].trim();
        if (val && val.length < 200) props[key] = val;
      }
    }
    const kv = s.match(/^(PartNumber|Part Number|Revision|Description|Title)\s*[:=]\s*(.+)$/i);
    if (kv) props[kv[1]] = kv[2].trim();
  }
  return props;
}

function emptyCadResult(
  family: "SOLIDWORKS" | "EDRAWINGS",
  notes: string,
  preview: string
): ExtractedBom {
  return {
    family,
    sourceKind: family,
    parseStatus: "NEEDS_EXPORT",
    needsExport: true,
    extractionNotes: notes,
    previewText: preview,
    previewKind: preview ? "TEXT" : "NONE",
    headers: [],
    mapping: {},
    rows: [],
    lines: [],
  };
}

export function isOleCompound(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== OLE_MAGIC[i]) return false;
  return true;
}

export function isZipContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== ZIP_MAGIC[i]) return false;
  return true;
}

export function extractCadBom(
  bytes: Uint8Array,
  family: "SOLIDWORKS" | "EDRAWINGS",
  fileName: string
): ExtractedBom {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (isZipContainer(buf)) {
    return emptyCadResult(
      family,
      `${fileName} looks like a packaged/zipped ${family === "SOLIDWORKS" ? "SolidWorks" : "eDrawings"} file. ` + CAD_EXPORT_GUIDANCE,
      ""
    );
  }
  if (!isOleCompound(buf)) {
    return emptyCadResult(
      family,
      `${fileName} is not a readable OLE compound document, so no BOM table can be extracted. ` + CAD_EXPORT_GUIDANCE,
      ""
    );
  }

  let cfb: CfbFile;
  try {
    const CFB = (XLSX as unknown as { CFB: { read: (d: Buffer, o: { type: string }) => CfbFile } }).CFB;
    cfb = CFB.read(buf, { type: "buffer" });
  } catch {
    return emptyCadResult(
      family,
      `${fileName} opened as an OLE file but its streams could not be read. ` + CAD_EXPORT_GUIDANCE,
      ""
    );
  }

  const streamSummaries: string[] = [];
  const allStrings: string[] = [];
  const paths = cfb.FullPaths || [];
  const files = cfb.FileIndex || [];
  for (let i = 0; i < files.length; i++) {
    const entry = files[i];
    const path = paths[i] || entry?.name || `stream-${i}`;
    const content = asBuffer(entry?.content);
    const size = content?.length ?? entry?.size ?? 0;
    streamSummaries.push(`${path} (${size} bytes)`);
    if (content && size > 0 && size < 5_000_000) {
      allStrings.push(...readableStrings(content));
    }
  }

  const lines = tryParseEmbeddedTable(allStrings);
  const props = extractProperties(allStrings);
  const previewParts = [
    `Streams in ${fileName}:`,
    ...streamSummaries.slice(0, 30),
    streamSummaries.length > 30 ? `… ${streamSummaries.length - 30} more` : "",
    Object.keys(props).length ? "Custom / document properties:" : "",
    ...Object.entries(props).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);

  const assemblyPartNumber = (props.PartNumber || props["Part Number"] || props.Number || "").toUpperCase() || undefined;
  const assemblyDescription = props.Description || props.Title || undefined;
  const assemblyRevision = props.Revision || undefined;

  if (lines.length) {
    const grid = parseCsvGrid(
      ["Find,Part Number,Description,Rev,Qty,UoM", ...lines.map((l) =>
        [l.findNumber, l.partNumber, l.description, l.revision, l.quantity, l.uom].map((x) => x ?? "").join(",")
      )].join("\n")
    );
    return {
      family,
      sourceKind: family,
      parseStatus: "PARTIAL",
      needsExport: false,
      extractionNotes:
        `Embedded text that looks like a BOM table was found in ${fileName}. Review every line — SolidWorks/eDrawings tables are not a published format, so this is best-effort, not a certified parse.`,
      previewText: previewParts.join("\n"),
      previewKind: "TEXT",
      headers: grid.headers,
      mapping: suggestColumnMapping(grid.headers),
      rows: grid.rows,
      lines,
      assemblyPartNumber,
      assemblyDescription,
      assemblyRevision,
    };
  }

  const propPreview = previewParts.join("\n");
  const notes = [
    `Opened ${fileName} as an OLE compound document (${streamSummaries.length} streams).`,
    Object.keys(props).length
      ? `Found document properties (${Object.keys(props).join(", ")}), but no embedded BOM table.`
      : "No embedded BOM table was present.",
    CAD_EXPORT_GUIDANCE,
  ].join(" ");

  return {
    ...emptyCadResult(family, notes, propPreview),
    assemblyPartNumber,
    assemblyDescription,
    assemblyRevision,
  };
}

/** Minimal OLE compound document used by tests (no BOM table). */
export function buildEmptyOleFixture(): Buffer {
  const CFB = (XLSX as unknown as {
    CFB: {
      write: (f: unknown, o: { type: string }) => Buffer | Uint8Array;
      utils: { cfb_new: () => unknown; cfb_add: (f: unknown, path: string, content: Buffer) => void };
    };
  }).CFB;
  const file = CFB.utils.cfb_new();
  CFB.utils.cfb_add(file, "Custom", Buffer.from("Description\0A\0S\0s\0e\0m\0b\0l\0y\0\0\0PartNumber\0W\0G\0-\0S\0W\0\0\0", "latin1"));
  CFB.utils.cfb_add(file, "\x05SummaryInformation", Buffer.from("SolidWorks fixture without a BOM table"));
  const out = CFB.write(file, { type: "buffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
