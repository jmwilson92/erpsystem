import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * QMS program framework: calibration, tool control, HAZMAT, ESD, FOD, safety,
 * training, internal audits, counterfeit-parts prevention — all one shape.
 * Each program tracks records (items) with recurring due dates and a log of
 * events (checks / inspections / incidents / audits).
 */

export const PROGRAM_DEFS = [
  { key: "calibration", name: "Calibration", itemNoun: "Gage / instrument", eventNoun: "Calibration", defaultIntervalDays: 365, icon: "Ruler", sortOrder: 1,
    description: "Measurement & test equipment calibration control (interval, cert, due dates)." },
  { key: "tools", name: "Tool Control", itemNoun: "Tool", eventNoun: "Inspection", defaultIntervalDays: 180, icon: "Wrench", sortOrder: 2,
    description: "Controlled tooling accountability and periodic condition checks." },
  { key: "hazmat", name: "HAZMAT", itemNoun: "Hazardous material", eventNoun: "SDS review", defaultIntervalDays: 365, icon: "FlaskConical", sortOrder: 3,
    description: "Hazardous material inventory, SDS control, storage & disposal." },
  { key: "esd", name: "ESD Control", itemNoun: "ESD station / device", eventNoun: "ESD test", defaultIntervalDays: 90, icon: "Zap", sortOrder: 4,
    description: "ESD-protected areas, wrist straps, and mats — periodic verification." },
  { key: "fod", name: "FOD Prevention", itemNoun: "FOD zone", eventNoun: "FOD walk", defaultIntervalDays: 7, icon: "ScanEye", sortOrder: 5,
    description: "Foreign object debris/damage zones, walks, and incident logging." },
  { key: "safety", name: "Safety / EHS", itemNoun: "Safety asset / area", eventNoun: "Inspection", defaultIntervalDays: 30, icon: "ShieldAlert", sortOrder: 6,
    description: "Extinguishers, eyewash, PPE, inspections, and safety incidents." },
  { key: "audits", name: "Internal Audits", itemNoun: "Audit area / clause", eventNoun: "Audit", defaultIntervalDays: 365, icon: "ClipboardList", sortOrder: 8,
    description: "Internal QMS audit schedule (AS9101) and findings." },
  { key: "counterfeit", name: "Counterfeit Parts", itemNoun: "Suspect part / lot", eventNoun: "Verification", defaultIntervalDays: 0, icon: "SearchCheck", sortOrder: 9,
    description: "Counterfeit / suspect part prevention & verification (AS5553 / AS6174)." },
] as const;

/** Idempotently ensure the program catalog exists. */
export async function ensureQualityPrograms() {
  for (const p of PROGRAM_DEFS) {
    await prisma.qualityProgram.upsert({
      where: { key: p.key },
      create: { ...p },
      update: {
        name: p.name,
        description: p.description,
        itemNoun: p.itemNoun,
        eventNoun: p.eventNoun,
        icon: p.icon,
        sortOrder: p.sortOrder,
        isActive: true,
      },
    });
  }
  // Training & certifications now live in the HR module — retire the old
  // QMS program (kept in the DB, hidden from the hub).
  await prisma.qualityProgram.updateMany({
    where: { key: "training" },
    data: { isActive: false },
  });
}

const DAY = 86_400_000;
/** Items due within this window count as "due soon". */
export const DUE_SOON_DAYS = 14;

export function statusFor(nextDueAt: Date | null, current: string): string {
  if (["OUT_OF_SERVICE", "RETIRED"].includes(current)) return current;
  if (!nextDueAt) return "ACTIVE";
  const now = Date.now();
  if (nextDueAt.getTime() < now) return "OVERDUE";
  if (nextDueAt.getTime() < now + DUE_SOON_DAYS * DAY) return "DUE_SOON";
  return "ACTIVE";
}

/** Recompute status for every item in a program (call before rendering). */
export async function refreshProgramStatuses(programId: string) {
  const items = await prisma.qualityItem.findMany({ where: { programId } });
  for (const it of items) {
    const s = statusFor(it.nextDueAt, it.status);
    if (s !== it.status) {
      await prisma.qualityItem.update({ where: { id: it.id }, data: { status: s } });
    }
  }
}

export async function getProgramByKey(key: string) {
  return prisma.qualityProgram.findUnique({ where: { key } });
}

