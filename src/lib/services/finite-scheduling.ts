/**
 * Finite-capacity sequencing.
 *
 * The existing planner is infinite-capacity: it computes load against capacity
 * and raises an alert when load exceeds it, but every job still gets whatever
 * dates it asked for. That answers "are we overloaded" and never answers "so
 * what actually ships late". This module does the second half — it lays jobs
 * into real capacity, one work centre at a time, and reports the finish dates
 * that fall out.
 *
 * The defining invariant is that a work centre never has more minutes assigned
 * on a day than it has minutes in that day. Everything else follows from it:
 * work that does not fit rolls into the next working day, a job longer than a
 * day spans days, and a queue that cannot fit inside the horizon reports as
 * unschedulable rather than silently compressing.
 *
 * The dispatch rule is a real choice, not a detail. Earliest due date minimises
 * how late the latest job is. Shortest processing time minimises average flow
 * time and will happily starve a big job. Choosing one is choosing which
 * failure you prefer, so the rule is explicit and the comparison is available.
 */

import { prisma } from "@/lib/db";

export const DISPATCH_RULES = ["EDD", "SPT", "LPT", "FIFO", "CRITICAL_RATIO"] as const;
export type DispatchRule = (typeof DISPATCH_RULES)[number];

export const RULE_LABELS: Record<DispatchRule, string> = {
  EDD: "Earliest due date — minimises worst-case lateness",
  SPT: "Shortest processing time — minimises average flow, starves big jobs",
  LPT: "Longest processing time — clears the big rocks first",
  FIFO: "First in, first out — fair, ignores dates",
  CRITICAL_RATIO: "Critical ratio — time remaining over work remaining",
};

export type SchedJob = {
  id: string;
  label: string;
  workCenter: string;
  /** Standard minutes of work. */
  minutes: number;
  dueDate: Date;
  /** Not startable before this. Defaults to the schedule start. */
  releaseDate?: Date | null;
  sequence?: number;
};

export type SchedCenter = {
  code: string;
  /** Usable minutes per working day, after efficiency and staffing. */
  minutesPerDay: number;
};

export type ScheduledJob = {
  jobId: string;
  label: string;
  workCenter: string;
  minutes: number;
  dueDate: Date;
  start: Date;
  finish: Date;
  /** Working days the job occupies, in order. */
  days: { date: Date; minutes: number }[];
  /** Positive means late. */
  latenessDays: number;
  isLate: boolean;
};

export type ScheduleResult = {
  scheduled: ScheduledJob[];
  /** Jobs that did not fit inside the horizon. */
  unschedulable: { jobId: string; label: string; reason: string }[];
  lateCount: number;
  maxLatenessDays: number;
  averageLatenessDays: number;
  utilisation: {
    workCenter: string;
    assignedMinutes: number;
    availableMinutes: number;
    pct: number;
  }[];
};

const DAY_MS = 86400000;

export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days between two dates, positive when a is after b. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDayUtc(a).getTime() - startOfDayUtc(b).getTime()) / DAY_MS);
}

export function sortByRule(
  jobs: SchedJob[],
  rule: DispatchRule,
  now: Date
): SchedJob[] {
  const copy = [...jobs];
  switch (rule) {
    case "EDD":
      return copy.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    case "SPT":
      return copy.sort((a, b) => a.minutes - b.minutes);
    case "LPT":
      return copy.sort((a, b) => b.minutes - a.minutes);
    case "CRITICAL_RATIO":
      // Days remaining over days of work remaining. Below 1 is already behind;
      // the smallest ratio is the most urgent.
      return copy.sort((a, b) => {
        const ratio = (j: SchedJob) => {
          const daysLeft = dayDiff(j.dueDate, now);
          const work = Math.max(j.minutes, 1) / 480;
          return daysLeft / work;
        };
        return ratio(a) - ratio(b);
      });
    case "FIFO":
    default:
      return copy.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }
}

/**
 * Lay jobs into capacity, work centre by work centre.
 *
 * Jobs are independent per centre — this schedules a queue, not a routed
 * network with precedence between operations. That is deliberate: sequencing
 * one centre correctly is the thing the planner cannot do today, and a
 * multi-operation critical path built on an unverified single-centre
 * sequencer would inherit its errors.
 */
