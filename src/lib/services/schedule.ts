/**
 * Planning schedule engine — estimates, working calendar, back/forward schedule.
 * Capacity and planning modules should call into this instead of inventing minute math.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  addDays,
  startOfDay,
  endOfDay,
  isWeekend,
  differenceInCalendarDays,
  min as minDate,
  max as maxDate,
} from "date-fns";

// ── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_STEP_MINUTES = 30;
export const KIT_BUFFER_MINUTES = 60;
export const DEFAULT_STAGING_BUFFER_MINUTES = 480; // 1×8h working day
export const DEFAULT_BUY_LEAD_DAYS = 14;
export const NEAR_CAPACITY_PCT = 85;
export const OVER_CAPACITY_PCT = 100;

export type CalendarMode =
  | "FIXED_SHIFT"
  | "WORK_CENTER"
  | "STAFFED"
  | "CUSTOM_SHIFT";

export type ScheduleMode = "BACK" | "FORWARD" | "MANUAL";

export type ScheduleRisk =
  | "OK"
  | "LATE_RISK"
  | "MATERIAL_BLOCKED"
  | "NO_ESTIMATE"
  | "NO_DATES";

export type PlanningSettings = {
  calendarMode: CalendarMode;
  fixedShiftHours: number;
  customShiftHours: number;
  kitBufferMinutes: number;
  defaultStepMinutes: number;
  stagingBufferMinutes: number;
  defaultBuyLeadDays: number;
};

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  calendarMode: "FIXED_SHIFT",
  fixedShiftHours: 8,
  customShiftHours: 8,
  kitBufferMinutes: KIT_BUFFER_MINUTES,
  defaultStepMinutes: DEFAULT_STEP_MINUTES,
  stagingBufferMinutes: DEFAULT_STAGING_BUFFER_MINUTES,
  defaultBuyLeadDays: DEFAULT_BUY_LEAD_DAYS,
};

export type CalendarContext = {
  mode: CalendarMode;
  /** Override hours/day when mode is CUSTOM_SHIFT or FIXED_SHIFT */
  hoursPerDay?: number;
  workCenterCode?: string | null;
  workCenterId?: string | null;
  efficiency?: number;
  /** Pre-resolved minutes of work per day (skips async resolve) */
  minutesPerDay?: number;
};

// ── Planning settings ──────────────────────────────────────────────────────

export async function getPlanningSettings(): Promise<PlanningSettings> {
  const row = await prisma.companySettings.findUnique({
    where: { id: "default" },
    select: { planningSettings: true },
  });
  if (!row?.planningSettings) return { ...DEFAULT_PLANNING_SETTINGS };
  try {
    const parsed = JSON.parse(row.planningSettings) as Partial<PlanningSettings>;
    return {
      ...DEFAULT_PLANNING_SETTINGS,
      ...parsed,
      calendarMode: (parsed.calendarMode ||
        DEFAULT_PLANNING_SETTINGS.calendarMode) as CalendarMode,
    };
  } catch {
    return { ...DEFAULT_PLANNING_SETTINGS };
  }
}

export async function savePlanningSettings(
  patch: Partial<PlanningSettings>,
  userId?: string
): Promise<PlanningSettings> {
  const current = await getPlanningSettings();
  const next = { ...current, ...patch };
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      planningSettings: JSON.stringify(next),
      updatedById: userId || null,
    },
    update: {
      planningSettings: JSON.stringify(next),
      updatedById: userId || null,
    },
  });
  return next;
}

// ── Calendar pure math ─────────────────────────────────────────────────────

export function isWorkingDay(d: Date): boolean {
  return !isWeekend(d);
}

