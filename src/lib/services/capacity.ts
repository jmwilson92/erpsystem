"use server";

import { prisma } from "@/lib/db";
import {
  startOfWeek,
  endOfWeek,
  addDays,
  isWithinInterval,
  startOfDay,
  endOfDay,
} from "date-fns";
import {
  NEAR_CAPACITY_PCT,
  OVER_CAPACITY_PCT,
  backSchedule,
  overlapWorkingHours,
  workingMinutesBetween,
  type CalendarContext,
} from "@/lib/services/schedule";

export type CapacityAlertLevel = "OK" | "NEAR" | "OVER";

export type WorkCenterCapacity = {
  workCenterId: string;
  code: string;
  name: string;
  area: string;
  staffCount: number;
  staff: { userId: string; name: string; hoursPerDay: number }[];
  hoursPerDayTotal: number;
  ptoHoursThisWeek: number;
  availableHoursThisWeek: number;
  projectedHoursThisWeek: number;
  utilizationPct: number;
  alert: CapacityAlertLevel;
  workloadByDay: { date: string; hours: number; label: string }[];
  workOrders: {
    id: string;
    number: string;
    status: string;
    estimatedHours: number;
    hoursInHorizon: number;
    plannedStart: string | null;
    plannedEnd: string | null;
    scheduleRisk: string | null;
    priorityLabel: string;
  }[];
};

export type UnscheduledBucket = {
  count: number;
  hours: number;
  workOrders: { id: string; number: string; estimatedHours: number; workCenter: string | null }[];
};

function weekWindow(ref = new Date()) {
  const start = startOfWeek(ref, { weekStartsOn: 1 });
  const end = endOfWeek(ref, { weekStartsOn: 1 });
  return { start, end };
}

function alertFor(util: number): CapacityAlertLevel {
  if (util > OVER_CAPACITY_PCT) return "OVER";
  if (util >= NEAR_CAPACITY_PCT) return "NEAR";
  return "OK";
}

function workingDayKeys(start: Date, end: Date): Date[] {
  const keys: Date[] = [];
  let d = startOfDay(start);
  const last = startOfDay(end);
  let guard = 0;
  while (d.getTime() <= last.getTime() && guard < 400) {
    guard++;
    if (d.getDay() !== 0 && d.getDay() !== 6) keys.push(d);
    d = addDays(d, 1);
  }
  return keys;
}

/**
 * Hours of a WO that fall inside the horizon.
 * Uses planned window when present; synthesizes back-schedule from due+estimate;
 * otherwise returns 0 (caller puts WO in unscheduled bucket).
 */
async function hoursInHorizonForWo(
  wo: {
    plannedStart: Date | null;
    plannedEnd: Date | null;
    dueDate: Date | null;
    estimatedMinutes: number | null;
    workCenter: string | null;
  },
  horizonStart: Date,
  horizonEnd: Date,
  ctx: CalendarContext
): Promise<{ hours: number; plannedStart: Date | null; plannedEnd: Date | null; scheduled: boolean }> {
  const est = wo.estimatedMinutes || 0;
  let ps = wo.plannedStart;
  let pe = wo.plannedEnd;

  if ((!ps || !pe) && wo.dueDate && est > 0) {
    try {
      const syn = await backSchedule({
        dueDate: wo.dueDate,
        estimatedMinutes: est,
        workCenter: wo.workCenter,
      });
      ps = ps || syn.plannedStart;
      pe = pe || syn.plannedEnd;
    } catch {
      // ignore
    }
  }

  if (ps && pe) {
    const hours = overlapWorkingHours(ps, pe, horizonStart, horizonEnd, est, ctx);
    return { hours, plannedStart: ps, plannedEnd: pe, scheduled: true };
  }

  return { hours: 0, plannedStart: ps, plannedEnd: pe, scheduled: false };
}

/**
 * Distribute working hours of [plannedStart, plannedEnd] across day keys in horizon.
 */
