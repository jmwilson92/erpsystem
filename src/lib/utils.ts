import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, parseISO, isValid } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatPercent(n: number, digits = 1) {
  return `${n.toFixed(digits)}%`;
}

export function formatDate(
  date: Date | string | null | undefined,
  pattern = "MMM d, yyyy"
) {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "—";
  return format(d, pattern);
}

export function formatRelative(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function statusColor(status: string): string {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    // Success / green-teal
    COMPLETED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    CLOSED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    PASSED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    CERTIFIED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    RELEASED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    APPROVED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    PAID: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ACTIVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    INACTIVE: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    AVAILABLE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    SHIPPED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    RECEIVED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    DONE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ACHIEVED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    READY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    READY_TO_SHIP: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    READY_TO_KIT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    KITTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    PICKED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    COMPLETE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ALLOCATED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ACCEPTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    CONVERTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    SENT: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    // In progress / teal
    IN_PROGRESS: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    IN_PRODUCTION: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    RELEASED_WO: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    ISSUED: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    ACKNOWLEDGED: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    PARTIAL_RECEIPT: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    KITTING: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    PICKING: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    MAKE_ORDERED: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    OPEN: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    SUBMITTED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    PENDING: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    PLANNED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    DRAFT: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    BACKLOG: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    TODO: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    NOT_STARTED: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    // Warning / amber
    ON_HOLD: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    WAITING_MATERIAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    WAITING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    SHORT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    PARTIAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    STOCK_CHECK: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    PROTOTYPE: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    IN_REVIEW: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    ENGINEERING_REVIEW: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    CM_REVIEW: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    UNDER_REVIEW: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    MRB: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    BLOCKED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    CONDITIONAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    OVER_LIMIT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    EXPIRED: "bg-red-500/15 text-red-400 border-red-500/30",
    VALID: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    UPCOMING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    AT_STATION: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    STEP_READY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    QA_STEP: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    BUILD: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    BUY: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    STOCK: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    SALES_ORDER: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    MATERIAL_REQ: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    BOM: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    WI_TOOL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    PASS_FAIL: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    // Note: QA / TEST step types reuse colors elsewhere
    DRAWING: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    SPEC: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    PROCEDURE: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    FORM: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    FAT: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    ATP: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    TP: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    TR: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
    CERT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    IN_WORK: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    CR: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    WI: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    APPROVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ABSTAIN: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    ADMIN: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    PRODUCT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    ARCHIVED: "bg-slate-600/15 text-slate-400 border-slate-600/30",
    ARCHIVE: "bg-slate-600/15 text-slate-400 border-slate-600/30",
    // Danger / red
    FAILED: "bg-red-500/15 text-red-400 border-red-500/30",
    REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
    CANCELLED: "bg-red-500/15 text-red-400 border-red-500/30",
    CRITICAL: "bg-red-500/15 text-red-400 border-red-500/30",
    DISQUALIFIED: "bg-red-500/15 text-red-400 border-red-500/30",
    OBSOLETE: "bg-red-500/15 text-red-400 border-red-500/30",
    SCRAP: "bg-red-500/15 text-red-400 border-red-500/30",
    // Special
    QUARANTINE: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    GOVERNMENT: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    COMPANY: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    CUSTOMER: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    HIGH: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    NORMAL: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    LOW: "bg-slate-600/15 text-slate-400 border-slate-600/30",
  };
  return map[s] || "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

export function priorityColor(priority: string): string {
  return statusColor(priority);
}

export function scoreRatingColor(rating: string): string {
  const map: Record<string, string> = {
    A: "text-emerald-400",
    B: "text-teal-400",
    C: "text-amber-400",
    D: "text-orange-400",
    F: "text-red-400",
  };
  return map[rating] || "text-slate-400";
}

export function computeEvm(pv: number, ev: number, ac: number) {
  const spi = pv > 0 ? ev / pv : 1;
  const cpi = ac > 0 ? ev / ac : 1;
  const cv = ev - ac;
  const sv = ev - pv;
  return { spi, cpi, cv, sv };
}

export function parseJsonArray<T = string>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as T[];
  } catch {
    return [];
  }
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** True when a location is a GFP cage / government property area. */
export function isGfpLocation(
  loc: { type: string; code?: string } | null | undefined
): boolean {
  if (!loc) return false;
  if (loc.type === "GFP") return true;
  return (loc.code || "").toUpperCase().startsWith("GFP");
}