export function sequence(
  jobs: SchedJob[],
  centers: SchedCenter[],
  opts: {
    start: Date;
    rule?: DispatchRule;
    horizonDays?: number;
    isWorkingDay?: (d: Date) => boolean;
  }
): ScheduleResult {
  const rule = opts.rule || "EDD";
  const horizon = opts.horizonDays ?? 180;
  const isWorking = opts.isWorkingDay || ((d: Date) => !isWeekend(d));
  const start = startOfDayUtc(opts.start);

  const centerByCode = new Map(centers.map((c) => [c.code, c]));
  const scheduled: ScheduledJob[] = [];
  const unschedulable: ScheduleResult["unschedulable"] = [];
  const assignedByCenter = new Map<string, number>();

  const byCenter = new Map<string, SchedJob[]>();
  for (const j of jobs) {
    const key = j.workCenter || "UNASSIGNED";
    if (!byCenter.has(key)) byCenter.set(key, []);
    byCenter.get(key)!.push(j);
  }

  for (const [code, queue] of byCenter) {
    const center = centerByCode.get(code);
    const perDay = center?.minutesPerDay ?? 0;

    if (!perDay || perDay <= 0) {
      for (const j of queue) {
        unschedulable.push({
          jobId: j.id,
          label: j.label,
          reason: center
            ? `${code} has no usable capacity`
            : `No work centre named ${code}`,
        });
      }
      continue;
    }

    const ordered = sortByRule(queue, rule, start);
    // Remaining minutes in each day for this centre. The map is the invariant:
    // nothing may be booked against a day beyond what it holds.
    const dayRemaining = new Map<number, number>();
    const remainingFor = (offset: number) => {
      if (!dayRemaining.has(offset)) dayRemaining.set(offset, perDay);
      return dayRemaining.get(offset)!;
    };

    for (const job of ordered) {
      let left = Math.max(0, job.minutes);
      const days: { date: Date; minutes: number }[] = [];

      const releaseOffset = job.releaseDate
        ? Math.max(0, dayDiff(job.releaseDate, start))
        : 0;

      let offset = releaseOffset;
      let guard = 0;
      let placedStart: Date | null = null;

      while (left > 0 && offset <= horizon && guard++ < horizon * 2 + 10) {
        const date = addDaysUtc(start, offset);
        if (!isWorking(date)) {
          offset++;
          continue;
        }
        const avail = remainingFor(offset);
        if (avail <= 0) {
          offset++;
          continue;
        }
        const take = Math.min(avail, left);
        dayRemaining.set(offset, avail - take);
        days.push({ date, minutes: take });
        if (!placedStart) placedStart = date;
        left -= take;
        if (left > 0) offset++;
      }

      if (left > 0 || !placedStart) {
        unschedulable.push({
          jobId: job.id,
          label: job.label,
          reason: `Does not fit within ${horizon} days at ${code}`,
        });
        continue;
      }

      const finish = days[days.length - 1].date;
      const lateness = dayDiff(finish, job.dueDate);
      assignedByCenter.set(
        code,
        (assignedByCenter.get(code) || 0) + job.minutes
      );

      scheduled.push({
        jobId: job.id,
        label: job.label,
        workCenter: code,
        minutes: job.minutes,
        dueDate: job.dueDate,
        start: placedStart,
        finish,
        days,
        latenessDays: lateness,
        isLate: lateness > 0,
      });
    }
  }

  const late = scheduled.filter((s) => s.isLate);
  const horizonWorkingDays = (() => {
    let n = 0;
    for (let i = 0; i <= horizon; i++) if (isWorking(addDaysUtc(start, i))) n++;
    return n;
  })();

  const utilisation = centers.map((c) => {
    const assigned = assignedByCenter.get(c.code) || 0;
    const available = c.minutesPerDay * horizonWorkingDays;
    return {
      workCenter: c.code,
      assignedMinutes: assigned,
      availableMinutes: available,
      pct: available ? (assigned / available) * 100 : 0,
    };
  });

  return {
    scheduled: scheduled.sort((a, b) => a.finish.getTime() - b.finish.getTime()),
    unschedulable,
    lateCount: late.length,
    maxLatenessDays: late.reduce((m, s) => Math.max(m, s.latenessDays), 0),
    averageLatenessDays: late.length
      ? late.reduce((s, j) => s + j.latenessDays, 0) / late.length
      : 0,
    utilisation,
  };
}

