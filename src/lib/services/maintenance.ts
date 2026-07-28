/**
 * CMMS — keeping production equipment running.
 *
 * Same due-by-date-or-meter engine as Fleet, pointed at machines. The two
 * differences that matter:
 *   - a machine's meter is run hours or cycles, not miles
 *   - a machine that stops costs production, so downtime is tracked as its own
 *     event with a reason code rather than just a status flag
 *
 * Availability here is the availability term of OEE. It is deliberately not
 * called OEE: performance and quality come from work order output, and a number
 * labelled OEE that only measures uptime would be worse than no number.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const EQUIPMENT_STATUSES = ["ACTIVE", "DOWN", "STANDBY", "RETIRED"] as const;
export const METER_UNITS = ["HOURS", "CYCLES", "UNITS"] as const;
export const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const MAINTENANCE_TYPES = [
  "PM",
  "CALIBRATION",
  "INSPECTION",
  "REPAIR",
  "OVERHAUL",
] as const;
export const DOWNTIME_REASONS = [
  "BREAKDOWN",
  "SETUP",
  "MATERIAL",
  "OPERATOR",
  "QUALITY",
  "PLANNED",
  "OTHER",
] as const;

/** Days before a dated PM is due that it starts showing as due soon. */
export const DUE_SOON_DAYS = 14;
/** Meter units before a metered PM is due that it starts showing as due soon. */
export const DUE_SOON_METER = 50;

export async function listEquipment(params?: { status?: string; workCenterId?: string }) {
  return prisma.equipment.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.workCenterId ? { workCenterId: params.workCenterId } : {}),
    },
    orderBy: [{ status: "asc" }, { assetTag: "asc" }],
  });
}