/** Normalize to local noon to avoid DST edge issues when walking days. */
function dayKey(d: Date): Date {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

export function resolveMinutesPerDaySync(ctx: CalendarContext): number {
  if (ctx.minutesPerDay && ctx.minutesPerDay > 0) return ctx.minutesPerDay;
  const hours =
    ctx.hoursPerDay && ctx.hoursPerDay > 0
      ? ctx.hoursPerDay
      : DEFAULT_PLANNING_SETTINGS.fixedShiftHours;
  const eff = ctx.efficiency && ctx.efficiency > 0 ? ctx.efficiency : 1;
  return Math.max(1, Math.round(hours * 60 * eff));
}

export async function resolveMinutesPerDay(
  ctx: CalendarContext,
  settings?: PlanningSettings
): Promise<number> {
  if (ctx.minutesPerDay && ctx.minutesPerDay > 0) return ctx.minutesPerDay;
  const s = settings || (await getPlanningSettings());
  const mode = ctx.mode || s.calendarMode;

  if (mode === "FIXED_SHIFT") {
    const h = ctx.hoursPerDay ?? s.fixedShiftHours;
    return Math.max(1, Math.round(h * 60));
  }
  if (mode === "CUSTOM_SHIFT") {
    const h = ctx.hoursPerDay ?? s.customShiftHours;
    return Math.max(1, Math.round(h * 60));
  }
  if (mode === "WORK_CENTER") {
    let wc = null as {
      capacityHoursPerDay: number;
      efficiency: number;
    } | null;
    if (ctx.workCenterId) {
      wc = await prisma.workCenter.findUnique({
        where: { id: ctx.workCenterId },
        select: { capacityHoursPerDay: true, efficiency: true },
      });
    } else if (ctx.workCenterCode) {
      wc = await prisma.workCenter.findUnique({
        where: { code: ctx.workCenterCode },
        select: { capacityHoursPerDay: true, efficiency: true },
      });
    }
    const h = wc?.capacityHoursPerDay ?? s.fixedShiftHours;
    const eff = wc?.efficiency ?? 1;
    return Math.max(1, Math.round(h * 60 * eff));
  }
  if (mode === "STAFFED") {
    let centerId = ctx.workCenterId;
    if (!centerId && ctx.workCenterCode) {
      const wc = await prisma.workCenter.findUnique({
        where: { code: ctx.workCenterCode },
        select: { id: true, efficiency: true, capacityHoursPerDay: true },
      });
      centerId = wc?.id;
      if (!centerId) {
        return Math.max(1, Math.round(s.fixedShiftHours * 60));
      }
      const staff = await prisma.workCenterStaff.findMany({
        where: { workCenterId: centerId, isActive: true },
      });
      const sum = staff.reduce((a, x) => a + (x.hoursPerDay || 8), 0);
      const eff = wc?.efficiency ?? 1;
      if (sum <= 0) {
        return Math.max(
          1,
          Math.round((wc?.capacityHoursPerDay || s.fixedShiftHours) * 60 * eff)
        );
      }
      return Math.max(1, Math.round(sum * 60 * eff));
    }
    if (centerId) {
      const [wc, staff] = await Promise.all([
        prisma.workCenter.findUnique({
          where: { id: centerId },
          select: { efficiency: true, capacityHoursPerDay: true },
        }),
        prisma.workCenterStaff.findMany({
          where: { workCenterId: centerId, isActive: true },
        }),
      ]);
      const sum = staff.reduce((a, x) => a + (x.hoursPerDay || 8), 0);
      const eff = wc?.efficiency ?? 1;
      if (sum <= 0) {
        return Math.max(
          1,
          Math.round((wc?.capacityHoursPerDay || s.fixedShiftHours) * 60 * eff)
        );
      }
      return Math.max(1, Math.round(sum * 60 * eff));
    }
    return Math.max(1, Math.round(s.fixedShiftHours * 60));
  }
  return Math.max(1, Math.round(s.fixedShiftHours * 60));
}

function withResolvedDay(ctx: CalendarContext, minutesPerDay: number): CalendarContext {
  return { ...ctx, minutesPerDay };
}

/** Start of shift on the next working day (or same day if working). */
export function nextWorkingStart(date: Date, ctx?: CalendarContext): Date {
  let d = dayKey(date);
  let guard = 0;
  while (!isWorkingDay(d) && guard < 14) {
    d = addDays(d, 1);
    guard++;
  }
  const mpd = resolveMinutesPerDaySync(ctx || { mode: "FIXED_SHIFT", hoursPerDay: 8 });
  // Represent start-of-shift as midnight of that day; end-of-shift = start + mpd conceptually
  const start = startOfDay(d);
  void mpd;
  return start;
}

/** End of shift on a working day (startOfDay + full day allocation marker). */
export function endOfWorkingDay(date: Date): Date {
  let d = dayKey(date);
  let guard = 0;
  while (!isWorkingDay(d) && guard < 14) {
    d = addDays(d, -1);
    guard++;
  }
  return endOfDay(d);
}

/**
 * Walk backward from `end` by `minutes` of working time.
 * Consumes full working days at minutesPerDay.
 */
export function subtractWorkingMinutes(
  end: Date,
  minutes: number,
  ctx: CalendarContext = { mode: "FIXED_SHIFT", hoursPerDay: 8 }
): Date {
  if (minutes <= 0) return endOfWorkingDay(end);
  const mpd = resolveMinutesPerDaySync(ctx);
  let remaining = Math.round(minutes);
  let d = dayKey(end);
  // Land on a working day first
  let guard = 0;
  while (!isWorkingDay(d) && guard < 30) {
    d = addDays(d, -1);
    guard++;
  }
  while (remaining > 0 && guard < 5000) {
    guard++;
    if (!isWorkingDay(d)) {
      d = addDays(d, -1);
      continue;
    }
    if (remaining > mpd) {
      remaining -= mpd;
      d = addDays(d, -1);
    } else {
      // Partial day: start is end-of-day minus remaining portion of the day
      // We store plannedStart as startOfDay when remaining fills most of day,
      // or mid-day approximation: startOfDay + (mpd - remaining) as hours.
      const usedFraction = remaining / mpd;
      const start = startOfDay(d);
      // Place start so that remaining minutes fit before end-of-day
      const offsetMs = (1 - usedFraction) * mpd * 60_000;
      return new Date(start.getTime() + offsetMs);
    }
  }
  return startOfDay(d);
}

/**
 * Walk forward from `start` by `minutes` of working time.
 */
export function addWorkingMinutes(
  start: Date,
  minutes: number,
  ctx: CalendarContext = { mode: "FIXED_SHIFT", hoursPerDay: 8 }
): Date {
  if (minutes <= 0) return nextWorkingStart(start, ctx);
  const mpd = resolveMinutesPerDaySync(ctx);
  let remaining = Math.round(minutes);
  let d = dayKey(start);
  let guard = 0;
  while (!isWorkingDay(d) && guard < 30) {
    d = addDays(d, 1);
    guard++;
  }
  // Consume partial first day from start time
  const startOf = startOfDay(d);
  const alreadyUsedMs = Math.max(0, start.getTime() - startOf.getTime());
  const alreadyUsedMin = alreadyUsedMs / 60_000;
  let firstDayLeft = Math.max(0, mpd - alreadyUsedMin);
  if (firstDayLeft <= 0) {
    d = addDays(d, 1);
    firstDayLeft = mpd;
  }
  if (remaining <= firstDayLeft) {
    return new Date(startOfDay(d).getTime() + (mpd - firstDayLeft + remaining) * 60_000);
  }
  remaining -= firstDayLeft;
  d = addDays(d, 1);
  while (remaining > 0 && guard < 5000) {
    guard++;
    if (!isWorkingDay(d)) {
      d = addDays(d, 1);
      continue;
    }
    if (remaining > mpd) {
      remaining -= mpd;
      d = addDays(d, 1);
    } else {
      return new Date(startOfDay(d).getTime() + remaining * 60_000);
    }
  }
  return endOfDay(d);
}

/** Working minutes between two dates (approximate, day-granular). */
export function workingMinutesBetween(
  a: Date,
  b: Date,
  ctx: CalendarContext = { mode: "FIXED_SHIFT", hoursPerDay: 8 }
): number {
  const mpd = resolveMinutesPerDaySync(ctx);
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  let total = 0;
  let d = dayKey(start);
  const endKey = dayKey(end);
  let guard = 0;
  while (d.getTime() <= endKey.getTime() && guard < 5000) {
    guard++;
    if (isWorkingDay(d)) {
      if (
        d.toDateString() === dayKey(start).toDateString() &&
        d.toDateString() === dayKey(end).toDateString()
      ) {
        total += Math.min(
          mpd,
          Math.max(0, (end.getTime() - start.getTime()) / 60_000)
        );
      } else if (d.toDateString() === dayKey(start).toDateString()) {
        const used = (start.getTime() - startOfDay(start).getTime()) / 60_000;
        total += Math.max(0, mpd - used);
      } else if (d.toDateString() === dayKey(end).toDateString()) {
        const used = (end.getTime() - startOfDay(end).getTime()) / 60_000;
        total += Math.min(mpd, Math.max(0, used));
      } else {
        total += mpd;
      }
    }
    d = addDays(d, 1);
  }
  return Math.round(total);
}

/**
 * How many working hours of a planned window fall inside [horizonStart, horizonEnd].
 */
export function overlapWorkingHours(
  plannedStart: Date | null | undefined,
  plannedEnd: Date | null | undefined,
  horizonStart: Date,
  horizonEnd: Date,
  estimatedMinutes: number,
  ctx: CalendarContext = { mode: "FIXED_SHIFT", hoursPerDay: 8 }
): number {
  if (plannedStart && plannedEnd) {
    const winStart = maxDate([plannedStart, horizonStart]);
    const winEnd = minDate([plannedEnd, horizonEnd]);
    if (winStart >= winEnd) return 0;
    return workingMinutesBetween(winStart, winEnd, ctx) / 60;
  }
  // No window — if due falls in horizon, count full estimate once
  return 0;
}

// ── Estimate ───────────────────────────────────────────────────────────────

export type EstimateBreakdown = {
  estimatedMinutes: number;
  stepCount: number;
  defaultedStepCount: number;
  kitBufferMinutes: number;
  quantity: number;
  source: "WI" | "TRAVELER" | "DEFAULT";
};

/**
 * Compute process minutes from steps (traveler or WI) × qty + kit buffer.
 */
export function computeEstimateFromSteps(
  steps: { estimatedMinutes?: number | null }[],
  quantity: number,
  opts?: { kitBufferMinutes?: number; defaultStepMinutes?: number }
): EstimateBreakdown {
  const kit = opts?.kitBufferMinutes ?? KIT_BUFFER_MINUTES;
  const def = opts?.defaultStepMinutes ?? DEFAULT_STEP_MINUTES;
  let stepSum = 0;
  let defaulted = 0;
  for (const st of steps) {
    if (st.estimatedMinutes != null && st.estimatedMinutes > 0) {
      stepSum += st.estimatedMinutes;
    } else {
      stepSum += def;
      defaulted += 1;
    }
  }
  const qty = Math.max(1, quantity || 1);
  if (steps.length === 0) {
    return {
      estimatedMinutes: kit,
      stepCount: 0,
      defaultedStepCount: 0,
      kitBufferMinutes: kit,
      quantity: qty,
      source: "DEFAULT",
    };
  }
  return {
    estimatedMinutes: Math.round(stepSum * qty + kit),
    stepCount: steps.length,
    defaultedStepCount: defaulted,
    kitBufferMinutes: kit,
    quantity: qty,
    source: "WI",
  };
}

export async function computeWorkOrderEstimate(
  workOrderId: string
): Promise<EstimateBreakdown> {
  const settings = await getPlanningSettings();
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      stepCompletions: {
        include: {
          step: { select: { estimatedMinutes: true } },
        },
      },
      instructions: {
        include: {
          workInstruction: {
            include: {
              steps: { select: { estimatedMinutes: true } },
            },
          },
        },
      },
    },
  });
  if (!wo) throw new Error("Work order not found");

  const travelerSteps = wo.stepCompletions
    .map((c) => c.step)
    .filter(Boolean) as { estimatedMinutes: number | null }[];

  if (travelerSteps.length > 0) {
    const est = computeEstimateFromSteps(travelerSteps, wo.quantity, {
      kitBufferMinutes: settings.kitBufferMinutes,
      defaultStepMinutes: settings.defaultStepMinutes,
    });
    return { ...est, source: "TRAVELER" };
  }

  const wiSteps = wo.instructions.flatMap(
    (i) => i.workInstruction?.steps || []
  );
  if (wiSteps.length > 0) {
    return computeEstimateFromSteps(wiSteps, wo.quantity, {
      kitBufferMinutes: settings.kitBufferMinutes,
      defaultStepMinutes: settings.defaultStepMinutes,
    });
  }

  return computeEstimateFromSteps([], wo.quantity, {
    kitBufferMinutes: settings.kitBufferMinutes,
    defaultStepMinutes: settings.defaultStepMinutes,
  });
}