/**
 * What the infinite-capacity view claims, for contrast: every job takes its
 * own time from the start date and nothing ever queues behind anything else.
 * This is the answer the current planner effectively gives.
 */
export function infiniteCapacityView(
  jobs: SchedJob[],
  centers: SchedCenter[],
  start: Date
) {
  const centerByCode = new Map(centers.map((c) => [c.code, c]));
  return jobs.map((j) => {
    const perDay = centerByCode.get(j.workCenter)?.minutesPerDay || 480;
    const days = Math.max(1, Math.ceil(j.minutes / perDay));
    const finish = addDaysUtc(startOfDayUtc(start), days - 1);
    return {
      jobId: j.id,
      finish,
      latenessDays: dayDiff(finish, j.dueDate),
    };
  });
}

/** Run every rule so the trade-off between them is visible rather than assumed. */
export function compareRules(
  jobs: SchedJob[],
  centers: SchedCenter[],
  opts: { start: Date; horizonDays?: number; isWorkingDay?: (d: Date) => boolean }
) {
  return DISPATCH_RULES.map((rule) => {
    const r = sequence(jobs, centers, { ...opts, rule });
    return {
      rule,
      lateCount: r.lateCount,
      maxLatenessDays: r.maxLatenessDays,
      averageLatenessDays: r.averageLatenessDays,
      unschedulable: r.unschedulable.length,
    };
  });
}

// ---------------------------------------------------------------- persistence


/**
 * Build the job queue from open work orders.
 *
 * Minutes come from the routing when there is one, falling back to a nominal
 * day so a work order with no routing still consumes capacity instead of
 * appearing free. A work order with no due date is treated as due at the
 * horizon rather than as overdue, which would drag it to the front under EDD
 * and shove real commitments behind it.
 */
export async function buildQueueFromWorkOrders(opts?: {
  horizonDays?: number;
  defaultMinutes?: number;
}) {
  const horizon = opts?.horizonDays ?? 180;
  const fallback = opts?.defaultMinutes ?? 480;

  const [workOrders, centers] = await Promise.all([
    prisma.workOrder.findMany({
      where: { status: { in: ["PLANNED", "RELEASED", "IN_PROGRESS"] } },
      select: {
        id: true,
        number: true,
        dueDate: true,
        quantity: true,
        priority: true,
        createdAt: true,
        partId: true,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.workCenter.findMany({
      where: { isActive: true },
      select: {
        code: true,
        capacityHoursPerDay: true,
        efficiency: true,
      },
    }),
  ]);

  const partIds = [...new Set(workOrders.map((w) => w.partId).filter(Boolean))] as string[];
  const instructions = partIds.length
    ? await prisma.workInstruction.findMany({
        where: { partId: { in: partIds } },
        orderBy: { createdAt: "desc" },
        include: { steps: { select: { estimatedMinutes: true, workCenter: true } } },
      })
    : [];

  // One routing per part — the most recent wins.
  const routingByPart = new Map<string, { minutes: number; center: string }>();
  for (const wi of instructions) {
    if (!wi.partId || routingByPart.has(wi.partId)) continue;
    const minutes = wi.steps.reduce((s, st) => s + (st.estimatedMinutes || 0), 0);
    const center =
      wi.steps.find((st) => st.workCenter)?.workCenter || "UNASSIGNED";
    routingByPart.set(wi.partId, { minutes, center });
  }

  const now = new Date();
  const horizonDate = new Date(now.getTime() + horizon * DAY_MS);

  const jobs: SchedJob[] = workOrders.map((w, i) => {
    const routing = w.partId ? routingByPart.get(w.partId) : undefined;
    const perUnit = routing?.minutes || fallback;
    return {
      id: w.id,
      label: w.number,
      workCenter: routing?.center || "UNASSIGNED",
      minutes: Math.max(1, perUnit * Math.max(1, w.quantity)),
      dueDate: w.dueDate || horizonDate,
      sequence: i,
    };
  });

  const schedCenters: SchedCenter[] = centers.map((c) => ({
    code: c.code,
    minutesPerDay: Math.round(
      c.capacityHoursPerDay * 60 * (c.efficiency > 0 ? c.efficiency : 1)
    ),
  }));

  return { jobs, centers: schedCenters };
}
