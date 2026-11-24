/**
 * Carina production-floor monitor: low-stock and capacity/staffing alerts,
 * plus a concise “status of my floor” overview with drill-down follow-ups.
 *
 * Low stock compares on-hand + inbound to open WO / forecast demand and to
 * reorder point / min / safety stock, weighted by 30/90-day usage velocity.
 * Capacity uses planned/back-scheduled work-center load vs available hours.
 */
import { addDays, startOfWeek, endOfWeek, format } from "date-fns";
import { prisma } from "@/lib/db";
import { ROLES, type Role } from "@/lib/auth";
import { getWorkOrderLaborProgressMany } from "@/lib/services/labor-progress";
import { getCapacityAndWorkload } from "@/lib/services/capacity";
import { OVER_CAPACITY_PCT } from "@/lib/services/schedule";
import { logAudit } from "@/lib/audit";

export const FLOOR_PENDING_ACTION = "FLOOR_STATUS";
export const DEFAULT_FLOOR_NOTIFY_ROLES: Role[] = ["PRODUCTION", "PM", "PURCHASING"];
export const LOW_STOCK_COVER_DAYS = 14;
export const CAPACITY_ALERT_PCT = OVER_CAPACITY_PCT;
export const MONITOR_MIN_INTERVAL_MS = 55 * 60 * 1000;

export type PartStockInput = {
  id: string;
  partNumber: string;
  description?: string | null;
  href: string;
  onHand: number;
  inbound: number;
  woDemand: number;
  forecastDemand: number;
  minStock: number;
  reorderPoint: number;
  safetyStock: number;
  usage30: number;
  usage90: number;
};

export type LowStockAlert = {
  type: "LOW_STOCK";
  fingerprint: string;
  conditionKey: string;
  partId: string;
  partNumber: string;
  description?: string | null;
  href: string;
  onHand: number;
  inbound: number;
  available: number;
  demand: number;
  threshold: number;
  usage30: number;
  dailyUsage: number;
  daysOfCover: number | null;
  title: string;
  body: string;
};

export type CapacityWeekInput = {
  weekStart: Date;
  workCenterId: string;
  code: string;
  name: string;
  availableHours: number;
  projectedHours: number;
  href?: string;
};

export type CapacityAlert = {
  type: "CAPACITY";
  fingerprint: string;
  conditionKey: string;
  workCenterId: string;
  workCenter: string;
  weekStart: Date;
  weekLabel: string;
  utilizationPct: number;
  shortHours: number;
  href: string;
  title: string;
  body: string;
};

export type FloorSignals = {
  openWorkOrders: number;
  inProgressWorkOrders: number;
  lateWorkOrders: { id: string; number: string; dueDate: Date; href: string }[];
  overAllocatedWorkOrders: { id: string; number: string; percent: number; href: string }[];
  pastDuePurchaseOrders: { id: string; number: string; promisedDate: Date; href: string }[];
  openNcrs: { id: string; number: string; href: string }[];
  openMrb: number;
  pendingApprovals: number;
};

export type FloorSnapshot = {
  generatedAt: Date;
  lowStock: LowStockAlert[];
  capacity: CapacityAlert[];
  signals: FloorSignals;
};

export type FloorTopic = "overview" | "low_stock" | "capacity" | "late" | "quality" | "approvals";

export function stockThreshold(part: Pick<PartStockInput, "minStock" | "reorderPoint" | "safetyStock">): number {
  return Math.max(part.reorderPoint || 0, part.minStock || 0, part.safetyStock || 0);
}

export function dailyUsageOf(part: Pick<PartStockInput, "usage30" | "usage90">): number {
  if (part.usage30 > 0) return part.usage30 / 30;
  if (part.usage90 > 0) return part.usage90 / 90;
  return 0;
}

export function daysOfCover(available: number, dailyUsage: number): number | null {
  if (dailyUsage <= 0) return null;
  return Math.max(0, available / dailyUsage);
}

export function coverBucket(days: number | null, shortVsDemand: boolean, belowThreshold: boolean): string {
  if (days != null && days <= 14) {
    if (days < 1) return "0";
    if (days <= 3) return "1-3";
    if (days <= 7) return "4-7";
    return "8-14";
  }
  if (shortVsDemand) return "short-vs-demand";
  if (belowThreshold) return "below-threshold";
  if (days != null) return "15+";
  return "watch";
}