export async function createQualityItem(params: {
  programId: string;
  identifier: string;
  name: string;
  location?: string;
  ownerId?: string;
  intervalDays?: number;
  nextDueAt?: Date;
  attributes?: Record<string, unknown>;
  documentUrl?: string;
  documentName?: string;
  toolboxId?: string;
  needsCalibration?: boolean;
  notes?: string;
  userId?: string;
}) {
  if (!params.identifier?.trim() && !params.name?.trim()) {
    throw new Error("An identifier or name is required");
  }
  const program = await prisma.qualityProgram.findUnique({ where: { id: params.programId } });
  const interval = params.intervalDays ?? program?.defaultIntervalDays ?? 0;
  const nextDue =
    params.nextDueAt ?? (interval > 0 ? new Date(Date.now() + interval * DAY) : null);
  const item = await prisma.qualityItem.create({
    data: {
      programId: params.programId,
      identifier: params.identifier?.trim() || params.name.trim(),
      name: params.name?.trim() || params.identifier.trim(),
      location: params.location?.trim() || null,
      ownerId: params.ownerId || null,
      intervalDays: params.intervalDays ?? null,
      nextDueAt: nextDue,
      status: statusFor(nextDue, "ACTIVE"),
      attributes: params.attributes ? JSON.stringify(params.attributes) : null,
      documentUrl: params.documentUrl?.trim() || null,
      documentName: params.documentName?.trim() || null,
      toolboxId: params.toolboxId || null,
      needsCalibration: params.needsCalibration ?? false,
      notes: params.notes?.trim() || null,
      createdById: params.userId || null,
    },
  });
  await logAudit({ entityType: "QualityItem", entityId: item.id, action: "CREATED", userId: params.userId, metadata: { name: item.name } });
  return item;
}

export async function setItemStatus(params: { itemId: string; status: string; userId?: string }) {
  return prisma.qualityItem.update({ where: { id: params.itemId }, data: { status: params.status } });
}

/**
 * Record an event. For a recurring item, a PASS/CLOSED check advances the next
 * due date by the item's interval and clears its status.
 */
export async function recordQualityEvent(params: {
  programId: string;
  itemId?: string;
  type?: string;
  result?: string;
  notes?: string;
  documentUrl?: string;
  documentName?: string;
  performedAt?: Date;
  userId?: string;
}) {
  const performedAt = params.performedAt || new Date();
  const event = await prisma.qualityEvent.create({
    data: {
      programId: params.programId,
      itemId: params.itemId || null,
      type: params.type || "CHECK",
      result: params.result || null,
      notes: params.notes?.trim() || null,
      documentUrl: params.documentUrl?.trim() || null,
      documentName: params.documentName?.trim() || null,
      performedAt,
      performedById: params.userId || null,
    },
  });

  // Advance the item's due date on a successful recurring check.
  if (params.itemId && ["PASS", "CLOSED", "NA"].includes(params.result || "")) {
    const item = await prisma.qualityItem.findUnique({ where: { id: params.itemId } });
    if (item) {
      const program = await prisma.qualityProgram.findUnique({ where: { id: item.programId } });
      const interval = item.intervalDays ?? program?.defaultIntervalDays ?? 0;
      const nextDue = interval > 0 ? new Date(performedAt.getTime() + interval * DAY) : item.nextDueAt;
      await prisma.qualityItem.update({
        where: { id: item.id },
        data: {
          lastActionAt: performedAt,
          nextDueAt: nextDue,
          status: statusFor(nextDue, item.status === "OUT_OF_SERVICE" ? "ACTIVE" : item.status),
        },
      });
    }
  } else if (params.itemId && params.result === "FAIL") {
    await prisma.qualityItem.update({
      where: { id: params.itemId },
      data: { status: "OUT_OF_SERVICE", lastActionAt: performedAt },
    });
  }

  await logAudit({ entityType: "QualityEvent", entityId: event.id, action: "RECORDED", userId: params.userId, metadata: { type: event.type, result: event.result } });
  return event;
}

/** Compliance rollup across all active programs (for the hub + Quality badge). */
export async function qualityComplianceSummary() {
  await ensureQualityPrograms();
  const programs = await prisma.qualityProgram.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { items: { select: { status: true, nextDueAt: true } } },
  });
  return programs.map((p) => {
    const overdue = p.items.filter((i) => statusFor(i.nextDueAt, i.status) === "OVERDUE").length;
    const dueSoon = p.items.filter((i) => statusFor(i.nextDueAt, i.status) === "DUE_SOON").length;
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      icon: p.icon,
      itemNoun: p.itemNoun,
      eventNoun: p.eventNoun,
      total: p.items.length,
      overdue,
      dueSoon,
    };
  });
}