export async function refreshWorkOrderEstimate(
  workOrderId: string,
  userId?: string
): Promise<EstimateBreakdown> {
  const est = await computeWorkOrderEstimate(workOrderId);
  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      estimatedMinutes: est.estimatedMinutes,
      estimateSource: est.source,
      estimateUpdatedAt: new Date(),
    },
  });
  await logAudit({
    entityType: "WorkOrder",
    entityId: workOrderId,
    action: "ESTIMATE_REFRESHED",
    userId,
    metadata: est,
  });
  return est;
}

/** Estimate minutes for WI ids before a WO exists (create path). */
export async function estimateMinutesForWorkInstructions(
  wiIds: string[],
  quantity: number
): Promise<EstimateBreakdown> {
  const settings = await getPlanningSettings();
  if (!wiIds.length) {
    return computeEstimateFromSteps([], quantity, {
      kitBufferMinutes: settings.kitBufferMinutes,
      defaultStepMinutes: settings.defaultStepMinutes,
    });
  }
  const steps = await prisma.workInstructionStep.findMany({
    where: { workInstructionId: { in: wiIds } },
    select: { estimatedMinutes: true },
  });
  return computeEstimateFromSteps(steps, quantity, {
    kitBufferMinutes: settings.kitBufferMinutes,
    defaultStepMinutes: settings.defaultStepMinutes,
  });
}