export function formatLowStockMessage(partNumber: string, days: number | null): string {
  if (days == null) return `You're running low on ${partNumber}`;
  const rounded = days < 1 ? 0 : Math.round(days);
  return `You're running low on ${partNumber} (~${rounded} day${rounded === 1 ? "" : "s"} of cover)`;
}

export function evaluateLowStock(
  parts: PartStockInput[],
  opts?: { coverDays?: number }
): LowStockAlert[] {
  const coverDays = opts?.coverDays ?? LOW_STOCK_COVER_DAYS;
  const alerts: LowStockAlert[] = [];
  for (const part of parts) {
    const available = Math.max(0, (part.onHand || 0) + (part.inbound || 0));
    const demand = Math.max(0, (part.woDemand || 0) + (part.forecastDemand || 0));
    const threshold = stockThreshold(part);
    const dailyUsage = dailyUsageOf(part);
    const days = daysOfCover(available, dailyUsage);
    const shortVsDemand = demand > 0 && available < demand;
    const belowThreshold = threshold > 0 && available <= threshold;
    const lowCover = days != null && days <= coverDays;
    if (!shortVsDemand && !belowThreshold && !lowCover) continue;
    const title = formatLowStockMessage(part.partNumber, days);
    const bodyParts = [
      title + ".",
      `On-hand ${trimQty(part.onHand)} plus inbound ${trimQty(part.inbound)} vs demand ${trimQty(demand)}` +
        (threshold > 0 ? ` (reorder point ${trimQty(threshold)})` : "") +
        ".",
    ];
    alerts.push({
      type: "LOW_STOCK",
      fingerprint: part.id,
      conditionKey: coverBucket(days, shortVsDemand, belowThreshold),
      partId: part.id,
      partNumber: part.partNumber,
      description: part.description,
      href: part.href,
      onHand: part.onHand,
      inbound: part.inbound,
      available,
      demand,
      threshold,
      usage30: part.usage30,
      dailyUsage,
      daysOfCover: days,
      title,
      body: bodyParts.join(" "),
    });
  }
  alerts.sort((a, b) => {
    if (b.usage30 !== a.usage30) return b.usage30 - a.usage30;
    const da = a.daysOfCover == null ? Number.POSITIVE_INFINITY : a.daysOfCover;
    const db = b.daysOfCover == null ? Number.POSITIVE_INFINITY : b.daysOfCover;
    if (da !== db) return da - db;
    return a.partNumber.localeCompare(b.partNumber);
  });
  return alerts;
}

export function evaluateCapacity(
  weeks: CapacityWeekInput[],
  opts?: { thresholdPct?: number }
): CapacityAlert[] {
  const threshold = opts?.thresholdPct ?? CAPACITY_ALERT_PCT;
  const alerts: CapacityAlert[] = [];
  for (const week of weeks) {
    if (week.availableHours <= 0 && week.projectedHours <= 0) continue;
    const pct = week.availableHours > 0 ? (week.projectedHours / week.availableHours) * 100 : week.projectedHours > 0 ? 999 : 0;
    if (pct <= threshold) continue;
    const short = Math.max(0, week.projectedHours - week.availableHours);
    const weekLabel = format(week.weekStart, "MMM d");
    const center = week.code || week.name;
    const href = week.href || "/planning?tab=capacity";
    const title = `Staffing needed: ${center} is at ${Math.round(pct)}% load the week of ${weekLabel}, short about ${trimQty(short)} hours`;
    alerts.push({
      type: "CAPACITY",
      fingerprint: `${week.workCenterId}:${week.weekStart.toISOString().slice(0, 10)}`,
      conditionKey: `pct:${Math.floor(pct / 10) * 10}`,
      workCenterId: week.workCenterId,
      workCenter: center,
      weekStart: week.weekStart,
      weekLabel,
      utilizationPct: pct,
      shortHours: short,
      href,
      title,
      body: `${title}.`,
    });
  }
  alerts.sort((a, b) => b.utilizationPct - a.utilizationPct || +a.weekStart - +b.weekStart);
  return alerts;
}

