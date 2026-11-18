/** Pure intent parsing for Carina voice actions. No I/O. */

export type VoiceActionKind =
  | "EDIT_PROJECT"
  | "TIE_WO"
  | "CYCLE_COUNT"
  | "CONSUME_PARTS"
  | "OUTPUT_WO"
  | "HIGH_RISK_PARTS";

export type ParsedVoiceIntent = {
  kind: VoiceActionKind;
  /** Tokens like WO-1001, PRJ-12, BDGT-00001, part numbers */
  numbers: string[];
  projectHint?: string;
  workOrderHint?: string;
  budgetHint?: string;
  partHint?: string;
  locationHint?: string;
  countedQty?: number;
  reason?: string;
  projectFields?: Record<string, string>;
};

const NUMBER_RE =
  /\b((?:WO|SWO|BWO|MWO|PRJ|PROJ|BDGT|BUDGET|CC|PN)-[A-Z0-9-]+|[A-Z]{2,6}-\d{3,})\b/gi;

export function extractEntityNumbers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) {
    const n = m[1].toUpperCase();
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function isConfirmUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|yep|yup|ok|okay|confirm|confirmed|do it|go ahead|proceed|please do|affirmative)([.!]*)?$/.test(
    t
  ) || /\b(confirm( that| the change)?|yes,? (please|do it|confirm)|go ahead and (do|confirm))\b/i.test(
    t
  );
}

export function isCancelUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(no|nope|nah|cancel|cancelled|canceled|stop|never mind|nevermind|abort|don't|do not)([.!]*)?$/.test(
    t
  ) || /\b(cancel( that| the change)?|don't (do|confirm|change)|never mind)\b/i.test(
    t
  );
}

/** Voice "approve" for signature-gated actions. Never enough on its own. */
export function isApproveUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(approve|i approve|approved)([.!]*)?$/.test(t) ||
    /\b(i )?(voice )?approve( this| the (change|action|sign[- ]?off))?\b/i.test(t);
}

export function isExcludedDomain(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(payroll|salary|salaries|wage|wages|paycheck|direct deposit)\b/.test(t)) {
    return "I can’t change or read payroll, salary or wage records by voice.";
  }
  if (/\b(hire|fire|terminate|pto|time off|human resources|\bhr\b|benefit|employee record|personnel file)\b/.test(t) &&
      !/\b(work orders?|project|inventory|parts?)\b/.test(t)) {
    return "I can’t change HR or personnel records by voice.";
  }
  if (/\b(permission|role|password|admin access|grant access|promote|demote user)\b/.test(t)) {
    return "I can’t change users or permissions by voice.";
  }
  if (/\b(pay\b|invoice|journal|ledger|cash|revenue|contract value|budget (cost|amount|total)|development budget|unit cost|price|\$|usd)\b/.test(t) &&
      !/\b(tie|assign|link|attach).*\b(budget|charge code|wbs)\b/.test(t)) {
    return "I can’t change money, billing or budget amounts by voice. I can attach a work order to an existing project or budget, but I won’t edit dollar figures.";
  }
  return null;
}

function after(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v || undefined;
}