// ── Back / forward schedule ────────────────────────────────────────────────

export type ScheduleResult = {
  plannedStart: Date;
  plannedEnd: Date;
  dueDate: Date | null;
  scheduleMode: ScheduleMode;
  scheduleRisk: ScheduleRisk;
  estimatedMinutes: number;
};

export async function buildCalendarContext(params: {
  workCenter?: string | null;
  mode?: CalendarMode;
  hoursPerDay?: number;
}): Promise<{ ctx: CalendarContext; settings: PlanningSettings }> {
  const settings = await getPlanningSettings();
  const mode = params.mode || settings.calendarMode;
  const ctx: CalendarContext = {
    mode,
    workCenterCode: params.workCenter || null,
    hoursPerDay:
      params.hoursPerDay ??
      (mode === "CUSTOM_SHIFT"
        ? settings.customShiftHours
        : mode === "FIXED_SHIFT"
          ? settings.fixedShiftHours
          : undefined),
  };
  const mpd = await resolveMinutesPerDay(ctx, settings);
  return { ctx: withResolvedDay(ctx, mpd), settings };
}

export async function backSchedule(params: {
  dueDate: Date;
  estimatedMinutes: number;
  workCenter?: string | null;
  mode?: CalendarMode;
  hoursPerDay?: number;
}): Promise<ScheduleResult> {
  const { ctx } = await buildCalendarContext(params);
  const due = endOfWorkingDay(params.dueDate);
  const plannedEnd = due;
  const plannedStart = subtractWorkingMinutes(
    plannedEnd,
    params.estimatedMinutes,
    ctx
  );
  return {
    plannedStart,
    plannedEnd,
    dueDate: params.dueDate,
    scheduleMode: "BACK",
    scheduleRisk:
      params.estimatedMinutes <= KIT_BUFFER_MINUTES ? "NO_ESTIMATE" : "OK",
    estimatedMinutes: params.estimatedMinutes,
  };
}