function distributeToDays(
  plannedStart: Date,
  plannedEnd: Date,
  dayKeys: Date[],
  ctx: CalendarContext,
  dayTotals: number[]
) {
  for (let i = 0; i < dayKeys.length; i++) {
    const dayStart = startOfDay(dayKeys[i]);
    const dayEnd = endOfDay(dayKeys[i]);
    const hours =
      overlapWorkingHours(plannedStart, plannedEnd, dayStart, dayEnd, 0, ctx) ||
      workingMinutesBetween(
        plannedStart > dayStart ? plannedStart : dayStart,
        plannedEnd < dayEnd ? plannedEnd : dayEnd,
        ctx
      ) / 60;
    // Only count if window overlaps this day
    if (plannedStart <= dayEnd && plannedEnd >= dayStart) {
      const mins = workingMinutesBetween(
        plannedStart > dayStart ? plannedStart : dayStart,
        plannedEnd < dayEnd ? plannedEnd : dayEnd,
        ctx
      );
      dayTotals[i] += mins / 60;
    }
  }
}

/**
 * Capacity planning: available hours (staff × hours − PTO) vs projected WO hours
 * that **overlap the selected horizon** (not the entire open backlog).
 */
export async function getCapacityAndWorkload(
  refDate?: Date,
  opts?: { horizonStart?: Date; horizonEnd?: Date }
): Promise<{
  weekStart: Date;
  weekEnd: Date;
  centers: WorkCenterCapacity[];
  unscheduled: UnscheduledBucket;
  totals: {
    availableHours: number;
    projectedHours: number;
    unscheduledHours: number;
    overCapacityCount: number;
    nearCapacityCount: number;
    totalCapacityPct: number;
    alert: CapacityAlertLevel;
  };
}> {
  const defaultWeek = weekWindow(refDate || new Date());
  const start = opts?.horizonStart || defaultWeek.start;
  const end = opts?.horizonEnd || defaultWeek.end;
  const dayKeys = workingDayKeys(start, end);
  const workingDays = Math.max(1, dayKeys.length);
  const calCtx: CalendarContext = {
    mode: "FIXED_SHIFT",
    hoursPerDay: 8,
    minutesPerDay: 8 * 60,
  };

  const [centers, workOrders, pto, staff] = await Promise.all([
    prisma.workCenter.findMany({
      where: { isActive: true },
      orderBy: [{ area: "asc" }, { sortOrder: "asc" }],
      include: {
        staff: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, name: true, department: true } },
          },
        },
      },
    }),
    prisma.workOrder.findMany({
      where: {
        status: {
          notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"],
        },
      },
      include: {
        businessPriority: {
          select: { number: true, title: true, priority: true },
        },
        assignee: { select: { id: true, name: true } },
      },
    }),
    prisma.ptoRequest.findMany({
      where: {
        status: { in: ["APPROVED", "PENDING"] },
        OR: [
          {
            startDate: { lte: end },
            endDate: { gte: start },
          },
        ],
      },
    }),
    prisma.workCenterStaff.findMany({
      where: { isActive: true },
      select: { userId: true, workCenterId: true, hoursPerDay: true },
    }),
  ]);

  const userCenters = new Map<string, string[]>();
  for (const s of staff) {
    const list = userCenters.get(s.userId) || [];
    list.push(s.workCenterId);
    userCenters.set(s.userId, list);
  }

  const ptoByCenter = new Map<string, number>();
  for (const p of pto) {
    const centersForUser = userCenters.get(p.userId) || [];
    if (!centersForUser.length) continue;
    let days = 0;
    for (const d of dayKeys) {
      if (
        isWithinInterval(d, {
          start: p.startDate,
          end: p.endDate,
        })
      ) {
        days += 1;
      }
    }
    const hours = days * 8;
    const share = hours / centersForUser.length;
    for (const wcId of centersForUser) {
      ptoByCenter.set(wcId, (ptoByCenter.get(wcId) || 0) + share);
    }
  }

  const unscheduledList: UnscheduledBucket["workOrders"] = [];
  let unscheduledHours = 0;

  // Precompute hours for each WO
  const woLoad = new Map<
    string,
    {
      hours: number;
      plannedStart: Date | null;
      plannedEnd: Date | null;
      scheduled: boolean;
    }
  >();
  for (const wo of workOrders) {
    const load = await hoursInHorizonForWo(wo, start, end, calCtx);
    woLoad.set(wo.id, load);
    if (!load.scheduled) {
      const h = (wo.estimatedMinutes || 0) / 60;
      unscheduledHours += h;
      unscheduledList.push({
        id: wo.id,
        number: wo.number,
        estimatedHours: Math.round(h * 10) / 10,
        workCenter: wo.workCenter,
      });
    }
  }

  const result: WorkCenterCapacity[] = centers.map((wc) => {
    const staffCount = wc.staff.length;
    const hoursPerDayTotal =
      staffCount > 0
        ? wc.staff.reduce((s, x) => s + (x.hoursPerDay || 8), 0)
        : wc.capacityHoursPerDay || 8;

    const ptoHours = ptoByCenter.get(wc.id) || 0;
    const availableHoursThisWeek = Math.max(
      0,
      hoursPerDayTotal * workingDays * (wc.efficiency || 1) - ptoHours
    );

    const wos = workOrders.filter(
      (wo) => (wo.workCenter || "").toUpperCase() === wc.code.toUpperCase()
    );

    const dayTotals = dayKeys.map(() => 0);
    let projectedHoursThisWeek = 0;
    const woRows: WorkCenterCapacity["workOrders"] = [];

    for (const wo of wos) {
      const load = woLoad.get(wo.id)!;
      if (load.scheduled && load.hours > 0) {
        projectedHoursThisWeek += load.hours;
        if (load.plannedStart && load.plannedEnd) {
          distributeToDays(
            load.plannedStart,
            load.plannedEnd,
            dayKeys,
            calCtx,
            dayTotals
          );
        }
      }
      woRows.push({
        id: wo.id,
        number: wo.number,
        status: wo.status,
        estimatedHours: Math.round(((wo.estimatedMinutes || 0) / 60) * 10) / 10,
        hoursInHorizon: Math.round(load.hours * 10) / 10,
        plannedStart: load.plannedStart?.toISOString() || null,
        plannedEnd: load.plannedEnd?.toISOString() || null,
        scheduleRisk: wo.scheduleRisk,
        priorityLabel: wo.businessPriority
          ? `${wo.businessPriority.number} ${wo.businessPriority.title}`
          : "Unrated",
      });
    }

    // Unassigned work center code match misses — handled in unscheduled

    const workloadByDay = dayKeys.map((d, i) => ({
      date: d.toISOString().slice(0, 10),
      hours: Math.round(dayTotals[i] * 10) / 10,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
    }));

    const utilizationPct =
      availableHoursThisWeek > 0
        ? Math.round(
            (projectedHoursThisWeek / availableHoursThisWeek) * 1000
          ) / 10
        : projectedHoursThisWeek > 0
          ? 999
          : 0;

    return {
      workCenterId: wc.id,
      code: wc.code,
      name: wc.name,
      area: wc.area,
      staffCount,
      staff: wc.staff.map((s) => ({
        userId: s.userId,
        name: s.user.name,
        hoursPerDay: s.hoursPerDay,
      })),
      hoursPerDayTotal: Math.round(hoursPerDayTotal * 10) / 10,
      ptoHoursThisWeek: Math.round(ptoHours * 10) / 10,
      availableHoursThisWeek: Math.round(availableHoursThisWeek * 10) / 10,
      projectedHoursThisWeek: Math.round(projectedHoursThisWeek * 10) / 10,
      utilizationPct,
      alert: alertFor(utilizationPct),
      workloadByDay,
      workOrders: woRows,
    };
  });

  // WOs with no matching work center still appear in unscheduled if not scheduled;
  // also add scheduled hours on unknown centers as a virtual "UNASSIGNED" card if needed
  const knownCodes = new Set(centers.map((c) => c.code.toUpperCase()));
  const orphanScheduled = workOrders.filter((wo) => {
    const code = (wo.workCenter || "").toUpperCase();
    return !code || !knownCodes.has(code);
  });
  if (orphanScheduled.length) {
    const dayTotals = dayKeys.map(() => 0);
    let projected = 0;
    const woRows: WorkCenterCapacity["workOrders"] = [];
    for (const wo of orphanScheduled) {
      const load = woLoad.get(wo.id)!;
      if (load.scheduled && load.hours > 0) {
        projected += load.hours;
        if (load.plannedStart && load.plannedEnd) {
          distributeToDays(
            load.plannedStart,
            load.plannedEnd,
            dayKeys,
            calCtx,
            dayTotals
          );
        }
      }
      woRows.push({
        id: wo.id,
        number: wo.number,
        status: wo.status,
        estimatedHours: Math.round(((wo.estimatedMinutes || 0) / 60) * 10) / 10,
        hoursInHorizon: Math.round(load.hours * 10) / 10,
        plannedStart: load.plannedStart?.toISOString() || null,
        plannedEnd: load.plannedEnd?.toISOString() || null,
        scheduleRisk: wo.scheduleRisk,
        priorityLabel: wo.businessPriority
          ? `${wo.businessPriority.number} ${wo.businessPriority.title}`
          : "Unrated",
      });
    }
    if (projected > 0 || woRows.length) {
      result.push({
        workCenterId: "unassigned",
        code: "UNASSIGNED",
        name: "Unassigned / unknown station",
        area: "MANUFACTURING",
        staffCount: 0,
        staff: [],
        hoursPerDayTotal: 0,
        ptoHoursThisWeek: 0,
        availableHoursThisWeek: 0,
        projectedHoursThisWeek: Math.round(projected * 10) / 10,
        utilizationPct: projected > 0 ? 999 : 0,
        alert: projected > 0 ? "OVER" : "OK",
        workloadByDay: dayKeys.map((d, i) => ({
          date: d.toISOString().slice(0, 10),
          hours: Math.round(dayTotals[i] * 10) / 10,
          label: d.toLocaleDateString(undefined, { weekday: "short" }),
        })),
        workOrders: woRows,
      });
    }
  }

  const availableHours =
    Math.round(
      result
        .filter((c) => c.code !== "UNASSIGNED")
        .reduce((s, c) => s + c.availableHoursThisWeek, 0) * 10
    ) / 10;
  const projectedHours =
    Math.round(
      result.reduce((s, c) => s + c.projectedHoursThisWeek, 0) * 10
    ) / 10;
  const totalCapacityPct =
    availableHours > 0
      ? Math.round((projectedHours / availableHours) * 1000) / 10
      : projectedHours > 0
        ? 999
        : 0;
  const totals = {
    availableHours,
    projectedHours,
    unscheduledHours: Math.round(unscheduledHours * 10) / 10,
    overCapacityCount: result.filter((c) => c.alert === "OVER").length,
    nearCapacityCount: result.filter((c) => c.alert === "NEAR").length,
    totalCapacityPct,
    alert: alertFor(totalCapacityPct),
  };

  return {
    weekStart: start,
    weekEnd: end,
    centers: result,
    unscheduled: {
      count: unscheduledList.length,
      hours: Math.round(unscheduledHours * 10) / 10,
      workOrders: unscheduledList.slice(0, 40),
    },
    totals,
  };
}

