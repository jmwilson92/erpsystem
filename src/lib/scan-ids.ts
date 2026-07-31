/**
 * Typed scan identifiers.
 *
 * One scan box has to tell a part number from a bin code from a work order,
 * and today's labels encode bare values — `WH-LOC`, a raw WO number, a raw
 * part number — which are not distinguishable from each other. So every label
 * gains a type prefix, and this module is the single definition of that
 * encoding.
 *
 * This has to land before the scan primitive rather than alongside it. Labels
 * are physical: changing the convention after a warehouse is labelled means
 * reprinting the warehouse.
 *
 * Legacy bare scans are still parsed, but as a distinct, explicitly ambiguous
 * result. Guessing a type from the shape of an unprefixed string is how a bin
 * code gets consumed as a part number, so the caller is told it is a guess and
 * decides what to do rather than being handed a confident wrong answer.
 *
 * Pure module — no DB, no server imports — so it is usable from client
 * components and from the label printer alike.
 */

export const SCAN_TYPES = [
  "PART",
  "BIN",
  "WORK_ORDER",
  "LOT",
  "SERIAL",
  "BADGE",
  "PO",
  "SHIPMENT",
] as const;

export type ScanType = (typeof SCAN_TYPES)[number];

/**
 * Short, unambiguous prefixes. Kept to two or three characters because they
 * are printed under a Code 39 symbol on a small label, and Code 39 encodes
 * uppercase alphanumerics plus a few symbols — so the separator is `-` rather
 * than `:`, which Code 39 cannot represent.
 */
export const SCAN_PREFIXES: Record<ScanType, string> = {
  PART: "PN",
  BIN: "BIN",
  WORK_ORDER: "WO",
  LOT: "LOT",
  SERIAL: "SN",
  BADGE: "BDG",
  PO: "PO",
  SHIPMENT: "SHP",
};

export const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  PART: "Part",
  BIN: "Bin / location",
  WORK_ORDER: "Work order",
  LOT: "Lot",
  SERIAL: "Serial number",
  BADGE: "Badge",
  PO: "Purchase order",
  SHIPMENT: "Shipment",
};

const PREFIX_TO_TYPE = new Map<string, ScanType>(
  (Object.entries(SCAN_PREFIXES) as [ScanType, string][]).map(([t, p]) => [p, t])
);

const SEP = "-";

/** Encode a value for printing on a label. */
export function encodeScanId(type: ScanType, value: string): string {
  const v = (value || "").trim().toUpperCase();
  if (!v) throw new Error("Cannot encode an empty value");
  return `${SCAN_PREFIXES[type]}${SEP}${v}`;
}

export type ParsedScan =
  | { ok: true; type: ScanType; value: string; typed: true; raw: string }
  | {
      ok: true;
      type: ScanType | null;
      value: string;
      typed: false;
      /** Types this could plausibly be, best guess first. */
      candidates: ScanType[];
      raw: string;
    }
  | { ok: false; raw: string; reason: string };

/**
 * Heuristics for legacy unprefixed labels. Deliberately returns every
 * plausible type rather than picking one — the caller resolves against the
 * database and can disambiguate on a real hit.
 */
function guessCandidates(v: string): ScanType[] {
  const out: ScanType[] = [];
  // A bin has historically been WAREHOUSE-LOCATION, two dash-joined chunks.
  if (/^[A-Z0-9]+-[A-Z0-9-]+$/.test(v)) out.push("BIN");
  if (/^(S|B|M)?WO-?\d+/.test(v)) out.push("WORK_ORDER");
  if (/^PO-?\d+/.test(v)) out.push("PO");
  // Anything else could be a part number, a lot or a serial.
  out.push("PART", "LOT", "SERIAL");
  return [...new Set(out)];
}

/**
 * Parse whatever the scanner typed.
 *
 * Hardware wedges append Enter and sometimes pad with whitespace, and some
 * are configured for lower case, so input is trimmed and upper-cased before
 * anything else looks at it.
 */
export function parseScan(raw: string): ParsedScan {
  const cleaned = (raw || "").replace(/[\r\n\t]+/g, " ").trim().toUpperCase();
  if (!cleaned) return { ok: false, raw, reason: "Empty scan" };

  const idx = cleaned.indexOf(SEP);
  if (idx > 0) {
    const head = cleaned.slice(0, idx);
    const rest = cleaned.slice(idx + 1);
    const type = PREFIX_TO_TYPE.get(head);
    if (type && rest) {
      return { ok: true, type, value: rest, typed: true, raw: cleaned };
    }
  }

  return {
    ok: true,
    type: null,
    value: cleaned,
    typed: false,
    candidates: guessCandidates(cleaned),
    raw: cleaned,
  };
}

/** True when the string already carries a known type prefix. */
export function isTypedScanId(raw: string): boolean {
  const p = parseScan(raw);
  return p.ok && "typed" in p && p.typed;
}

/**
 * Human-readable form for printing under the barcode. The prefix is shown
 * because a person reading a label needs to know what it is too.
 */
export function scanIdCaption(type: ScanType, value: string): string {
  return `${SCAN_TYPE_LABELS[type]} · ${value}`;
}
