/**
 * Policy for Carina's read-only record lookup.
 * Product docs are one source, not a gate. Payroll, HR, salary,
 * finance-balance and cross-tenant data are never retrieved.
 */

export const LOOKUP_MAX_HOPS = 4;
export const LOOKUP_SEARCH_LIMIT = 8;

export type LookupEntityId =
  | "part"
  | "inventory"
  | "work_order"
  | "sales_order"
  | "quote"
  | "purchase_order"
  | "vendor"
  | "customer"
  | "project"
  | "budget"
  | "ncr"
  | "mrb"
  | "bom"
  | "serial"
  | "lot"
  | "asset"
  | "work_center"
  | "shipment"
  | "rma"
  | "quality"
  | "document";

export const LOOKUP_ENTITIES: LookupEntityId[] = [
  "part",
  "inventory",
  "work_order",
  "sales_order",
  "quote",
  "purchase_order",
  "vendor",
  "customer",
  "project",
  "budget",
  "ncr",
  "mrb",
  "bom",
  "serial",
  "lot",
  "asset",
  "work_center",
  "shipment",
  "rma",
  "quality",
  "document",
];

/** Modules whose *.view permission is required (any one is enough). */
export const LOOKUP_PERMISSIONS: Record<LookupEntityId, string[]> = {
  part: ["items", "inventory"],
  inventory: ["inventory"],
  work_order: ["work-orders"],
  sales_order: ["sales"],
  quote: ["sales"],
  purchase_order: ["purchasing"],
  vendor: ["suppliers"],
  customer: ["customers"],
  project: ["pmo", "projects"],
  budget: ["pmo", "projects"],
  ncr: ["quality"],
  mrb: ["mrb"],
  bom: ["bom"],
  serial: ["inventory", "work-orders"],
  lot: ["inventory"],
  asset: ["inventory"],
  work_center: ["workcenters", "planning"],
  shipment: ["shipping"],
  rma: ["quality"],
  quality: ["quality", "qa"],
  document: ["docs", "cm"],
};

export const LOOKUP_LABELS: Record<LookupEntityId, string> = {
  part: "parts",
  inventory: "inventory",
  work_order: "work orders",
  sales_order: "sales orders",
  quote: "quotes",
  purchase_order: "purchase orders",
  vendor: "vendors",
  customer: "customers",
  project: "projects",
  budget: "budgets",
  ncr: "NCRs",
  mrb: "MRB cases",
  bom: "BOMs",
  serial: "serials",
  lot: "lots",
  asset: "assets",
  work_center: "work centers",
  shipment: "shipments",
  rma: "RMAs",
  quality: "quality records",
  document: "documents",
};

const SENSITIVE_KEY =
  /^(.*\b)?(standardCost|lastBuyCost|averageCost|unitCost|unitPrice|price|cost|amount|salary|salaries|wage|wages|payroll|compensation|balance|revenue|margin|profit|debit|credit|taxId|ssn|bank|routing|accountNumber|actualOther|actualCost|actualTotal|budgetCost|budgetAmount|deposit|hourlyRate|payRate|iban|swift)(\b.*)?$/i;

export function isSensitiveLookupKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function stripSensitiveFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripSensitiveFields(v)) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveLookupKey(k)) continue;
      out[k] = stripSensitiveFields(v);
    }
    return out as T;
  }
  return value;
}

export function isExcludedLookupQuery(question: string): boolean {
  const t = question.toLowerCase();
  if (
    /\b(other|another|different)\s+(tenant|company|workspace)s?\b|\bcross[ -]?tenant\b|\banother customer'?s data\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(payroll|paycheck|pay slip|salary|salaries|wage|wages|compensation|hourly rate|pay rate)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(hr records?|human resources|employee(?:s)?(?:'|’)s?\s+(?:file|record|salary|pay)|list(?:ing)? (?:all )?employees|headcount pay|background check)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(account|cash|bank|gl|trial|financial|ledger|ar|ap|receivable|payable)\s+balances?\b|\b(revenue|profit|gross margin|ebitda)\b|\bgaap reports?\b/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

export const LOOKUP_EXCLUDED_MESSAGE =
  "I don’t look up payroll, HR, salary, financial balances or other tenants’ data. Open the authorized module for that, or use the Support tab for a human.";

export type RecordHint = { entity: LookupEntityId; idOrNumber: string };

