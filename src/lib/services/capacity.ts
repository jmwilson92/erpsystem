"use server";

import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, addDays, isWithinInterval } from "date-fns";

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
    priorityLabel: string;
  }[];
};

function weekWindow(ref = new Date()) {
  const start = startOfWeek(ref, { weekStartsOn: 1 });
  const end = endOfWeek(ref, { weekStartsOn: 1 });
  return { start, end };
}

function alertFor(util: number): CapacityAlertLevel {
  if (util > 100) return "OVER";
  if (util >= 85) return "NEAR";
  return "OK";
}

/**
 * Capacity planning: available hours (staff × hours − PTO) vs projected WO hours.
 * Workload planning: weekly hours per work center (visual-ready daily buckets).
 */
export async function getCapacityAndWorkload(refDate?: Date): Promise<{
  weekStart: Date;
  weekEnd: Date;
  centers: WorkCenterCapacity[];
  totals: {
    availableHours: number;
    projectedHours: number;
    overCapacityCount: number;
    nearCapacityCount: number;
  };
}> {
  const { start, end } = weekWindow(refDate || new Date());
  const workingDays = 5;
  const dayKeys: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    // Mon–Fri only for capacity math
    if (d.getDay() !== 0 && d.getDay() !== 6) dayKeys.push(d);
  }

  const [centers, workOrders, pto, staff] = await Promise.all([
    prisma.workCenter.findMany({
      where: { isActive: true },
      orderBy: [{ area: "asc" }, { sortOrder: "asc" }],
      include: {
        staff: {
          where: { isActive: true },
          include: { user: { select: { id: true, name: true, department: true } } },
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
        businessPriority: { select: { number: true, title: true, priority: true } },
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

  // Map user → work centers for PTO allocation
  const userCenters = new Map<string, string[]>();
  for (const s of staff) {
    const list = userCenters.get(s.userId) || [];
    list.push(s.workCenterId);
    userCenters.set(s.userId, list);
  }

  // PTO hours this week per work center (split across assigned centers)
  const ptoByCenter = new Map<string, number>();
  for (const p of pto) {
    const centersForUser = userCenters.get(p.userId) || [];
    if (!centersForUser.length) continue;
    // Approximate PTO hours overlapping this week as 8h × overlapping weekdays
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

  const result: WorkCenterCapacity[] = centers.map((wc) => {
    const staffCount = wc.staff.length;
    // Prefer staffed hours; fall back to work center capacityHoursPerDay
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

    const projectedHoursThisWeek = wos.reduce((sum, wo) => {
      const mins = wo.estimatedMinutes || 0;
      // Spread estimated minutes across remaining window; treat as full week load for visibility
      return sum + mins / 60;
    }, 0);

    const workloadByDay = dayKeys.map((d) => {
      // Evenly distribute projected hours across weekdays for visual overview
      const share = projectedHoursThisWeek / Math.max(1, dayKeys.length);
      return {
        date: d.toISOString().slice(0, 10),
        hours: Math.round(share * 10) / 10,
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
      };
    });

    const utilizationPct =
      availableHoursThisWeek > 0
        ? Math.round((projectedHoursThisWeek / availableHoursThisWeek) * 1000) / 10
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
      workOrders: wos.map((wo) => ({
        id: wo.id,
        number: wo.number,
        status: wo.status,
        estimatedHours: Math.round(((wo.estimatedMinutes || 0) / 60) * 10) / 10,
        priorityLabel: wo.businessPriority
          ? `${wo.businessPriority.number} ${wo.businessPriority.title}`
          : "Unrated",
      })),
    };
  });

  const totals = {
    availableHours: Math.round(
      result.reduce((s, c) => s + c.availableHoursThisWeek, 0) * 10
    ) / 10,
    projectedHours: Math.round(
      result.reduce((s, c) => s + c.projectedHoursThisWeek, 0) * 10
    ) / 10,
    overCapacityCount: result.filter((c) => c.alert === "OVER").length,
    nearCapacityCount: result.filter((c) => c.alert === "NEAR").length,
  };

  return { weekStart: start, weekEnd: end, centers: result, totals };
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
  // One person may only be active on a single work center at a time — move if needed
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

/** Map of userId → work center code for people currently staffed somewhere */
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
