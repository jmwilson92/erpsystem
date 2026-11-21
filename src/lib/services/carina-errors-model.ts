/**
 * Carina error capture, classification, and on-the-fly diagnosis.
 *
 * Client-safe types and pure helpers (no Prisma). Imported by the browser
 * ring buffer and by the server service.
 */
import { redactSecrets } from "@/lib/redact-secrets";

export const ERROR_CLASSIFICATIONS = [
  "VALIDATION",
  "STATUS_LOCK",
  "PERMISSION",
  "BUSINESS_RULE",
  "NOT_FOUND",
  "CONFLICT",
  "SYSTEM",
] as const;
export type ErrorClassification = (typeof ERROR_CLASSIFICATIONS)[number];

export const ERROR_PENDING_ACTION = "ERROR_DIAGNOSE";

const GATED = /\b(payroll|salary|salaries|wage|direct deposit|bank account|wire|ach|payout|user access|password|permission catalog|hire|terminat|hr record)\b/i;

export type ErrorSignal = {
  message?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  prismaCode?: string | null;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionAttempted?: string | null;
  field?: string | null;
};

export type ClassifiedError = {
  classification: ErrorClassification;
  errorCode: string;
  summary: string;
  field?: string;
};

export type RecordState = {
  entityType?: string | null;
  entityId?: string | null;
  number?: string | null;
  status?: string | null;
  signed?: boolean;
  locked?: boolean;
  href?: string | null;
  fields?: Record<string, unknown>;
  missingFields?: string[];
  permissionDenied?: string | null;
};

export type FixPlan = {
  kind: "none" | "navigate" | "propose-edit" | "propose-pr" | "report-bug";
  canApply: boolean;
  needsApproval: boolean;
  excluded: boolean;
  excludedReason?: string;
  href?: string;
  field?: string;
  actionText?: string;
  workaround?: string;
  label: string;
};

export type Diagnosis = {
  classification: ErrorClassification;
  errorCode: string;
  correlationId?: string;
  title: string;
  cause: string;
  fix: string;
  spoken: string;
  plan: FixPlan;
};

export type CapturedError = {
  id?: string;
  correlationId: string;
  classification: ErrorClassification;
  errorCode: string;
  httpStatus?: number | null;
  message: string;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionAttempted?: string | null;
  userId?: string | null;
  userRole?: string | null;
  source: string;
  payload?: Record<string, unknown> | null;
  sessionId?: string | null;
  field?: string | null;
  createdAt?: Date;
  resolution?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  bugReportedAt?: Date | null;
  bugStatus?: string | null;
};

const SECRET_KEYS = /^(password|pin|pinCode|token|accessToken|refreshToken|authorization|cookie|secret|apiKey|clientSecret|ssn|socialSecurity|accountNumber|routingNumber|cardNumber|cvv|iban)$/i;

export function scrubValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSecrets(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = scrubValue(v, k);
    }
    return out;
  }
  return value;
}

export function scrubPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!payload) return null;
  return scrubValue(payload) as Record<string, unknown>;
}