export function parseVoiceActionIntent(question: string): ParsedVoiceIntent | null {
  const t = question.trim();
  if (!t) return null;
  if (isConfirmUtterance(t) || isCancelUtterance(t) || isApproveUtterance(t)) {
    return null;
  }
  const lower = t.toLowerCase();
  const numbers = extractEntityNumbers(t);
  const woNum = numbers.find((n) => /^(WO|SWO|BWO|MWO)-/.test(n));
  const projNum = numbers.find((n) => /^(PRJ|PROJ)-/.test(n));
  const budgetNum = numbers.find((n) => /^(BDGT|BUDGET)-/.test(n));

  const highRisk =
    /\b(high[ -]?risk|class a|abc class a)\b/.test(lower) &&
    /\b(part|parts|inventory|stock|count|how many)\b/.test(lower);
  if (highRisk || (/\bhigh[ -]?risk parts\b/.test(lower) && /\b(check|show|list|count|what)\b/.test(lower))) {
    return { kind: "HIGH_RISK_PARTS", numbers };
  }

  const cycle =
    /\b(cycle ?count|adjust (the )?count|count (this |the )?part|inventory count|physical count)\b/.test(
      lower
    );
  if (cycle) {
    const qtyRaw = after(t, /\b(?:to|at|is|as)\s+(\d+(?:\.\d+)?)\b/i);
    const countedQty = qtyRaw != null ? Number(qtyRaw) : undefined;
    const partHint =
      after(t, /\bpart\s+([A-Za-z0-9._-]{2,})\b/i) ||
      numbers.find((n) => !/^(WO|SWO|BWO|MWO|PRJ|PROJ|BDGT|BUDGET|CC)-/.test(n));
    const locationHint = after(
      t,
      /\b(?:at|in|bin|location|loc)\s+([A-Za-z0-9/_-]{2,})\b/i
    );
    const reason = after(t, /\b(?:because|reason|for)\s+(.{3,120})$/i);
    return {
      kind: "CYCLE_COUNT",
      numbers,
      partHint,
      locationHint,
      countedQty: Number.isFinite(countedQty) ? countedQty : undefined,
      reason,
    };
  }

  if (
    /\b(consume|issue|kit|pick)\b/.test(lower) &&
    /\b(part|parts|material|kit|bom)\b/.test(lower) &&
    /\b(work order|wo\b)/.test(lower)
  ) {
    return {
      kind: "CONSUME_PARTS",
      numbers,
      workOrderHint: woNum,
      partHint: after(t, /\bpart\s+([A-Za-z0-9._-]{2,})\b/i),
    };
  }

  if (
    /\b(complete|output|finish|put away|putaway|send (it |this |the work order )?to receiving)\b/.test(
      lower
    ) &&
    /\b(work order|wo\b)/.test(lower)
  ) {
    return { kind: "OUTPUT_WO", numbers, workOrderHint: woNum };
  }

  if (
    /\b(tie|assign|link|attach|hook)\b/.test(lower) &&
    /\b(work order|wo\b)/.test(lower) &&
    /\b(project|budget|wbs|charge code)\b/.test(lower)
  ) {
    const budgetHint =
      budgetNum ||
      after(t, /\bbudget\s+([A-Za-z0-9._-]{2,})\b/i) ||
      after(t, /\bcharge code\s+([A-Za-z0-9._-]{2,})\b/i);
    const projectHint =
      projNum || after(t, /\bproject\s+([A-Za-z0-9._ -]{2,30}?)\s*(?:to|and|budget|$)/i);
    return {
      kind: "TIE_WO",
      numbers,
      workOrderHint: woNum,
      projectHint: projectHint?.trim(),
      budgetHint: budgetHint?.trim(),
    };
  }

  if (
    /\b(edit|change|update|rename|set)\b/.test(lower) &&
    /\bproject\b/.test(lower)
  ) {
    const projectFields: Record<string, string> = {};
    const name = after(t, /\b(?:rename(?:d)? to|name to|named|to be called|title to)\s+["“]?([^"”\n,.]{2,80})["”]?/i);
    if (name) projectFields.name = name;
    const status = after(t, /\bstatus(?: to)?\s+(planning|active|on[ -]?hold|completed|cancelled)\b/i);
    if (status) projectFields.status = status.toUpperCase().replace(/[ -]/g, "_");
    const phase = after(t, /\bphase(?: to)?\s+(initiation|planning|execution|monitoring|closure)\b/i);
    if (phase) projectFields.phase = phase.toUpperCase();
    const description = after(t, /\bdescription(?: to)?\s+["“]?([^"”\n]{3,200})["”]?/i);
    if (description) projectFields.description = description;
    const start = after(t, /\bstart date(?: to)?\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
    if (start) projectFields.startDate = start;
    const end = after(t, /\bend date(?: to)?\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
    if (end) projectFields.endDate = end;
    const projectHint =
      projNum || after(t, /\bproject\s+([A-Za-z0-9._-]{2,}(?:\s+[A-Za-z0-9._-]{2,}){0,4})/i);
    return {
      kind: "EDIT_PROJECT",
      numbers,
      projectHint: projectHint?.trim(),
      projectFields,
    };
  }

  return null;
}