function trimQty(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function buildFloorSnapshot(input: {
  now?: Date;
  parts: PartStockInput[];
  weeks: CapacityWeekInput[];
  signals: FloorSignals;
}): FloorSnapshot {
  return {
    generatedAt: input.now || new Date(),
    lowStock: evaluateLowStock(input.parts),
    capacity: evaluateCapacity(input.weeks),
    signals: input.signals,
  };
}

export function formatFloorOverview(snapshot: FloorSnapshot): string {
  const s = snapshot.signals;
  const sentences: string[] = [];
  const late = s.lateWorkOrders.length;
  const over = s.overAllocatedWorkOrders.length;
  sentences.push(
    `You have ${s.openWorkOrders} open work order${s.openWorkOrders === 1 ? "" : "s"}` +
      (s.inProgressWorkOrders ? `, ${s.inProgressWorkOrders} in progress` : "") +
      (late ? `, ${late} late` : "") +
      (over ? `, ${over} over allocated labor hours` : "") +
      "."
  );
  const topStock = snapshot.lowStock.slice(0, 2);
  if (topStock.length) {
    sentences.push(topStock.map((a) => a.title).join(", and ") + ".");
  }
  const topCap = snapshot.capacity[0];
  if (topCap) sentences.push(topCap.title + ".");
  else if (snapshot.capacity.length === 0 && !topStock.length) {
    sentences.push("Capacity looks clear for the coming weeks.");
  }
  const extra: string[] = [];
  if (s.pastDuePurchaseOrders.length) extra.push(`${s.pastDuePurchaseOrders.length} past-due PO${s.pastDuePurchaseOrders.length === 1 ? "" : "s"}`);
  if (s.openNcrs.length) extra.push(`${s.openNcrs.length} open NCR${s.openNcrs.length === 1 ? "" : "s"}`);
  if (s.pendingApprovals) extra.push(`${s.pendingApprovals} pending approval${s.pendingApprovals === 1 ? "" : "s"}`);
  if (extra.length) sentences.push(`${extra.join("; ")}.`);
  sentences.push("Want more detail on low-stock parts, staffing, late work, or quality?");
  return sentences.join(" ");
}

export function formatFloorDetail(snapshot: FloorSnapshot, topic: FloorTopic): {
  text: string;
  href?: string;
  offerPrPart?: { partNumber: string; partId: string };
} {
  if (topic === "low_stock") {
    if (!snapshot.lowStock.length) {
      return { text: "I don’t see any low-stock parts right now. On-hand plus inbound covers demand and reorder points.", href: "/inventory" };
    }
    const lines = snapshot.lowStock.slice(0, 8).map((a) => a.body);
    const top = snapshot.lowStock[0];
    const offer = ` Want me to draft a purchase request for ${top.partNumber}?`;
    return {
      text: lines.join(" ") + offer,
      href: top.href || "/inventory",
      offerPrPart: { partNumber: top.partNumber, partId: top.partId },
    };
  }
  if (topic === "capacity") {
    if (!snapshot.capacity.length) {
      return { text: "No work center is over available hours in the coming weeks.", href: "/planning?tab=capacity" };
    }
    const lines = snapshot.capacity.slice(0, 6).map((a) => a.body);
    return {
      text: lines.join(" ") + " I can take you to capacity planning.",
      href: "/planning?tab=capacity",
    };
  }
  if (topic === "late") {
    const late = snapshot.signals.lateWorkOrders;
    const pos = snapshot.signals.pastDuePurchaseOrders;
    const over = snapshot.signals.overAllocatedWorkOrders;
    const bits: string[] = [];
    if (late.length) {
      bits.push(
        `${late.length} work order${late.length === 1 ? " is" : "s are"} past due: ${late
          .slice(0, 5)
          .map((w) => w.number)
          .join(", ")}.`
      );
    } else bits.push("No open work orders are past due.");
    if (over.length) {
      bits.push(
        `${over.length} ${over.length === 1 ? "is" : "are"} over allocated labor hours: ${over
          .slice(0, 4)
          .map((w) => `${w.number} (${Math.round(w.percent)}%)`)
          .join(", ")}.`
      );
    }
    if (pos.length) {
      bits.push(
        `${pos.length} purchase order${pos.length === 1 ? " is" : "s are"} past the promised date: ${pos
          .slice(0, 5)
          .map((p) => p.number)
          .join(", ")}.`
      );
    }
    return { text: bits.join(" "), href: late[0]?.href || "/work-orders" };
  }
  if (topic === "quality") {
    const ncrs = snapshot.signals.openNcrs;
    if (!ncrs.length && !snapshot.signals.openMrb) {
      return { text: "No open NCRs or MRB cases right now.", href: "/quality" };
    }
    return {
      text:
        `${ncrs.length} open NCR${ncrs.length === 1 ? "" : "s"}` +
        (ncrs.length ? ` (${ncrs.slice(0, 5).map((n) => n.number).join(", ")})` : "") +
        (snapshot.signals.openMrb ? `, ${snapshot.signals.openMrb} MRB case${snapshot.signals.openMrb === 1 ? "" : "s"} in review` : "") +
        ".",
      href: ncrs[0]?.href || "/quality",
    };
  }
  if (topic === "approvals") {
    const n = snapshot.signals.pendingApprovals;
    return {
      text: n ? `There are ${n} pending approval${n === 1 ? "" : "s"} waiting.` : "Nothing is waiting in Approvals.",
      href: "/approvals",
    };
  }
  return { text: formatFloorOverview(snapshot) };
}

export function looksLikeFloorStatus(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\s*how do i\b/i.test(t)) return false;
  return (
    /\b(status|rundown|overview|update|picture)\b.+\b(floor|shop floor|production floor|shop|production)\b/i.test(t) ||
    /\b(floor|shop floor|production floor|shop)\b.+\b(status|rundown|overview)\b/i.test(t) ||
    /\b(how('?s| is) (my |the |our )?(floor|shop|production)( floor)?( look| doing)?)\b/i.test(t) ||
    /\b(what('?s| is) going on (on )?(the |my |our )?(floor|shop|production floor))\b/i.test(t) ||
    /\bgive me (the |a )?(status of )?(my |the |our )?(floor|shop floor|production)\b/i.test(t)
  );
}

export function parseFloorDetailTopic(text: string): FloorTopic | null {
  const t = text.trim().toLowerCase();
  if (/\b(low[ -]?stock|running low|stock|parts?|reorder|days of cover)\b/.test(t)) return "low_stock";
  if (/\b(staffing|capacity|overloaded|work center|workload|hours|planning)\b/.test(t)) return "capacity";
  if (/\b(late|overdue|past due|behind|labor|over allocated)\b/.test(t)) return "late";
  if (/\b(quality|ncr|mrb|hold|holds)\b/.test(t)) return "quality";
  if (/\bapproval/.test(t)) return "approvals";
  return null;
}

export function isGenericFloorFollowup(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(more detail|tell me more|go into detail|break that down|the details|what else)\b/.test(t);
}

export function isFloorDetailUtterance(text: string): boolean {
  return parseFloorDetailTopic(text) != null || isGenericFloorFollowup(text);
}

export async function answerFloorStatus(opts: {
  question: string;
  pending?: { action?: string; partial?: Record<string, string> } | null;
  loadSnapshot: () => Promise<FloorSnapshot>;
}): Promise<{
  text: string;
  href?: string;
  pendingAction: ReturnType<typeof floorPendingAction>;
  offerPrPart?: { partNumber: string; partId: string };
} | null> {
  const overviewAsk = looksLikeFloorStatus(opts.question);
  const topic = parseFloorDetailTopic(opts.question);
  const generic = isGenericFloorFollowup(opts.question);
  if (!overviewAsk && !topic && !generic) return null;
  if (!overviewAsk && !isFloorPending(opts.pending) && generic && !topic) return null;
  const snapshot = await opts.loadSnapshot();
  if (overviewAsk && !topic) {
    return {
      text: formatFloorOverview(snapshot),
      pendingAction: floorPendingAction("overview"),
    };
  }
  const resolved: FloorTopic = topic || (generic ? "low_stock" : "overview");
  const detail = formatFloorDetail(snapshot, resolved);
  return {
    text: detail.text,
    href: detail.href,
    pendingAction: floorPendingAction(resolved, detail.offerPrPart),
    offerPrPart: detail.offerPrPart,
  };
}


export function isFloorPending(pending?: { action?: string } | null): boolean {
  return pending?.action === FLOOR_PENDING_ACTION;
}

export function isFloorPrOfferAccept(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(do it|yes,? do it|yes please|please do|go ahead|draft (it|a pr|the pr|a purchase request))([.!]*)?$/.test(t) ||
    /\b(draft a (purchase request|pr)|yes,? draft)\b/.test(t)
  );
}

export function floorPendingAction(topic: FloorTopic, offerPart?: { partNumber: string; partId: string }) {
  return {
    action: FLOOR_PENDING_ACTION,
    phase: "clarify" as const,
    partial: {
      topic,
      offerPartNumber: offerPart?.partNumber || "",
      offerPartId: offerPart?.partId || "",
    },
  };
}

export type FloorAlertRecord = {
  type: string;
  fingerprint: string;
  conditionKey: string;
};

export type FloorMonitorDeps = {
  now?: () => Date;
  loadSnapshot: () => Promise<FloorSnapshot>;
  getLastMonitorAt?: () => Promise<Date | null>;
  markMonitorRun?: (at: Date) => Promise<void>;
  existingAlerts?: () => Promise<FloorAlertRecord[]>;
  recordAlert?: (alert: {
    type: string;
    fingerprint: string;
    conditionKey: string;
    title: string;
    body: string;
    href?: string;
    entityType?: string;
    entityId?: string;
  }) => Promise<void>;
  notify?: (params: { title: string; body: string; href?: string; entityType?: string; entityId?: string }) => Promise<number>;
};

export function alertsToNotify(
  snapshot: FloorSnapshot,
  existing: FloorAlertRecord[]
): { type: string; fingerprint: string; conditionKey: string; title: string; body: string; href?: string; entityType?: string; entityId?: string }[] {
  const seen = new Map(existing.map((e) => [`${e.type}:${e.fingerprint}`, e.conditionKey]));
  const candidates: {
    type: string;
    fingerprint: string;
    conditionKey: string;
    title: string;
    body: string;
    href?: string;
    entityType?: string;
    entityId?: string;
  }[] = [
    ...snapshot.lowStock.slice(0, 8).map((a) => ({
      type: a.type,
      fingerprint: a.fingerprint,
      conditionKey: a.conditionKey,
      title: a.title,
      body: a.body,
      href: a.href,
      entityType: "Part",
      entityId: a.partId,
    })),
    ...snapshot.capacity.slice(0, 8).map((a) => ({
      type: a.type,
      fingerprint: a.fingerprint,
      conditionKey: a.conditionKey,
      title: a.title,
      body: a.body,
      href: a.href,
      entityType: "WorkCenter",
      entityId: a.workCenterId,
    })),
  ];
  const late = snapshot.signals.lateWorkOrders.length;
  const pos = snapshot.signals.pastDuePurchaseOrders.length;
  const ncrs = snapshot.signals.openNcrs.length;
  const approvals = snapshot.signals.pendingApprovals;
  if (late || pos || ncrs || approvals) {
    candidates.push({
      type: "DIGEST",
      fingerprint: "signals",
      conditionKey: `late:${late}|po:${pos}|ncr:${ncrs}|appr:${approvals}`,
      title: "Floor update",
      body: [
        late ? `${late} late work order${late === 1 ? "" : "s"}` : "",
        pos ? `${pos} past-due PO${pos === 1 ? "" : "s"}` : "",
        ncrs ? `${ncrs} open NCR${ncrs === 1 ? "" : "s"}` : "",
        approvals ? `${approvals} pending approval${approvals === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
      href: "/ai",
      entityType: "Floor",
      entityId: "signals",
    });
  }
  return candidates.filter((c) => seen.get(`${c.type}:${c.fingerprint}`) !== c.conditionKey);
}

export async function runFloorMonitor(deps: FloorMonitorDeps): Promise<{ notified: number; skipped: number; ran: boolean }> {
  const now = (deps.now || (() => new Date()))();
  if (deps.getLastMonitorAt) {
    const last = await deps.getLastMonitorAt();
    if (last && now.getTime() - last.getTime() < MONITOR_MIN_INTERVAL_MS) {
      return { notified: 0, skipped: 0, ran: false };
    }
  }
  const snapshot = await deps.loadSnapshot();
  const existing = deps.existingAlerts ? await deps.existingAlerts() : [];
  const fresh = alertsToNotify(snapshot, existing);
  let notified = 0;
  for (const alert of fresh) {
    await deps.recordAlert?.(alert);
    const n = await deps.notify?.({
      title: alert.title,
      body: alert.body,
      href: alert.href,
      entityType: alert.entityType,
      entityId: alert.entityId,
    });
    notified += n ?? 1;
  }
  await deps.markMonitorRun?.(now);
  return { notified, skipped: existing.length, ran: true };
}

// ── Prisma-backed snapshot ──────────────────────────────────────

const OPEN_WO = { notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"] };
const OPEN_PO = { notIn: ["RECEIVED", "INVOICED", "CLOSED", "CANCELLED"] };
const OUTBOUND_TXN = ["ISSUE", "KIT", "SHIP", "SCRAP"];

export async function loadFloorSnapshot(now = new Date()): Promise<FloorSnapshot> {
  const week0 = startOfWeek(now, { weekStartsOn: 1 });
  const [parts, weeks, signals] = await Promise.all([
    loadPartStockRows(now),
    loadCapacityWeeks(week0, 4),
    loadFloorSignals(now),
  ]);
  return buildFloorSnapshot({ now, parts, weeks, signals });
}

async function loadPartStockRows(now: Date): Promise<PartStockInput[]> {
  const since90 = addDays(now, -90);
  const since30 = addDays(now, -30);
  const parts = await prisma.part.findMany({
    where: { isActive: true },
    select: {
      id: true,
      partNumber: true,
      description: true,
      minStock: true,
      reorderPoint: true,
      safetyStock: true,
      inventoryItems: {
        where: { ownership: { in: ["COMPANY", "CUSTOMER"] } },
        select: { quantityOnHand: true, quantityAvailable: true },
      },
    },
  });
  if (!parts.length) return [];

  const partIds = parts.map((p) => p.id);
  const [prLines, poLines, kitLines, forecastLines, usageRows] = await Promise.all([
    prisma.purchaseRequestLine.findMany({
      where: {
        partId: { in: partIds },
        purchaseRequest: { status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } },
      },
      select: { partId: true, quantity: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: {
        partId: { in: partIds },
        purchaseOrder: { status: { in: ["DRAFT", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"] } },
      },
      select: { partId: true, quantity: true, quantityReceived: true },
    }),
    prisma.kitOrderLine.findMany({
      where: {
        partId: { in: partIds },
        kitOrder: { status: { notIn: ["COMPLETE", "CANCELLED"] }, workOrder: { status: OPEN_WO } },
      },
      select: { partId: true, quantityRequired: true, quantityPicked: true },
    }),
    prisma.forecastLine.findMany({
      where: { partId: { in: partIds }, forecast: { status: "ACTIVE" } },
      select: { partId: true, quantity: true },
    }),
    prisma.materialTransaction.findMany({
      where: { partId: { in: partIds }, type: { in: OUTBOUND_TXN }, createdAt: { gte: since90 } },
      select: { partId: true, quantity: true, createdAt: true },
    }),
  ]);

  const inbound = new Map<string, number>();
  for (const l of prLines) {
    if (!l.partId) continue;
    inbound.set(l.partId, (inbound.get(l.partId) || 0) + l.quantity);
  }
  for (const l of poLines) {
    if (!l.partId) continue;
    inbound.set(l.partId, (inbound.get(l.partId) || 0) + Math.max(0, l.quantity - (l.quantityReceived || 0)));
  }
  const woDemand = new Map<string, number>();
  for (const l of kitLines) {
    woDemand.set(l.partId, (woDemand.get(l.partId) || 0) + Math.max(0, l.quantityRequired - (l.quantityPicked || 0)));
  }
  const forecastDemand = new Map<string, number>();
  for (const l of forecastLines) {
    forecastDemand.set(l.partId, (forecastDemand.get(l.partId) || 0) + l.quantity);
  }
  const usage30 = new Map<string, number>();
  const usage90 = new Map<string, number>();
  for (const t of usageRows) {
    if (!t.partId) continue;
    const qty = Math.abs(t.quantity);
    usage90.set(t.partId, (usage90.get(t.partId) || 0) + qty);
    if (t.createdAt >= since30) usage30.set(t.partId, (usage30.get(t.partId) || 0) + qty);
  }

  return parts.map((p) => ({
    id: p.id,
    partNumber: p.partNumber,
    description: p.description,
    href: `/parts/${p.id}`,
    onHand: p.inventoryItems.reduce((s, i) => s + (i.quantityOnHand || 0), 0),
    inbound: inbound.get(p.id) || 0,
    woDemand: woDemand.get(p.id) || 0,
    forecastDemand: forecastDemand.get(p.id) || 0,
    minStock: p.minStock || 0,
    reorderPoint: p.reorderPoint || 0,
    safetyStock: p.safetyStock || 0,
    usage30: usage30.get(p.id) || 0,
    usage90: usage90.get(p.id) || 0,
  }));
}

async function loadCapacityWeeks(week0: Date, count: number): Promise<CapacityWeekInput[]> {
  const rows: CapacityWeekInput[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(week0, i * 7);
    const end = endOfWeek(start, { weekStartsOn: 1 });
    const result = await getCapacityAndWorkload(start, { horizonStart: start, horizonEnd: end });
    for (const c of result.centers) {
      rows.push({
        weekStart: start,
        workCenterId: c.workCenterId,
        code: c.code,
        name: c.name,
        availableHours: c.availableHoursThisWeek,
        projectedHours: c.projectedHoursThisWeek,
        href: "/planning?tab=capacity",
      });
    }
  }
  return rows;
}

async function loadFloorSignals(now: Date): Promise<FloorSignals> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [openWos, inProgress, lateWos, overWos, pastPos, ncrs, mrb, approvals, productionApprovals] = await Promise.all([
    prisma.workOrder.count({ where: { status: OPEN_WO } }),
    prisma.workOrder.count({ where: { status: "IN_PROGRESS" } }),
    prisma.workOrder.findMany({
      where: { status: OPEN_WO, dueDate: { lt: today } },
      select: { id: true, number: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.workOrder.findMany({
      where: { status: OPEN_WO, allocatedHours: { gt: 0 } },
      select: { id: true },
      take: 150,
    }),
    prisma.purchaseOrder.findMany({
      where: { status: OPEN_PO, promisedDate: { lt: today } },
      select: { id: true, number: true, promisedDate: true },
      orderBy: { promisedDate: "asc" },
      take: 20,
    }),
    prisma.nonConformance.findMany({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
      select: { id: true, number: true },
      take: 20,
    }),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.approval.count({ where: { status: "PENDING" } }),
    prisma.productionJournal.count({ where: { status: { in: ["PENDING", "POSTING"] } } }),
  ]);

  const progress = await getWorkOrderLaborProgressMany(overWos.map((w) => w.id));
  const overAllocated = [...progress.values()]
    .filter((p) => p.overAllocated)
    .sort((a, b) => (b.percentComplete || 0) - (a.percentComplete || 0))
    .slice(0, 20)
    .map((p) => ({
      id: p.workOrderId,
      number: p.number,
      percent: p.percentComplete || 100,
      href: `/work-orders/${p.workOrderId}`,
    }));

  return {
    openWorkOrders: openWos,
    inProgressWorkOrders: inProgress,
    lateWorkOrders: lateWos
      .filter((w) => w.dueDate)
      .map((w) => ({ id: w.id, number: w.number, dueDate: w.dueDate!, href: `/work-orders/${w.id}` })),
    overAllocatedWorkOrders: overAllocated,
    pastDuePurchaseOrders: pastPos
      .filter((p) => p.promisedDate)
      .map((p) => ({ id: p.id, number: p.number, promisedDate: p.promisedDate!, href: `/purchasing/po/${p.id}` })),
    openNcrs: ncrs.map((n) => ({ id: n.id, number: n.number, href: `/quality/ncr/${n.id}` })),
    openMrb: mrb,
    pendingApprovals: approvals + productionApprovals,
  };
}

export async function getCarinaFloorNotifyRoles(): Promise<string[]> {
  const row = await prisma.companySettings.findUnique({
    where: { id: "default" },
    select: { carinaFloorNotifyRoles: true },
  });
  if (!row?.carinaFloorNotifyRoles) return [...DEFAULT_FLOOR_NOTIFY_ROLES];
  try {
    const parsed = JSON.parse(row.carinaFloorNotifyRoles);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const allowed = new Set<string>(ROLES);
      const roles = parsed.map((x) => String(x).toUpperCase()).filter((r) => allowed.has(r));
      return roles.length ? roles : [...DEFAULT_FLOOR_NOTIFY_ROLES];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_FLOOR_NOTIFY_ROLES];
}

export async function setCarinaFloorNotifyRoles(params: { roles: string[]; userId?: string }): Promise<string[]> {
  const allowed = new Set<string>(ROLES);
  const roles = [...new Set(params.roles.map((r) => r.toUpperCase()).filter((r) => allowed.has(r)))];
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: { id: "default", carinaFloorNotifyRoles: JSON.stringify(roles), updatedById: params.userId },
    update: { carinaFloorNotifyRoles: JSON.stringify(roles), updatedById: params.userId },
  });
  return roles;
}

export async function prismaFloorMonitorDeps(): Promise<FloorMonitorDeps> {
  return {
    loadSnapshot: () => loadFloorSnapshot(),
    async getLastMonitorAt() {
      const row = await prisma.carinaFloorAlert.findUnique({
        where: { type_fingerprint: { type: "MONITOR", fingerprint: "hourly" } },
      });
      return row?.lastNotifiedAt ?? null;
    },
    async markMonitorRun(at) {
      await prisma.carinaFloorAlert.upsert({
        where: { type_fingerprint: { type: "MONITOR", fingerprint: "hourly" } },
        create: {
          type: "MONITOR",
          fingerprint: "hourly",
          conditionKey: at.toISOString(),
          title: "Floor monitor",
          body: "ran",
          lastNotifiedAt: at,
        },
        update: { conditionKey: at.toISOString(), lastNotifiedAt: at },
      });
    },
    async existingAlerts() {
      const rows = await prisma.carinaFloorAlert.findMany({
        where: { type: { not: "MONITOR" } },
        select: { type: true, fingerprint: true, conditionKey: true },
      });
      return rows;
    },
    async recordAlert(alert) {
      await prisma.carinaFloorAlert.upsert({
        where: { type_fingerprint: { type: alert.type, fingerprint: alert.fingerprint } },
        create: {
          type: alert.type,
          fingerprint: alert.fingerprint,
          conditionKey: alert.conditionKey,
          title: alert.title,
          body: alert.body,
          href: alert.href,
          entityType: alert.entityType,
          entityId: alert.entityId,
          lastNotifiedAt: new Date(),
        },
        update: {
          conditionKey: alert.conditionKey,
          title: alert.title,
          body: alert.body,
          href: alert.href,
          lastNotifiedAt: new Date(),
        },
      });
    },
    async notify(params) {
      const roles = await getCarinaFloorNotifyRoles();
      const users = await prisma.user.findMany({
        where: { isActive: true, role: { in: roles } },
        select: { id: true },
      });
      let count = 0;
      for (const user of users) {
        await prisma.userNotification.create({
          data: {
            userId: user.id,
            type: "CARINA_FLOOR",
            title: params.title,
            body: params.body,
            href: params.href,
            entityType: params.entityType,
            entityId: params.entityId,
          },
        });
        count += 1;
      }
      await logAudit({
        entityType: params.entityType || "Floor",
        entityId: params.entityId || "floor",
        action: "CARINA_FLOOR_ALERT",
        metadata: { source: "carina", title: params.title },
      });
      return count;
    },
  };
}