export function newCorrelationId(): string {
  const bytes = new Uint8Array(3);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else {
    for (let i = 0; i < 3; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `C-${hex}`;
}

export function looksLikeWhyDidThatFail(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\s*how do i\b/i.test(t)) return false;
  return (
    /\bwhy did (that|this|it) (fail|error|break|blow up)\b/i.test(t) ||
    /\bwhat was that error\b/i.test(t) ||
    /\bwhat (just )?went wrong\b/i.test(t) ||
    /\bwhat was (that|this|the) (failure|error)\b/i.test(t) ||
    /\bdiagnose (this|that|the) error\b/i.test(t) ||
    /\bask carina about (this|that|the) error\b/i.test(t) ||
    /\bwhy did (that|this|my) (save|submit|post|action) fail\b/i.test(t) ||
    /\berror ref C-[A-F0-9]{4,}\b/i.test(t)
  );
}

export function extractCorrelationId(text: string): string | null {
  const m = text.match(/\bC-[A-F0-9]{6,}\b/i);
  return m ? m[0].toUpperCase() : null;
}

export function classifyError(input: ErrorSignal): ClassifiedError {
  const status = input.httpStatus ?? null;
  const prismaCode = (input.prismaCode || "").toUpperCase();
  const codeHint = (input.errorCode || "").toUpperCase();
  const msg = `${input.message || ""} ${input.actionAttempted || ""}`.toLowerCase();
  const field = inferField(input.field, input.message);

  if (codeHint.startsWith("PERM") || status === 401 || status === 403 || /\b(permission|forbidden|not allowed|unauthorized|access denied|you don'?t have)\b/.test(msg)) {
    return { classification: "PERMISSION", errorCode: codeHint || "PERM_DENIED", summary: "You don’t have permission to do that.", field };
  }
  if (codeHint.startsWith("NOT_FOUND") || status === 404 || prismaCode === "P2025" || /\b(not found|doesn'?t exist|no longer exists|deleted|missing record)\b/.test(msg)) {
    return { classification: "NOT_FOUND", errorCode: codeHint || "NOT_FOUND", summary: "That record isn’t there (it may have been deleted).", field };
  }
  if (codeHint.startsWith("CONFLICT") || status === 409 || prismaCode === "P2002" || /\b(already exists|duplicate|unique constraint|conflict|someone else (saved|updated))\b/.test(msg)) {
    return { classification: "CONFLICT", errorCode: codeHint || "CONFLICT_DUPLICATE", summary: "This conflicts with a record that already exists, or someone else saved first.", field };
  }
  if (
    codeHint.startsWith("LOCK") ||
    /\b(released|closed|completed|cancelled|canceled|signed|locked|frozen|cannot (edit|change|update) a (released|closed|signed|completed))\b/.test(msg)
  ) {
    return { classification: "STATUS_LOCK", errorCode: codeHint || statusLockCode(msg), summary: "This record is in a status that blocks the change.", field };
  }
  if (
    codeHint.startsWith("RULE") ||
    /\b(uncertified|not certified|prototype|insufficient stock|out of stock|not enough (qty|quantity|stock)|missing routing|no routing|missing cost|no cost|approval pending|pending approval|bom (is )?(uncertified|not certified))\b/.test(msg)
  ) {
    return { classification: "BUSINESS_RULE", errorCode: codeHint || businessRuleCode(msg), summary: businessRuleSummary(msg), field };
  }
  if (
    codeHint.startsWith("VAL") ||
    status === 422 ||
    ((status === 400 || !status) && /\b(required|missing|invalid|must be|can'?t be blank|is required|required field)\b/.test(msg))
  ) {
    return {
      classification: "VALIDATION",
      errorCode: codeHint || (field ? "VAL_REQUIRED_FIELD" : "VAL_INVALID_FIELD"),
      summary: field ? `${prettyField(field)} is missing or invalid.` : "A required field is missing or invalid.",
      field,
    };
  }
  if (prismaCode || status === 500 || status === 502 || status === 503 || status === 504 || codeHint.startsWith("SYS")) {
    return { classification: "SYSTEM", errorCode: codeHint || (prismaCode ? `SYS_${prismaCode}` : "SYS_INTERNAL"), summary: "This looks like a system error, not a problem with the data you entered." };
  }
  return { classification: "SYSTEM", errorCode: codeHint || "SYS_UNKNOWN", summary: "I couldn’t classify this yet — I’ll treat it as a system error." };
}

function statusLockCode(msg: string): string {
  if (/\bsigned\b/.test(msg)) return "LOCK_SIGNED";
  if (/\b(closed|completed|cancelled|canceled)\b/.test(msg)) return "LOCK_CLOSED";
  return "LOCK_RELEASED";
}

function businessRuleCode(msg: string): string {
  if (/\b(uncertified|not certified|prototype)\b/.test(msg)) return "RULE_BOM_UNCERTIFIED";
  if (/\b(insufficient stock|out of stock|not enough)\b/.test(msg)) return "RULE_INSUFFICIENT_STOCK";
  if (/\brouting\b/.test(msg)) return "RULE_MISSING_ROUTING";
  if (/\bcost\b/.test(msg)) return "RULE_MISSING_COST";
  if (/\bapproval\b/.test(msg)) return "RULE_APPROVAL_PENDING";
  return "RULE_BUSINESS";
}

function businessRuleSummary(msg: string): string {
  if (/\b(uncertified|not certified|prototype)\b/.test(msg)) return "The BOM isn’t certified, so this change is blocked.";
  if (/\b(insufficient stock|out of stock|not enough)\b/.test(msg)) return "There isn’t enough stock to complete this.";
  if (/\brouting\b/.test(msg)) return "This item is missing a routing.";
  if (/\bcost\b/.test(msg)) return "This item is missing a cost.";
  if (/\bapproval\b/.test(msg)) return "An approval is still pending.";
  return "A business rule is blocking this change.";
}

function inferField(explicit?: string | null, message?: string | null): string | undefined {
  if (explicit) return explicit;
  const m = (message || "").match(
    /\b(?:field |the )?['"]?([A-Za-z][A-Za-z0-9_ ]{1,40}?)['"]? (?:is required|is missing|is invalid|can'?t be blank|must be)\b/i
  );
  return m ? m[1].trim().replace(/\s+/g, "") : undefined;
}

function prettyField(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function hrefForError(event: Pick<CapturedError, "route" | "entityType" | "entityId">): string | undefined {
  if (event.entityType && event.entityId) {
    const type = event.entityType.toLowerCase();
    if (type === "workorder" || type === "work-order") return `/work-orders/${event.entityId}`;
    if (type === "part") return `/parts/${event.entityId}`;
    if (type === "purchaserequest" || type === "pr") return `/purchasing/pr/${event.entityId}`;
    if (type === "purchaseorder" || type === "po") return `/purchasing/po/${event.entityId}`;
    if (type === "project") return `/pmo/${event.entityId}`;
    if (type === "bom" || type === "bomheader") return `/bom/${event.entityId}`;
  }
  if (event.route && event.route.startsWith("/")) return event.route;
  return undefined;
}

export function planFix(input: {
  classified: ClassifiedError;
  event: CapturedError;
  record?: RecordState | null;
  gatedText?: string;
}): FixPlan {
  const gatedText = input.gatedText || `${input.event.route || ""} ${input.event.actionAttempted || ""} ${input.event.message || ""}`;
  if (GATED.test(gatedText)) {
    return {
      kind: "none",
      canApply: false,
      needsApproval: false,
      excluded: true,
      excludedReason: "That area is gated (money, payroll, HR, or user access). I can’t change it.",
      label: "Can't change a gated area",
    };
  }
  const href = input.record?.href || hrefForError(input.event);
  const field = input.classified.field || input.record?.missingFields?.[0];
  const cls = input.classified.classification;

  if (cls === "VALIDATION") {
    return {
      kind: field ? "propose-edit" : "navigate",
      canApply: !!field,
      needsApproval: true,
      excluded: false,
      href,
      field,
      actionText: field
        ? `Help me fill in ${prettyField(field)} on this ${input.event.entityType || "record"}`
        : undefined,
      label: field ? `Fill in ${prettyField(field)}` : "Open the form and highlight the field",
    };
  }
  if (cls === "STATUS_LOCK") {
    const signed = input.classified.errorCode === "LOCK_SIGNED" || input.record?.signed;
    return {
      kind: "navigate",
      canApply: false,
      needsApproval: !signed,
      excluded: !!signed,
      excludedReason: signed ? "Signed records need a PIN/signature path I can’t bypass." : undefined,
      href,
      workaround: signed
        ? "Open the record and use the normal sign-off flow if a change is still allowed."
        : "If this should be editable, an authorized user can reopen or reverse the status from the record page.",
      label: "Open the locked record",
    };
  }
  if (cls === "PERMISSION") {
    return {
      kind: "none",
      canApply: false,
      needsApproval: false,
      excluded: true,
      excludedReason: "I never bypass permissions. An administrator would have to grant the missing role or permission.",
      href,
      label: "Permission required",
    };
  }
  if (cls === "BUSINESS_RULE") {
    if (input.classified.errorCode === "RULE_INSUFFICIENT_STOCK") {
      return {
        kind: "propose-pr",
        canApply: true,
        needsApproval: false,
        excluded: false,
        href: href || "/purchasing/pr/new",
        actionText: "Draft a purchase request for the short part",
        workaround: "You can also open Purchasing and create a PR yourself.",
        label: "Draft a purchase request",
      };
    }
    if (input.classified.errorCode === "RULE_BOM_UNCERTIFIED") {
      return {
        kind: "navigate",
        canApply: false,
        needsApproval: true,
        excluded: false,
        href: href || "/bom",
        workaround:
          "Engineering can certify the BOM, or an administrator can allow prototype BOMs in Company Settings.",
        label: "Open the BOM",
      };
    }
    return {
      kind: "navigate",
      canApply: false,
      needsApproval: false,
      excluded: false,
      href,
      workaround: "I can take you to the record so you can supply the missing routing, cost, or approval.",
      label: "Open the record",
    };
  }
  if (cls === "NOT_FOUND" || cls === "CONFLICT") {
    return {
      kind: "navigate",
      canApply: false,
      needsApproval: false,
      excluded: false,
      href: href || input.event.route || undefined,
      workaround:
        cls === "CONFLICT"
          ? "Refresh and use the existing record, or change the duplicate value."
          : "It may have been deleted. I can take you back to the list.",
      label: cls === "CONFLICT" ? "Open the existing record" : "Go back to the list",
    };
  }
  return {
    kind: "report-bug",
    canApply: false,
    needsApproval: false,
    excluded: false,
    workaround: "Try again in a moment. If it keeps happening, I can file a bug report for an administrator.",
    label: "Report a bug",
  };
}

export function diagnoseError(input: {
  event: CapturedError;
  record?: RecordState | null;
  classified?: ClassifiedError;
}): Diagnosis {
  const classified = input.classified || classifyError(input.event);
  const plan = planFix({ classified, event: input.event, record: input.record });
  const ref = input.event.correlationId ? ` (ref ${input.event.correlationId})` : "";
  const where = input.event.actionAttempted
    ? ` when you tried to ${input.event.actionAttempted}`
    : input.event.route
      ? ` on ${input.event.route}`
      : "";
  const cause = `${classified.summary}${where}.`;
  let fix: string;
  if (plan.excluded) fix = plan.excludedReason || "I can’t change that.";
  else if (plan.kind === "propose-pr") fix = "I can draft a purchase request for the short part. Want me to?";
  else if (plan.kind === "propose-edit") fix = `I can take you to ${prettyField(plan.field || "the field")} and help fill it in. Want me to?`;
  else if (plan.kind === "report-bug") fix = "I can’t change the code, but I can file a bug report and share a workaround.";
  else if (plan.workaround) fix = plan.workaround;
  else fix = plan.href ? "I can take you to the record." : "I can explain the next step.";
  const spoken = `${cause} ${fix}`.replace(/\s+/g, " ").trim();
  return {
    classification: classified.classification,
    errorCode: classified.errorCode,
    correlationId: input.event.correlationId,
    title: `${classificationLabel(classified.classification)}${ref}`,
    cause,
    fix,
    spoken,
    plan,
  };
}

export function classificationLabel(c: ErrorClassification): string {
  switch (c) {
    case "VALIDATION":
      return "Validation error";
    case "STATUS_LOCK":
      return "Status or lock";
    case "PERMISSION":
      return "Permission";
    case "BUSINESS_RULE":
      return "Business rule";
    case "NOT_FOUND":
      return "Not found";
    case "CONFLICT":
      return "Conflict";
    default:
      return "System error";
  }
}

export function formatDiagnosis(d: Diagnosis): string {
  return d.spoken;
}

export function formatApiError(body: {
  message: string;
  errorCode: string;
  correlationId: string;
  classification?: ErrorClassification;
  field?: string;
  httpStatus: number;
}): Record<string, unknown> {
  return {
    ok: false,
    error: body.message,
    errorCode: body.errorCode,
    correlationId: body.correlationId,
    classification: body.classification,
    field: body.field,
  };
}

export function parsePrismaCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    if (/^P\d{4}$/.test(code)) return code;
  }
  return null;
}

/** Client-safe ring-buffer helpers (also used in tests). */
export const ERROR_BUFFER_LIMIT = 20;
export const ERROR_BUFFER_KEY = "protessera:carina-errors";

export function pushErrorBuffer(existing: CapturedError[], event: CapturedError, limit = ERROR_BUFFER_LIMIT): CapturedError[] {
  const next = [event, ...existing.filter((e) => e.correlationId !== event.correlationId)];
  return next.slice(0, limit);
}

export function latestFromBuffer(existing: CapturedError[]): CapturedError | null {
  return existing[0] || null;
}

export function isErrorPending(pending?: { action?: string } | null): boolean {
  return pending?.action === ERROR_PENDING_ACTION;
}

export function errorPendingAction(correlationId: string, plan?: FixPlan) {
  return {
    action: ERROR_PENDING_ACTION,
    phase: "clarify" as const,
    partial: {
      correlationId,
      planKind: plan?.kind || "",
      actionText: plan?.actionText || "",
      href: plan?.href || "",
    },
  };
}

export function isErrorFixAccept(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yes please|please do|go ahead|do it|ok|okay|draft (it|a pr|the pr)|fix it|report it|file it)([.!]*)?$/.test(t);
}