/**
 * Assign a person to a work center.
 * Rule: one active work center per person.
 * If they are already on another center, they are moved (old assignment deactivated).
 */
export async function assignWorkCenterStaff(params: {
  workCenterId: string;
  userId: string;
  hoursPerDay?: number;
}): Promise<{
  staff: Awaited<ReturnType<typeof prisma.workCenterStaff.upsert>>;
  movedFrom: { code: string; name: string } | null;
}> {
  const other = await prisma.workCenterStaff.findFirst({
    where: {
      userId: params.userId,
      isActive: true,
      workCenterId: { not: params.workCenterId },
    },
    include: { workCenter: { select: { code: true, name: true } } },
  });

  if (other) {
    await prisma.workCenterStaff.update({
      where: { id: other.id },
      data: { isActive: false },
    });
  }

  const staff = await prisma.workCenterStaff.upsert({
    where: {
      workCenterId_userId: {
        workCenterId: params.workCenterId,
        userId: params.userId,
      },
    },
    create: {
      workCenterId: params.workCenterId,
      userId: params.userId,
      hoursPerDay: params.hoursPerDay ?? 8,
      isActive: true,
    },
    update: {
      hoursPerDay: params.hoursPerDay ?? 8,
      isActive: true,
    },
  });

  return {
    staff,
    movedFrom: other
      ? { code: other.workCenter.code, name: other.workCenter.name }
      : null,
  };
}

export async function getActiveStaffAssignments(): Promise<
  Map<string, { workCenterId: string; code: string; name: string }>
> {
  const rows = await prisma.workCenterStaff.findMany({
    where: { isActive: true },
    include: {
      workCenter: { select: { id: true, code: true, name: true } },
    },
  });
  const map = new Map<
    string,
    { workCenterId: string; code: string; name: string }
  >();
  for (const r of rows) {
    map.set(r.userId, {
      workCenterId: r.workCenterId,
      code: r.workCenter.code,
      name: r.workCenter.name,
    });
  }
  return map;
}

export async function removeWorkCenterStaff(params: {
  workCenterId: string;
  userId: string;
}) {
  return prisma.workCenterStaff.updateMany({
    where: {
      workCenterId: params.workCenterId,
      userId: params.userId,
    },
    data: { isActive: false },
  });
}