export async function getEquipment(id: string) {
  return prisma.equipment.findUnique({
    where: { id },
    include: {
      maintenance: { orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
      meterLogs: { orderBy: { readAt: "desc" }, take: 50 },
      downtime: { orderBy: { startedAt: "desc" }, take: 50 },
    },
  });
}

export async function createEquipment(params: {
  assetTag: string;
  name: string;
  workCenterId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  meter?: number;
  meterUnit?: string;
  criticality?: string;
  installedAt?: Date | null;
  warrantyEnds?: Date | null;
  notes?: string | null;
  userId?: string;
}) {
  const assetTag = params.assetTag.trim();
  if (!assetTag) throw new Error("Asset tag is required");
  const equipment = await prisma.equipment.create({
    data: {
      assetTag,
      name: params.name.trim() || assetTag,
      workCenterId: params.workCenterId || null,
      manufacturer: params.manufacturer?.trim() || null,
      model: params.model?.trim() || null,
      serialNumber: params.serialNumber?.trim() || null,
      location: params.location?.trim() || null,
      meter: params.meter ?? 0,
      meterUnit: params.meterUnit || "HOURS",
      criticality: params.criticality || "MEDIUM",
      installedAt: params.installedAt ?? null,
      warrantyEnds: params.warrantyEnds ?? null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Equipment",
    entityId: equipment.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { assetTag },
  });
  return equipment;
}

export async function updateEquipment(
  id: string,
  data: Record<string, unknown>,
  userId?: string
) {
  const equipment = await prisma.equipment.update({ where: { id }, data });
  await logAudit({ entityType: "Equipment", entityId: id, action: "UPDATED", userId });
  return equipment;
}

/**
 * Record a meter reading. Forward-only: a machine's run hours never decrease,
 * so a lower number is a typo or a replaced counter, not a real reading.
 */
export async function recordMeter(params: {
  equipmentId: string;
  value: number;
  userId?: string;
  notes?: string | null;
}) {
  const current = await prisma.equipment.findUnique({
    where: { id: params.equipmentId },
    select: { meter: true, meterUnit: true },
  });
  if (!current) throw new Error("Equipment not found");
  if (params.value < current.meter) {
    throw new Error(
      `Reading ${params.value} is below the current ${current.meter} ${current.meterUnit} — meters only go up`
    );
  }
  await prisma.meterReading.create({
    data: {
      equipmentId: params.equipmentId,
      value: params.value,
      userId: params.userId || null,
      notes: params.notes?.trim() || null,
    },
  });
  return prisma.equipment.update({
    where: { id: params.equipmentId },
    data: { meter: params.value },
  });
}

export async function addMaintenance(params: {
  equipmentId: string;
  type: string;
  description?: string | null;
  dueAt?: Date | null;
  dueMeter?: number | null;
  intervalDays?: number | null;
  intervalMeter?: number | null;
  userId?: string;
}) {
  return prisma.equipmentMaintenance.create({
    data: {
      equipmentId: params.equipmentId,
      type: params.type || "PM",
      description: params.description?.trim() || null,
      dueAt: params.dueAt ?? null,
      dueMeter: params.dueMeter ?? null,
      intervalDays: params.intervalDays ?? null,
      intervalMeter: params.intervalMeter ?? null,
    },
  });
}

/**
 * Close out a PM and, when it repeats, schedule the next occurrence from the
 * interval. Rolling forward automatically is the whole point of a PM
 * program — a schedule someone has to re-enter is a schedule that lapses.
 */
export async function completeMaintenance(params: {
  id: string;
  completedMeter?: number | null;
  cost?: number | null;
  vendor?: string | null;
  downtimeMinutes?: number | null;
  userId?: string;
}) {
  const job = await prisma.equipmentMaintenance.update({
    where: { id: params.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      completedMeter: params.completedMeter ?? undefined,
      cost: params.cost ?? undefined,
      vendor: params.vendor?.trim() || null,
      downtimeMinutes: params.downtimeMinutes ?? undefined,
      completedById: params.userId || null,
    },
  });

  if (params.completedMeter != null) {
    await recordMeter({
      equipmentId: job.equipmentId,
      value: params.completedMeter,
      userId: params.userId,
      notes: `${job.type} completed`,
    }).catch(() => undefined); // a stale meter shouldn't block closing the job
  }

  if (job.intervalDays || job.intervalMeter) {
    const base = params.completedMeter ?? undefined;
    await prisma.equipmentMaintenance.create({
      data: {
        equipmentId: job.equipmentId,
        type: job.type,
        description: job.description,
        intervalDays: job.intervalDays,
        intervalMeter: job.intervalMeter,
        dueAt: job.intervalDays
          ? new Date(Date.now() + job.intervalDays * 86_400_000)
          : null,
        dueMeter:
          job.intervalMeter && base != null ? base + job.intervalMeter : null,
      },
    });
  }

  await logAudit({
    entityType: "EquipmentMaintenance",
    entityId: params.id,
    action: "COMPLETED",
    userId: params.userId,
  });
  return job;
}

export type MaintenanceDue = {
  id: string;
  equipmentId: string;
  assetTag: string;
  equipmentName: string;
  type: string;
  description: string | null;
  dueAt: Date | null;
  dueMeter: number | null;
  meter: number;
  meterUnit: string;
  criticality: string;
  reason: "OVERDUE_DATE" | "OVERDUE_METER" | "DUE_SOON";
};

/** Everything overdue or coming up, worst first. */
export async function getMaintenanceDue(): Promise<MaintenanceDue[]> {
  const jobs = await prisma.equipmentMaintenance.findMany({
    where: { status: "SCHEDULED" },
    include: { equipment: true },
    take: 500,
  });
  const now = new Date();
  const soon = new Date(Date.now() + DUE_SOON_DAYS * 86_400_000);
  const out: MaintenanceDue[] = [];

  for (const j of jobs) {
    if (j.equipment.status === "RETIRED") continue;
    let reason: MaintenanceDue["reason"] | null = null;
    if (j.dueAt && j.dueAt <= now) reason = "OVERDUE_DATE";
    else if (j.dueMeter != null && j.equipment.meter >= j.dueMeter)
      reason = "OVERDUE_METER";
    else if (j.dueAt && j.dueAt <= soon) reason = "DUE_SOON";
    else if (j.dueMeter != null && j.equipment.meter >= j.dueMeter - DUE_SOON_METER)
      reason = "DUE_SOON";
    if (!reason) continue;

    out.push({
      id: j.id,
      equipmentId: j.equipmentId,
      assetTag: j.equipment.assetTag,
      equipmentName: j.equipment.name,
      type: j.type,
      description: j.description,
      dueAt: j.dueAt,
      dueMeter: j.dueMeter,
      meter: j.equipment.meter,
      meterUnit: j.equipment.meterUnit,
      criticality: j.equipment.criticality,
      reason,
    });
  }

  const rank = { OVERDUE_METER: 0, OVERDUE_DATE: 0, DUE_SOON: 1 };
  return out.sort(
    (a, b) =>
      rank[a.reason] - rank[b.reason] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)
  );
}

// ─── Downtime ───────────────────────────────────────────────────

/** Start a stoppage. Also flips the machine to DOWN so the floor can see it. */
export async function startDowntime(params: {
  equipmentId: string;
  reason: string;
  description?: string | null;
  workOrderId?: string | null;
  userId?: string;
}) {
  const event = await prisma.downtimeEvent.create({
    data: {
      equipmentId: params.equipmentId,
      reason: params.reason || "BREAKDOWN",
      description: params.description?.trim() || null,
      workOrderId: params.workOrderId || null,
      reportedById: params.userId || null,
    },
  });
  await prisma.equipment.update({
    where: { id: params.equipmentId },
    data: { status: "DOWN" },
  });
  return event;
}

/** End a stoppage and put the machine back in service. */
export async function endDowntime(params: { id: string; userId?: string }) {
  const event = await prisma.downtimeEvent.update({
    where: { id: params.id },
    data: { endedAt: new Date() },
  });
  const stillDown = await prisma.downtimeEvent.count({
    where: { equipmentId: event.equipmentId, endedAt: null },
  });
  if (stillDown === 0) {
    await prisma.equipment.update({
      where: { id: event.equipmentId },
      data: { status: "ACTIVE" },
    });
  }
  await logAudit({
    entityType: "DowntimeEvent",
    entityId: params.id,
    action: "ENDED",
    userId: params.userId,
  });
  return event;
}

export type DowntimePareto = { reason: string; minutes: number; events: number };

/** Downtime minutes by reason — the Pareto a plant manager actually wants. */
export async function getDowntimePareto(days = 30): Promise<DowntimePareto[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const events = await prisma.downtimeEvent.findMany({
    where: { startedAt: { gte: since } },
    take: 2000,
  });
  const map = new Map<string, DowntimePareto>();
  for (const e of events) {
    const end = e.endedAt ?? new Date();
    const minutes = Math.max(0, (end.getTime() - e.startedAt.getTime()) / 60_000);
    const hit = map.get(e.reason);
    if (hit) {
      hit.minutes += minutes;
      hit.events += 1;
    } else {
      map.set(e.reason, { reason: e.reason, minutes, events: 1 });
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, minutes: Math.round(r.minutes) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Availability = uptime / scheduled time, per machine.
 *
 * Scheduled time comes from the linked WorkCenter's capacityHoursPerDay when
 * there is one, so a cell that only runs one shift isn't scored as if it were
 * idle for sixteen hours a day.
 */
export async function getAvailability(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [equipment, events, workCenters] = await Promise.all([
    prisma.equipment.findMany({ where: { status: { not: "RETIRED" } } }),
    prisma.downtimeEvent.findMany({ where: { startedAt: { gte: since } }, take: 5000 }),
    prisma.workCenter.findMany({ select: { id: true, capacityHoursPerDay: true } }),
  ]);
  const capacity = new Map(workCenters.map((w) => [w.id, w.capacityHoursPerDay]));

  const downByEquipment = new Map<string, number>();
  for (const e of events) {
    const end = e.endedAt ?? new Date();
    const mins = Math.max(0, (end.getTime() - e.startedAt.getTime()) / 60_000);
    downByEquipment.set(e.equipmentId, (downByEquipment.get(e.equipmentId) ?? 0) + mins);
  }

  return equipment
    .map((eq) => {
      const hoursPerDay = eq.workCenterId ? (capacity.get(eq.workCenterId) ?? 16) : 16;
      const scheduledMinutes = hoursPerDay * 60 * days;
      const downMinutes = Math.round(downByEquipment.get(eq.id) ?? 0);
      const availability =
        scheduledMinutes > 0
          ? Math.max(0, Math.round(((scheduledMinutes - downMinutes) / scheduledMinutes) * 1000) / 10)
          : 100;
      return {
        id: eq.id,
        assetTag: eq.assetTag,
        name: eq.name,
        status: eq.status,
        criticality: eq.criticality,
        downMinutes,
        scheduledMinutes,
        availability,
      };
    })
    .sort((a, b) => a.availability - b.availability);
}

export async function getMaintenanceSummary() {
  const [total, down, due, openDowntime] = await Promise.all([
    prisma.equipment.count({ where: { status: { not: "RETIRED" } } }),
    prisma.equipment.count({ where: { status: "DOWN" } }),
    getMaintenanceDue(),
    prisma.downtimeEvent.count({ where: { endedAt: null } }),
  ]);
  return {
    total,
    down,
    dueCount: due.length,
    overdueCount: due.filter((d) => d.reason !== "DUE_SOON").length,
    openDowntime,
  };
}