export function parseRecordHints(question: string): RecordHint[] {
  const hints: RecordHint[] = [];
  const seen = new Set<string>();
  const prefixes: Partial<Record<LookupEntityId, string>> = {
    work_order: "WO-",
    sales_order: "SO-",
    purchase_order: "PO-",
    quote: "QT-",
    ncr: "NCR-",
    mrb: "MRB-",
    rma: "RMA-",
  };
  const add = (entity: LookupEntityId, raw: string) => {
    let idOrNumber = raw.trim().replace(/\s+/g, "-");
    if (idOrNumber.length < 2) return;
    const prefix = prefixes[entity];
    if (prefix && /^\d/.test(idOrNumber)) idOrNumber = prefix + idOrNumber;
    if (prefix && new RegExp(`^${prefix.replace("-", "[- ]?")}`, "i").test(idOrNumber)) {
      idOrNumber = prefix + idOrNumber.replace(new RegExp(`^${prefix.replace("-", "[- ]?")}`, "i"), "");
    }
    const key = `${entity}:${idOrNumber.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push({ entity, idOrNumber });
  };

  const pairs: [LookupEntityId, RegExp][] = [
    ["work_order", /\b(?:work orders?[- ]#?|WO[- ]?)(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["sales_order", /\b(?:sales orders?[- ]#?|SO[- ]?)(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["purchase_order", /\b(?:purchase orders?[- ]#?|PO[- ]?)(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["quote", /\b(?:quotes?[- ]#?|QT[- ]?)(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["ncr", /\bNCR[- ]?(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["mrb", /\bMRB[- ]?(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["rma", /\bRMA[- ]?(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["shipment", /\b(?:SHP|SHIP)[- ]?(\d{2,}[A-Za-z0-9-]*)\b/gi],
    ["serial", /\b(?:SN|serial(?: number)?)[:\s#]+([A-Z0-9][A-Z0-9._-]{1,})\b/gi],
    ["lot", /\b(?:LOT[- ]|#LOT[- ])([A-Z0-9][A-Z0-9._-]{1,})\b/gi],
    ["part", /\b(?:PN|part(?: number)?)[:\s#]+([A-Z0-9][A-Z0-9._/-]{1,})\b/gi],
    ["project", /\b(?:PRJ[- ]?|projects?[- ]#)([A-Z0-9][A-Z0-9._-]{1,})\b/gi],
  ];

  for (const [entity, re] of pairs) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(question))) {
      add(entity, m[1] || m[0]);
    }
  }
  return hints;
}

export function wantsRecordLookup(question: string): boolean {
  if (isExcludedLookupQuery(question)) return false;
  const t = question.toLowerCase();
  if (
    /\b(how do i|how do we|how to|show me how|walk me through|steps to|can i|should i)\b/.test(
      t
    ) &&
    !/\b(status of|look up|lookup|find)\b/.test(t)
  ) {
    return false;
  }
  if (parseRecordHints(question).length > 0) return true;
  return /\b(status of|where is|look up|lookup|find|search for|on hand|in stock|which bin|what(?:'s| is) the (?:status|location|qty|quantity)|who is the (?:customer|vendor|supplier|assignee)|open (?:wo|work order|po|so|ncr|rma|quote)s?\b)/i.test(
    question
  );
}

export function isLookupEntity(value: unknown): value is LookupEntityId {
  return typeof value === "string" && (LOOKUP_ENTITIES as string[]).includes(value);
}

export type LookupHit = {
  entity: LookupEntityId;
  id: string;
  number: string;
  title: string;
  status?: string;
  href: string;
  summary: string;
  fields: Record<string, string | number | boolean | null>;
};

export type LookupFailureReason =
  | "permission-denied"
  | "not-found"
  | "excluded"
  | "unsigned"
  | "invalid";

export type LookupResult =
  | { ok: true; hits: LookupHit[] }
  | {
      ok: false;
      reason: LookupFailureReason;
      message: string;
      entity?: LookupEntityId;
    };

export function permissionDeniedResult(entity: LookupEntityId): LookupResult {
  return {
    ok: false,
    reason: "permission-denied",
    entity,
    message: `You don’t have permission to view ${LOOKUP_LABELS[entity]} in this workspace.`,
  };
}

export function notFoundResult(entity: LookupEntityId, idOrNumber: string): LookupResult {
  return {
    ok: false,
    reason: "not-found",
    entity,
    message: `I couldn’t find ${LOOKUP_LABELS[entity]} matching “${idOrNumber.slice(0, 80)}” in this workspace.`,
  };
}

export function formatLookupReply(hits: LookupHit[], question?: string): string {
  if (!hits.length) {
    return "I couldn’t find a matching record you can view in this workspace.";
  }
  const lines = hits.slice(0, 8).map((h) => {
    const status = h.status ? ` (${h.status})` : "";
    return `${h.title}${status}: ${h.summary} Open ${h.href}`.trim();
  });
  const cite = hits
    .slice(0, 6)
    .map((h) => h.number)
    .filter(Boolean)
    .join(", ");
  const intro =
    hits.length === 1
      ? `Here’s what I found for ${hits[0].number}:`
      : `Here’s what I found (${cite}):`;
  void question;
  return `${intro} ${lines.join(" ")} I haven’t changed any records.`;
}
