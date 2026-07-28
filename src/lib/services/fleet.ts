/**
 * Fleet management — service vans, trucks, forklifts, trailers.
 *
 * Two things a fleet actually has to answer:
 *  1. What's due? (PM by date OR odometer, whichever hits first, plus
 *     registration/insurance/inspection expiry)
 *  2. What does it cost? (fuel + maintenance per unit, per mile)
 *
 * Odometer is the source of truth for distance-based PM, so anything that
 * moves it (fuel log, completed visit) should call recordOdometer.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const VEHICLE_TYPES = [
  "VAN",
  "TRUCK",
  "CAR",
  "FORKLIFT",
  "TRAILER",
  "OTHER",
] as const;

export const VEHICLE_STATUSES = [
  "ACTIVE",
  "IN_SHOP",
  "OUT_OF_SERVICE",
  "RETIRED",
] as const;

export const MAINTENANCE_TYPES = [
  "PM",
  "REPAIR",
  "TIRES",
  "INSPECTION",
  "OTHER",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export async function listVehicles(params?: {
  status?: string;
  assignedToId?: string;
}) {
  return prisma.vehicle.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.assignedToId ? { assignedToId: params.assignedToId } : {}),
    },
    orderBy: [{ status: "asc" }, { unitNumber: "asc" }],
  });
}

export async function getVehicle(id: string) {
  return prisma.vehicle.findUnique({
    where: { id },
    include: {
      maintenance: { orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
      fuelLogs: { orderBy: { filledAt: "desc" }, take: 50 },
    },
  });
}

export async function createVehicle(params: {
  unitNumber: string;
  name?: string | null;
  type?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  licensePlate?: string | null;
  odometer?: number;
  odometerUnit?: string;
  assignedToId?: string | null;
  homeLocation?: string | null;
  registrationExpires?: Date | null;
  insuranceExpires?: Date | null;
  inspectionExpires?: Date | null;
  notes?: string | null;
  userId?: string;
}) {
  const unitNumber = params.unitNumber.trim();
  if (!unitNumber) throw new Error("Unit number is required");
  const vehicle = await prisma.vehicle.create({
    data: {
      unitNumber,
      name: params.name?.trim() || null,
      type: params.type || "VAN",
      make: params.make?.trim() || null,
      model: params.model?.trim() || null,
      year: params.year ?? null,
      vin: params.vin?.trim() || null,
      licensePlate: params.licensePlate?.trim() || null,
      odometer: params.odometer ?? 0,
      odometerUnit: params.odometerUnit || "MI",
      assignedToId: params.assignedToId || null,
      homeLocation: params.homeLocation?.trim() || null,
      registrationExpires: params.registrationExpires ?? null,
      insuranceExpires: params.insuranceExpires ?? null,
      inspectionExpires: params.inspectionExpires ?? null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { unitNumber },
  });
  return vehicle;
}

export async function updateVehicle(
  id: string,
  data: Record<string, unknown>,
  userId?: string
) {
  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  await logAudit({
    entityType: "Vehicle",
    entityId: id,
    action: "UPDATED",
    userId,
  });
  return vehicle;
}

/** Move the odometer forward only — a lower reading is a typo, not a rollback. */
export async function recordOdometer(vehicleId: string, reading: number) {
  if (!Number.isFinite(reading) || reading < 0) return;
  const v = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { odometer: true },
  });
  if (!v || reading <= v.odometer) return;
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { odometer: reading },
  });
}

// ─── Maintenance ────────────────────────────────────────────────