export async function forwardSchedule(params: {
  startDate: Date;
  estimatedMinutes: number;
  dueDate?: Date | null;
  workCenter?: string | null;
  mode?: CalendarMode;
  hoursPerDay?: number;
}): Promise<ScheduleResult> {
  const { ctx } = await buildCalendarContext(params);
  const plannedStart = nextWorkingStart(params.startDate, ctx);
  const plannedEnd = addWorkingMinutes(
    plannedStart,
    params.estimatedMinutes,
    ctx
  );
  let risk: ScheduleRisk =
    params.estimatedMinutes <= KIT_BUFFER_MINUTES ? "NO_ESTIMATE" : "OK";
  if (params.dueDate && plannedEnd > endOfWorkingDay(params.dueDate)) {
    risk = "LATE_RISK";
  }
  return {
    plannedStart,
    plannedEnd,
    dueDate: params.dueDate || null,
    scheduleMode: "FORWARD",
    scheduleRisk: risk,
    estimatedMinutes: params.estimatedMinutes,
  };
}

export async function rescheduleWorkOrder(params: {
  workOrderId: string;
  mode: ScheduleMode;
  dueDate?: Date | null;
  startDate?: Date | null;
  refreshEstimate?: boolean;
  userId?: string;
  hoursPerDay?: number;
  calendarMode?: CalendarMode;
}): Promise<ScheduleResult> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");

  let estimatedMinutes = wo.estimatedMinutes || 0;
  if (params.refreshEstimate !== false) {
    const est = await refreshWorkOrderEstimate(params.workOrderId, params.userId);
    estimatedMinutes = est.estimatedMinutes;
  }
  if (estimatedMinutes <= 0) estimatedMinutes = KIT_BUFFER_MINUTES;

  let result: ScheduleResult;
  if (params.mode === "FORWARD") {
    const start =
      params.startDate ||
      wo.plannedStart ||
      wo.actualStart ||
      new Date();
    result = await forwardSchedule({
      startDate: start,
      estimatedMinutes,
      dueDate: params.dueDate ?? wo.dueDate,
      workCenter: wo.workCenter,
      mode: params.calendarMode,
      hoursPerDay: params.hoursPerDay,
    });
  } else if (params.mode === "MANUAL") {
    const plannedStart = params.startDate || wo.plannedStart || new Date();
    const plannedEnd =
      params.dueDate ||
      wo.plannedEnd ||
      (await forwardSchedule({
        startDate: plannedStart,
        estimatedMinutes,
        workCenter: wo.workCenter,
      })).plannedEnd;
    result = {
      plannedStart,
      plannedEnd,
      dueDate: params.dueDate ?? wo.dueDate,
      scheduleMode: "MANUAL",
      scheduleRisk:
        wo.dueDate && plannedEnd > endOfWorkingDay(wo.dueDate)
          ? "LATE_RISK"
          : "OK",
      estimatedMinutes,
    };
  } else {
    // BACK
    const due = params.dueDate || wo.dueDate;
    if (!due) {
      // Fall forward from today if no due
      result = await forwardSchedule({
        startDate: params.startDate || new Date(),
        estimatedMinutes,
        dueDate: null,
        workCenter: wo.workCenter,
        mode: params.calendarMode,
        hoursPerDay: params.hoursPerDay,
      });
      result.scheduleRisk = "NO_DATES";
    } else {
      result = await backSchedule({
        dueDate: due,
        estimatedMinutes,
        workCenter: wo.workCenter,
        mode: params.calendarMode,
        hoursPerDay: params.hoursPerDay,
      });
    }
  }

  await prisma.workOrder.update({
    where: { id: params.workOrderId },
    data: {
      plannedStart: result.plannedStart,
      plannedEnd: result.plannedEnd,
      dueDate: result.dueDate,
      scheduleMode: result.scheduleMode,
      scheduleRisk: result.scheduleRisk,
      estimatedMinutes: result.estimatedMinutes,
      estimateUpdatedAt: new Date(),
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: params.workOrderId,
    action: "RESCHEDULED",
    userId: params.userId,
    metadata: {
      mode: result.scheduleMode,
      plannedStart: result.plannedStart.toISOString(),
      plannedEnd: result.plannedEnd.toISOString(),
      risk: result.scheduleRisk,
    },
  });

  return result;
}

