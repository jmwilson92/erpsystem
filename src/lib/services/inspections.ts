import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getProgramByKey } from "@/lib/services/quality-programs";

/**
 * Program inspection templates + saved inspections. A program (ESD, FOD,
 * safety) has one shared template of steps; running an inspection against a
 * station/zone records pass/fail + notes + photos per step and advances the
 * item's due date, then keeps the report in history.
 */

/** Programs that use the customizable inspection template + walk workflow. */
export const INSPECTION_PROGRAMS = ["esd", "fod", "safety", "audits"] as const;

export function supportsInspections(key: string): boolean {
  return (INSPECTION_PROGRAMS as readonly string[]).includes(key);
}

export type TemplateStep = { label: string };
export type InspectionResult = { label: string; ok: boolean; note?: string; photoUrl?: string; photoName?: string };

export function parseTemplate(raw: string | null | undefined): TemplateStep[] {
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as TemplateStep[]).filter((s) => s?.label);
  } catch {
    return [];
  }
}

export async function setInspectionTemplate(params: { programId: string; steps: TemplateStep[]; userId?: string }) {
  const clean = params.steps.map((s) => ({ label: String(s.label).trim() })).filter((s) => s.label);
  await prisma.qualityProgram.update({
    where: { id: params.programId },
    data: { inspectionTemplate: JSON.stringify(clean) },
  });
  await logAudit({ entityType: "QualityProgram", entityId: params.programId, action: "TEMPLATE_SET", userId: params.userId, metadata: { steps: clean.length } });
}

/** Record a completed inspection and roll the station/zone's due date forward. */
export async function saveInspection(params: {
  programId: string;
  itemId?: string;
  results: InspectionResult[];
  notes?: string;
  userId?: string;
}) {
  const passed = params.results.every((r) => r.ok);
  const insp = await prisma.qualityInspection.create({
    data: {
      programId: params.programId,
      itemId: params.itemId || null,
      results: JSON.stringify(params.results),
      passed,
      notes: params.notes?.trim() || null,
      performedById: params.userId || null,
    },
  });

  // Advance the item's next-due on a passing inspection; fail takes it down.
  if (params.itemId) {
    const item = await prisma.qualityItem.findUnique({ where: { id: params.itemId } });
    if (item) {
      const program = await prisma.qualityProgram.findUnique({ where: { id: item.programId } });
      const interval = item.intervalDays ?? program?.defaultIntervalDays ?? 0;
      const now = new Date();
      if (passed) {
        const nextDue = interval > 0 ? new Date(now.getTime() + interval * 86_400_000) : item.nextDueAt;
        await prisma.qualityItem.update({
          where: { id: item.id },
          data: { lastActionAt: now, nextDueAt: nextDue, status: "ACTIVE" },
        });
      } else {
        await prisma.qualityItem.update({ where: { id: item.id }, data: { lastActionAt: now, status: "OUT_OF_SERVICE" } });
      }
    }
  }

  await logAudit({ entityType: "QualityInspection", entityId: insp.id, action: "RECORDED", userId: params.userId, metadata: { passed } });
  return insp;
}

export async function listInspections(programId: string, itemId?: string) {
  return prisma.qualityInspection.findMany({
    where: { programId, ...(itemId ? { itemId } : {}) },
    orderBy: { performedAt: "desc" },
    take: 50,
  });
}

// ─── Humidity (ESD) ─────────────────────────────────────────────

export async function recordHumidity(params: {
  location: string;
  workcenterId?: string;
  relativeHumidity: number;
  temperatureC?: number;
  source?: "MANUAL" | "DEVICE";
  deviceId?: string;
}) {
  const location = params.location?.trim();
  if (!location) throw new Error("A location / workcenter is required");
  if (!Number.isFinite(params.relativeHumidity)) throw new Error("A numeric relative humidity is required");
  return prisma.humidityReading.create({
    data: {
      location,
      workcenterId: params.workcenterId || null,
      relativeHumidity: params.relativeHumidity,
      temperatureC: Number.isFinite(params.temperatureC as number) ? params.temperatureC : null,
      source: params.source || "MANUAL",
      deviceId: params.deviceId || null,
    },
  });
}

/** Latest reading per location plus a recent series, for the ESD dashboard. */
export async function humiditySummary() {
  const recent = await prisma.humidityReading.findMany({
    orderBy: { recordedAt: "desc" },
    take: 100,
  });
  const latestByLocation = new Map<string, (typeof recent)[number]>();
  for (const r of recent) {
    if (!latestByLocation.has(r.location)) latestByLocation.set(r.location, r);
  }
  return { latest: [...latestByLocation.values()], recent };
}

/** Whether an incoming humidity reading is within the ESD-safe band (30–70% RH). */
export function humidityTone(rh: number): "ok" | "warn" {
  return rh >= 30 && rh <= 70 ? "ok" : "warn";
}

export async function getEsdProgram() {
  return getProgramByKey("esd");
}