export async function addMaintenance(params: {
  vehicleId: string;
  type?: string;
  description?: string | null;
  dueAt?: Date | null;
  dueOdometer?: number | null;
  intervalDays?: number | null;
  intervalDistance?: number | null;
  userId?: string;
}) {
  const row = await prisma.vehicleMaintenance.create({
    data: {
      vehicleId: params.vehicleId,
      type: params.type || "PM",
      description: params.description?.trim() || null,
      dueAt: params.dueAt ?? null,
      dueOdometer: params.dueOdometer ?? null,
      intervalDays: params.intervalDays ?? null,
      intervalDistance: params.intervalDistance ?? null,
    },
  });
  await logAudit({
    entityType: "VehicleMaintenance",
    entityId: row.id,
    action: "SCHEDULED",
    userId: params.userId,
  });
  return row;
}

/**
 * Close out a maintenance item and, when it repeats, schedule the next one
 * from the interval so a PM programme keeps rolling without manual re-entry.
 */
export async function completeMaintenance(params: {
  id: string;
  completedAt?: Date;
  completedOdometer?: number | null;
  cost?: number | null;
  vendor?: string | null;
  userId?: string;
}) {
  const existing = await prisma.vehicleMaintenance.findUnique({
    where: { id: params.id },
  });
  if (!existing) throw new Error("Maintenance record not found");

  const completedAt = params.completedAt ?? new Date();
  const done = await prisma.vehicleMaintenance.update({
    where: { id: params.id },
    data: {
      status: "COMPLETED",
      completedAt,
      completedOdometer: params.completedOdometer ?? null,
      cost: params.cost ?? null,
      vendor: params.vendor?.trim() || null,
    },
  });

  if (params.completedOdometer != null) {
    await recordOdometer(existing.vehicleId, params.completedOdometer);
  }

  // Roll the next occurrence when this item is on an interval.
  if (existing.intervalDays || existing.intervalDistance) {
    const nextDue = existing.intervalDays
      ? new Date(completedAt.getTime() + existing.intervalDays * 86_400_000)
      : null;
    const baseOdo = params.completedOdometer ?? existing.dueOdometer ?? null;
    const nextOdo =
      existing.intervalDistance && baseOdo != null
        ? baseOdo + existing.intervalDistance
        : null;
    await prisma.vehicleMaintenance.create({
      data: {
        vehicleId: existing.vehicleId,
        type: existing.type,
        description: existing.description,
        dueAt: nextDue,
        dueOdometer: nextOdo,
        intervalDays: existing.intervalDays,
        intervalDistance: existing.intervalDistance,
      },
    });
  }

  await logAudit({
    entityType: "VehicleMaintenance",
    entityId: params.id,
    action: "COMPLETED",
    userId: params.userId,
  });
  return done;
}

export type DueItem = {
  id: string;
  vehicleId: string;
  unitNumber: string;
  type: string;
  description: string | null;
  dueAt: Date | null;
  dueOdometer: number | null;
  odometer: number;
  /** Why it's showing: past due date, past due odometer, or approaching. */
  reason: "OVERDUE_DATE" | "OVERDUE_ODOMETER" | "DUE_SOON";
};

/**
 * Maintenance that needs attention: past due by date or odometer, or coming up
 * inside `withinDays` / `withinDistance`.
 */
export async function getMaintenanceDue(params?: {
  withinDays?: number;
  withinDistance?: number;
}): Promise<DueItem[]> {
  const withinDays = params?.withinDays ?? 14;
  const withinDistance = params?.withinDistance ?? 500;
  const horizon = new Date(Date.now() + withinDays * 86_400_000);

  const rows = await prisma.vehicleMaintenance.findMany({
    where: { status: "SCHEDULED" },
    include: { vehicle: { select: { unitNumber: true, odometer: true } } },
    orderBy: { dueAt: "asc" },
    take: 200,
  });

  const now = new Date();
  const out: DueItem[] = [];
  for (const r of rows) {
    const odo = r.vehicle.odometer;
    let reason: DueItem["reason"] | null = null;
    if (r.dueAt && r.dueAt <= now) reason = "OVERDUE_DATE";
    else if (r.dueOdometer != null && odo >= r.dueOdometer)
      reason = "OVERDUE_ODOMETER";
    else if (r.dueAt && r.dueAt <= horizon) reason = "DUE_SOON";
    else if (r.dueOdometer != null && odo >= r.dueOdometer - withinDistance)
      reason = "DUE_SOON";
    if (!reason) continue;
    out.push({
      id: r.id,
      vehicleId: r.vehicleId,
      unitNumber: r.vehicle.unitNumber,
      type: r.type,
      description: r.description,
      dueAt: r.dueAt,
      dueOdometer: r.dueOdometer,
      odometer: odo,
      reason,
    });
  }
  // Overdue first, then soonest.
  const rank = { OVERDUE_DATE: 0, OVERDUE_ODOMETER: 0, DUE_SOON: 1 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason]);
}