// ── Lead time helpers ──────────────────────────────────────────────────────

export async function resolveBuyLeadDays(partId: string): Promise<number> {
  const settings = await getPlanningSettings();
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: {
      leadTimeDays: true,
      vendors: {
        orderBy: { isPreferred: "desc" },
        take: 3,
        select: { leadTimeDays: true },
      },
    },
  });
  if (!part) return settings.defaultBuyLeadDays;
  const vendorLead = Math.max(
    0,
    ...part.vendors.map((v) => v.leadTimeDays || 0)
  );
  const lead = Math.max(
    part.leadTimeDays || 0,
    vendorLead,
    1
  );
  return lead || settings.defaultBuyLeadDays;
}

export function neededByFromLead(
  needDate: Date,
  leadDays: number
): Date {
  // Buy should arrive by needDate → order/need-by on PR = needDate (buyer expedites)
  // For planning we set neededBy = needDate; buyer sees lead as context.
  // Also ensure neededBy is at least today + lead if need is ASAP.
  const minArrive = addDays(startOfDay(new Date()), leadDays);
  if (needDate < minArrive) return minArrive;
  return startOfDay(needDate);
}

/**
 * Default child offset before parent start: child estimate + staging buffer (minutes).
 */
export function defaultChildOffsetMinutes(
  childEstimateMinutes: number,
  stagingBufferMinutes = DEFAULT_STAGING_BUFFER_MINUTES
): number {
  return Math.max(0, childEstimateMinutes) + Math.max(0, stagingBufferMinutes);
}