/** Registration / insurance / inspection coming due or already lapsed. */
export async function getComplianceDue(withinDays = 30) {
  const horizon = new Date(Date.now() + withinDays * 86_400_000);
  const vehicles = await prisma.vehicle.findMany({
    where: {
      status: { not: "RETIRED" },
      OR: [
        { registrationExpires: { lte: horizon } },
        { insuranceExpires: { lte: horizon } },
        { inspectionExpires: { lte: horizon } },
      ],
    },
    orderBy: { unitNumber: "asc" },
  });
  const now = new Date();
  const out: {
    vehicleId: string;
    unitNumber: string;
    kind: string;
    date: Date;
    expired: boolean;
  }[] = [];
  for (const v of vehicles) {
    const checks: [string, Date | null][] = [
      ["Registration", v.registrationExpires],
      ["Insurance", v.insuranceExpires],
      ["Inspection", v.inspectionExpires],
    ];
    for (const [kind, date] of checks) {
      if (date && date <= horizon) {
        out.push({
          vehicleId: v.id,
          unitNumber: v.unitNumber,
          kind,
          date,
          expired: date < now,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ─── Fuel & cost ────────────────────────────────────────────────

export async function addFuelLog(params: {
  vehicleId: string;
  gallons: number;
  cost: number;
  odometer?: number | null;
  location?: string | null;
  filledAt?: Date;
  userId?: string;
}) {
  const row = await prisma.fuelLog.create({
    data: {
      vehicleId: params.vehicleId,
      gallons: params.gallons,
      cost: params.cost,
      odometer: params.odometer ?? null,
      location: params.location?.trim() || null,
      filledAt: params.filledAt ?? new Date(),
      userId: params.userId || null,
    },
  });
  if (params.odometer != null) {
    await recordOdometer(params.vehicleId, params.odometer);
  }
  return row;
}

/**
 * Running cost for one unit. Distance uses the odometer span actually covered
 * by fuel logs, so cost-per-mile stays honest when a vehicle predates the
 * system (no fabricated baseline from purchase date).
 */
export async function getVehicleCost(vehicleId: string, days = 365) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [fuel, maint] = await Promise.all([
    prisma.fuelLog.findMany({
      where: { vehicleId, filledAt: { gte: since } },
      orderBy: { filledAt: "asc" },
    }),
    prisma.vehicleMaintenance.findMany({
      where: { vehicleId, status: "COMPLETED", completedAt: { gte: since } },
      select: { cost: true },
    }),
  ]);

  const fuelCost = fuel.reduce((n, f) => n + (f.cost || 0), 0);
  const gallons = fuel.reduce((n, f) => n + (f.gallons || 0), 0);
  const maintCost = maint.reduce((n, m) => n + (m.cost || 0), 0);

  const odos = fuel
    .map((f) => f.odometer)
    .filter((o): o is number => o != null)
    .sort((a, b) => a - b);
  const distance = odos.length >= 2 ? odos[odos.length - 1] - odos[0] : 0;

  return {
    fuelCost,
    maintCost,
    totalCost: fuelCost + maintCost,
    gallons,
    distance,
    costPerDistance: distance > 0 ? (fuelCost + maintCost) / distance : null,
    mpg: distance > 0 && gallons > 0 ? distance / gallons : null,
  };
}