/** Days between for UI (calendar days). */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.abs(differenceInCalendarDays(a, b));
}

/**
 * Reschedule every open WO that lacks a planned window (and optionally weak risk).
 */
export async function bulkRescheduleOpenWorkOrders(params?: {
  userId?: string;
  onlyUnscheduled?: boolean;
  mode?: ScheduleMode;
}): Promise<{ count: number; numbers: string[] }> {
  const onlyUnscheduled = params?.onlyUnscheduled !== false;
  const wos = await prisma.workOrder.findMany({
    where: {
      status: {
        notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"],
      },
      ...(onlyUnscheduled
        ? {
            OR: [
              { plannedStart: null },
              { plannedEnd: null },
              { scheduleRisk: { in: ["NO_DATES", "NO_ESTIMATE"] } },
            ],
          }
        : {}),
    },
    select: { id: true, number: true, dueDate: true },
    take: 200,
  });

  const numbers: string[] = [];
  for (const wo of wos) {
    try {
      const mode: ScheduleMode =
        params?.mode || (wo.dueDate ? "BACK" : "FORWARD");
      await rescheduleWorkOrder({
        workOrderId: wo.id,
        mode,
        userId: params?.userId,
      });
      numbers.push(wo.number);
    } catch {
      // skip bad rows
    }
  }
  return { count: numbers.length, numbers };
}
