/**
 * Timesheets — pay-period based time capture.
 *
 * Accounting defines the period shape (weekly / biweekly / semimonthly),
 * PTO & sick accrual, and company holidays in PayrollPolicy. Timesheets
 * only exist for periods that have started; time can't be keyed ahead of
 * today except PTO / holiday / sick inside the current period. Job scans
 * auto-open the right timesheet, approved PTO materializes into the
 * period it lands in, and approved sheets flow to accounting for payroll
 * processing (payroll accrual journal entry).
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { userHasPermission } from "@/lib/auth";
import {
  computeFederalWithholding,
  computeFica,
  PERIODS_PER_YEAR,
  type FilingStatus,
} from "@/lib/services/tax-tables";

const DEFAULT_LABOR_RATE = 65; // $/hr for shop/overhead time without a rate

async function laborRateForUser(userId: string): Promise<number> {
  try {
    const { resolveUserLaborRate } = await import("@/lib/services/budgets");
    return resolveUserLaborRate(userId);
  } catch {
    return DEFAULT_LABOR_RATE;
  }
}

async function budgetIdForChargeCode(
  code: string | null | undefined
): Promise<string | null> {
  if (!code) return null;
  try {
    const { findBudgetByChargeCode } = await import("@/lib/services/budgets");
    const b = await findBudgetByChargeCode(code);
    return b?.id || null;
  } catch {
    return null;
  }
}

export type Holiday = { date: string; name: string };

export async function getPayrollPolicy() {
  return prisma.payrollPolicy.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export function parseHolidays(policy: { holidays: string | null }): Holiday[] {
  if (!policy.holidays) return [];
  try {
    const arr = JSON.parse(policy.holidays);
    if (!Array.isArray(arr)) return [];
    // Dedupe by date — the picker can save the same day twice
    const seen = new Set<string>();
    return arr.filter((h) => {
      if (!h || typeof h.date !== "string") return false;
      if (seen.has(h.date)) return false;
      seen.add(h.date);
      return true;
    });
  } catch {
    return [];
  }
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Period bounds [start, end] (both midnight-inclusive dates) for a date. */
export function periodForDate(
  policy: {
    timesheetFrequency: string;
    weekStartsOn: number;
    periodAnchor: Date;
  },
  date: Date
): { periodStart: Date; periodEnd: Date } {
  const d = startOfDay(date);

  if (policy.timesheetFrequency === "SEMIMONTHLY") {
    if (d.getDate() <= 15) {
      return {
        periodStart: new Date(d.getFullYear(), d.getMonth(), 1),
        periodEnd: new Date(d.getFullYear(), d.getMonth(), 15),
      };
    }
    return {
      periodStart: new Date(d.getFullYear(), d.getMonth(), 16),
      periodEnd: new Date(d.getFullYear(), d.getMonth() + 1, 0),
    };
  }

  // Weekly / biweekly: walk back to the week start
  const dow = d.getDay();
  const back = (dow - policy.weekStartsOn + 7) % 7;
  let start = new Date(d.getTime() - back * DAY);

  if (policy.timesheetFrequency === "BIWEEKLY") {
    // Anchor parity: which 14-day block does this week fall in?
    const anchor = startOfDay(policy.periodAnchor);
    const anchorDow = anchor.getDay();
    const anchorBack = (anchorDow - policy.weekStartsOn + 7) % 7;
    const anchorStart = new Date(anchor.getTime() - anchorBack * DAY);
    const weeks = Math.floor((start.getTime() - anchorStart.getTime()) / (7 * DAY));
    if (((weeks % 2) + 2) % 2 === 1) start = new Date(start.getTime() - 7 * DAY);
    return { periodStart: start, periodEnd: new Date(start.getTime() + 13 * DAY) };
  }

  return { periodStart: start, periodEnd: new Date(start.getTime() + 6 * DAY) };
}

/** All calendar days of a period (midnight dates). */
export function periodDays(periodStart: Date, periodEnd: Date): Date[] {
  const days: Date[] = [];
  for (
    let t = startOfDay(periodStart).getTime();
    t <= startOfDay(periodEnd).getTime();
    t += DAY
  ) {
    days.push(new Date(t));
  }
  return days;
}

/**
 * Get or create the timesheet covering `date` for a user.
 * Refuses future periods — sheets only exist for periods that started.
 * On creation, approved PTO and company holidays inside the period
 * materialize as entries automatically.
 */
export async function getOrCreateTimesheet(userId: string, date: Date) {
  const policy = await getPayrollPolicy();
  const { periodStart, periodEnd } = periodForDate(policy, date);
  if (periodStart.getTime() > Date.now()) {
    throw new Error(
      "That pay period hasn't started yet — timesheets open when the period begins"
    );
  }

  const existing = await prisma.timesheet.findUnique({
    where: { userId_periodStart: { userId, periodStart } },
  });
  if (existing) return existing;

  const sheet = await prisma.timesheet.create({
    data: { userId, periodStart, periodEnd },
  });

  // Materialize approved PTO overlapping this period
  const approvedPto = await prisma.ptoRequest.findMany({
    where: {
      userId,
      status: "APPROVED",
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
  });
  for (const pto of approvedPto) {
    await materializePtoEntries(sheet, pto);
  }

  // Materialize company holidays falling in the period (weekdays)
  const holidays = parseHolidays(policy).filter((h) => {
    const d = startOfDay(new Date(h.date));
    return (
      !Number.isNaN(d.getTime()) &&
      d >= periodStart &&
      d <= periodEnd &&
      d.getDay() !== 0 &&
      d.getDay() !== 6
    );
  });
  for (const h of holidays) {
    const d = startOfDay(new Date(h.date));
    const already = await prisma.timeEntry.findFirst({
      where: { timesheetId: sheet.id, type: "HOLIDAY", date: d },
    });
    if (already) continue;
    await prisma.timeEntry.create({
      data: {
        userId,
        timesheetId: sheet.id,
        date: d,
        hours: 8,
        type: "HOLIDAY",
        description: h.name,
        status: "DRAFT",
        laborRate: DEFAULT_LABOR_RATE,
      },
    });
  }

  return prisma.timesheet.findUniqueOrThrow({ where: { id: sheet.id } });
}

/** Spread an approved PTO request across the weekdays it covers. */
async function materializePtoEntries(
  sheet: { id: string; userId: string; periodStart: Date; periodEnd: Date },
  pto: {
    id: string;
    type: string;
    startDate: Date;
    endDate: Date;
    hours: number;
    reason: string | null;
  }
) {
  const from = new Date(
    Math.max(startOfDay(pto.startDate).getTime(), sheet.periodStart.getTime())
  );
  const to = new Date(
    Math.min(startOfDay(pto.endDate).getTime(), sheet.periodEnd.getTime())
  );
  const weekdays: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    if (d.getDay() !== 0 && d.getDay() !== 6) weekdays.push(d);
  }
  if (weekdays.length === 0) return;

  // Total request hours spread evenly across ALL its weekdays; this
  // period only gets its share.
  const allDays: Date[] = [];
  for (
    let t = startOfDay(pto.startDate).getTime();
    t <= startOfDay(pto.endDate).getTime();
    t += DAY
  ) {
    const d = new Date(t);
    if (d.getDay() !== 0 && d.getDay() !== 6) allDays.push(d);
  }
  const perDay = allDays.length > 0 ? pto.hours / allDays.length : 8;

  for (const d of weekdays) {
    const already = await prisma.timeEntry.findFirst({
      where: { timesheetId: sheet.id, date: d, type: pto.type },
    });
    if (already) continue;
    await prisma.timeEntry.create({
      data: {
        userId: sheet.userId,
        timesheetId: sheet.id,
        date: d,
        hours: Math.round(perDay * 100) / 100,
        type: pto.type,
        description: pto.reason || `${pto.type} (approved request)`,
        status: "DRAFT",
        laborRate: DEFAULT_LABOR_RATE,
      },
    });
  }
}

/**
 * Called when a PTO request is approved: if the covering timesheet(s)
 * already exist, drop the entries in now; otherwise they materialize
 * when the period's sheet is opened.
 */
export async function pushApprovedPtoToTimesheets(ptoId: string) {
  const pto = await prisma.ptoRequest.findUnique({ where: { id: ptoId } });
  if (!pto || pto.status !== "APPROVED") return;
  const sheets = await prisma.timesheet.findMany({
    where: {
      userId: pto.userId,
      status: { in: ["OPEN", "REJECTED"] },
      periodStart: { lte: pto.endDate },
      periodEnd: { gte: pto.startDate },
    },
  });
  for (const sheet of sheets) {
    await materializePtoEntries(sheet, pto);
  }
}

const NON_WORK_TYPES = ["PTO", "SICK", "HOLIDAY"];

/** Key a manual entry (overhead, sick day, holiday, or direct charge). */
export async function addTimesheetEntry(params: {
  userId: string;
  date: Date;
  hours: number;
  type: string;
  workOrderId?: string | null;
  projectId?: string | null;
  description?: string | null;
}) {
  const date = startOfDay(params.date);
  const today = startOfDay(new Date());
  const type = params.type.toUpperCase();

  if (date > today && !NON_WORK_TYPES.includes(type)) {
    throw new Error(
      "Work time can't be entered ahead of schedule — only PTO, sick, or holiday time may be future-dated"
    );
  }
  if (params.hours <= 0 || params.hours > 24) {
    throw new Error("Hours must be between 0 and 24");
  }

  // getOrCreateTimesheet enforces "period has started" — future PTO in
  // the current period is fine, next period isn't open yet.
  const sheet = await getOrCreateTimesheet(params.userId, date);
  if (!["OPEN", "REJECTED"].includes(sheet.status)) {
    throw new Error(`Timesheet is ${sheet.status} — it can no longer be edited`);
  }

  const entry = await prisma.timeEntry.create({
    data: {
      userId: params.userId,
      timesheetId: sheet.id,
      date,
      hours: params.hours,
      type,
      workOrderId: params.workOrderId || null,
      projectId: params.projectId || null,
      description: params.description?.trim() || null,
      status: "DRAFT",
      laborRate: DEFAULT_LABOR_RATE,
    },
  });
  return { sheet, entry };
}

/** Attach a scan-generated time entry to the right (auto-opened) sheet. */
export async function attachEntryToTimesheet(entryId: string) {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.timesheetId) return entry;
  try {
    const sheet = await getOrCreateTimesheet(entry.userId, entry.date);
    if (["OPEN", "REJECTED"].includes(sheet.status)) {
      return prisma.timeEntry.update({
        where: { id: entry.id },
        data: { timesheetId: sheet.id },
      });
    }
  } catch {
    // Period not open (edge) — leave entry unattached rather than fail the scan.
  }
  return entry;
}

export async function removeTimesheetEntry(params: {
  entryId: string;
  userId: string;
}) {
  const entry = await prisma.timeEntry.findUniqueOrThrow({
    where: { id: params.entryId },
    include: { timesheet: true },
  });
  if (entry.userId !== params.userId) {
    throw new Error("You can only edit your own timesheet");
  }
  if (entry.timesheet && !["OPEN", "REJECTED"].includes(entry.timesheet.status)) {
    throw new Error("Timesheet is locked");
  }
  await prisma.timeEntry.delete({ where: { id: entry.id } });
}

export async function submitTimesheet(params: { id: string; userId: string }) {
  const sheet = await prisma.timesheet.findUniqueOrThrow({
    where: { id: params.id },
    include: { entries: true },
  });
  if (sheet.userId !== params.userId) {
    throw new Error("You can only submit your own timesheet");
  }
  if (!["OPEN", "REJECTED"].includes(sheet.status)) {
    throw new Error(`Timesheet already ${sheet.status}`);
  }
  // Timecards only route to approvers once the pay period has ended — no
  // partial-period approvals. The whole period's time is entered first.
  if (startOfDay(new Date()) < startOfDay(sheet.periodEnd)) {
    throw new Error(
      `This pay period ends ${sheet.periodEnd.toISOString().slice(0, 10)} — you can submit for approval on or after that date.`
    );
  }
  if (sheet.entries.length === 0) {
    throw new Error("Add at least one entry before submitting");
  }
  {
    const policy = await getPayrollPolicy();
    const dayTotals = new Map<string, number>();
    for (const e of sheet.entries) {
      const k = e.date.toISOString().slice(0, 10);
      dayTotals.set(k, (dayTotals.get(k) || 0) + e.hours);
    }
    for (const [day, total] of dayTotals) {
      if (total > policy.maxHoursPerDay) {
        throw new Error(
          `${day} has ${total}h — company policy caps a day at ${policy.maxHoursPerDay}h`
        );
      }
    }
  }
  await prisma.timeEntry.updateMany({
    where: { timesheetId: sheet.id },
    data: { status: "SUBMITTED" },
  });
  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  await buildApprovalBuckets(sheet.id);
  await logAudit({
    entityType: "Timesheet",
    entityId: sheet.id,
    action: "TIMESHEET_SUBMITTED",
    userId: params.userId,
    metadata: {
      hours: sheet.entries.reduce((s, e) => s + e.hours, 0),
    },
  });
  return updated;
}

/** Hour types that count as worked time for overtime math. */
const WORKED_TYPES = ["REGULAR", "OT", "OVERHEAD", "ENG_SCAN"];
const HR_TYPES = ["PTO", "SICK", "HOLIDAY", "OVERHEAD"];

export type PayClassification = {
  regular: number;
  overtime: number;
  doubletime: number;
  nonWorked: number; // PTO / sick / holiday — paid straight
};

/**
 * Split a sheet's hours into regular / OT / double-OT per the payroll
 * policy: daily thresholds first, then weekly OT on whatever is still
 * classified regular. PTO/sick/holiday never generate overtime.
 */
export function classifyHours(
  policy: {
    otAfterDailyHours: number;
    dtAfterDailyHours: number;
    otAfterWeeklyHours: number;
  },
  entries: { date: Date; hours: number; type: string }[]
): PayClassification {
  const byDay = new Map<string, number>();
  let nonWorked = 0;
  for (const e of entries) {
    if (!WORKED_TYPES.includes(e.type)) {
      nonWorked += e.hours;
      continue;
    }
    const k = startOfDay(e.date).toISOString();
    byDay.set(k, (byDay.get(k) || 0) + e.hours);
  }
  let regular = 0;
  let overtime = 0;
  let doubletime = 0;
  for (const total of byDay.values()) {
    const dt = Math.max(0, total - policy.dtAfterDailyHours);
    const ot = Math.max(0, Math.min(total, policy.dtAfterDailyHours) - policy.otAfterDailyHours);
    doubletime += dt;
    overtime += ot;
    regular += total - dt - ot;
  }
  // Weekly OT: regular hours beyond the weekly threshold promote to OT
  if (regular > policy.otAfterWeeklyHours) {
    overtime += regular - policy.otAfterWeeklyHours;
    regular = policy.otAfterWeeklyHours;
  }
  return { regular, overtime, doubletime, nonWorked };
}

export type GridRow = {
  type: string;
  workOrderId: string | null;
  projectId: string | null;
  wbsElementId: string | null;
  engTaskId: string | null;
  /** Named overhead / indirect charge code (e.g. OH) */
  chargeCode: string | null;
  /** ISO date (yyyy-mm-dd) -> hours */
  hours: Record<string, number>;
};

/**
 * Save the whole timecard grid: DRAFT entries are replaced by the grid
 * contents. Enforces the daily cap and the no-future-work rule.
 */
export async function saveTimecardGrid(params: {
  userId: string;
  sheetId: string;
  rows: GridRow[];
}) {
  const [sheet, policy] = await Promise.all([
    prisma.timesheet.findUniqueOrThrow({ where: { id: params.sheetId } }),
    getPayrollPolicy(),
  ]);
  if (sheet.userId !== params.userId) {
    throw new Error("You can only edit your own timecard");
  }
  if (!["OPEN", "REJECTED"].includes(sheet.status)) {
    throw new Error(`Timecard is ${sheet.status} — it can no longer be edited`);
  }

  const today = startOfDay(new Date());
  const dayTotals = new Map<string, number>();
  const creates: {
    date: Date;
    hours: number;
    type: string;
    workOrderId: string | null;
    projectId: string | null;
    wbsElementId: string | null;
    engTaskId: string | null;
    chargeCode: string | null;
  }[] = [];

  for (const row of params.rows) {
    const type = row.type.toUpperCase();
    for (const [iso, raw] of Object.entries(row.hours)) {
      const hours = Number(raw);
      if (!hours || hours <= 0) continue;
      const date = startOfDay(new Date(iso + "T00:00:00"));
      if (Number.isNaN(date.getTime())) continue;
      if (date < sheet.periodStart || date > sheet.periodEnd) {
        throw new Error(`${iso} is outside this pay period`);
      }
      if (date > today && !NON_WORK_TYPES.includes(type)) {
        throw new Error(
          `Work time on ${iso} is in the future — only PTO / sick / holiday may be future-dated`
        );
      }
      dayTotals.set(iso, (dayTotals.get(iso) || 0) + hours);
      creates.push({
        date,
        hours,
        type,
        workOrderId: row.workOrderId || null,
        projectId: row.projectId || null,
        wbsElementId: row.wbsElementId || null,
        engTaskId: row.engTaskId || null,
        chargeCode: row.chargeCode || null,
      });
    }
  }
  for (const [iso, total] of dayTotals) {
    if (total > policy.maxHoursPerDay) {
      throw new Error(
        `${iso} has ${total}h — company policy caps a day at ${policy.maxHoursPerDay}h`
      );
    }
  }

  await prisma.timeEntry.deleteMany({
    where: { timesheetId: sheet.id, status: "DRAFT" },
  });
  const rate = await laborRateForUser(sheet.userId);
  for (const c of creates) {
    const budgetId = await budgetIdForChargeCode(c.chargeCode);
    await prisma.timeEntry.create({
      data: {
        userId: sheet.userId,
        timesheetId: sheet.id,
        status: "DRAFT",
        laborRate: rate,
        budgetId,
        ...c,
      },
    });
  }
  await logAudit({
    entityType: "Timesheet",
    entityId: sheet.id,
    action: "GRID_SAVED",
    userId: params.userId,
    metadata: { lines: creates.length },
  });
  return prisma.timesheet.findUniqueOrThrow({
    where: { id: sheet.id },
    include: { entries: true },
  });
}

/** Find who approves direct charges for a department. */
async function departmentManagerFor(
  department: string | null,
  employee: { managerId: string | null }
): Promise<string | null> {
  if (department) {
    // Case-insensitive: WOs/SOs may carry "PRODUCTION" while people
    // records say "Production" — both must route to the same manager.
    const managers = await prisma.user.findMany({
      where: { isActive: true, reports: { some: { isActive: true } } },
      select: { id: true, department: true },
    });
    const mgr = managers.find(
      (m) => (m.department || "").toLowerCase() === department.toLowerCase()
    );
    if (mgr) return mgr.id;
  }
  return employee.managerId;
}

/**
 * Build the routed approval buckets for a submitted sheet:
 * BUDGET (per enacted charge code) -> budget owner;
 * PROJECT (per project, no budget) -> PM;
 * DIRECT (per department) -> department manager;
 * HR (sick/holiday/PTO/overhead without budget) -> HR.
 *
 * A single period can produce multiple buckets when the worker charged
 * several budgets / projects / departments.
 */
async function buildApprovalBuckets(sheetId: string) {
  const sheet = await prisma.timesheet.findUniqueOrThrow({
    where: { id: sheetId },
    include: {
      user: { select: { id: true, managerId: true, department: true } },
      entries: {
        include: {
          workOrder: { select: { number: true, department: true } },
          project: {
            select: { id: true, number: true, projectManagerId: true },
          },
          budget: {
            select: {
              id: true,
              number: true,
              name: true,
              chargeCode: true,
              ownerId: true,
            },
          },
          engTask: {
            select: {
              number: true,
              discipline: true,
              project: {
                select: { id: true, number: true, projectManagerId: true },
              },
            },
          },
        },
      },
    },
  });
  await prisma.timesheetApproval.deleteMany({ where: { timesheetId: sheetId } });

  type Bucket = {
    category: string;
    refId: string | null;
    label: string;
    hours: number;
    approverId: string | null;
  };
  const buckets = new Map<string, Bucket>();
  const add = (key: string, b: Omit<Bucket, "hours">, hours: number) => {
    const cur = buckets.get(key);
    if (cur) cur.hours += hours;
    else buckets.set(key, { ...b, hours });
  };

  const hrApprover =
    (
      await prisma.user.findFirst({
        where: { isActive: true, role: "HR" },
        select: { id: true },
      })
    )?.id || sheet.user.managerId;

  // Resolve budget ids from charge codes when not already set
  for (const e of sheet.entries) {
    if (!e.budgetId && e.chargeCode) {
      const b = await budgetIdForChargeCode(e.chargeCode);
      if (b) {
        (e as { budgetId: string | null }).budgetId = b;
        const full = await prisma.budget.findUnique({
          where: { id: b },
          select: {
            id: true,
            number: true,
            name: true,
            chargeCode: true,
            ownerId: true,
          },
        });
        (e as { budget: typeof full }).budget = full;
      }
    }
  }

  for (const e of sheet.entries) {
    // Budget charge wins — owner approves that slice of the period
    if (e.budgetId && e.budget) {
      add(
        `B:${e.budgetId}`,
        {
          category: "BUDGET",
          refId: e.budgetId,
          label: `Budget ${e.budget.number}${e.budget.chargeCode ? ` · ${e.budget.chargeCode}` : ""} — ${e.budget.name}`,
          approverId: e.budget.ownerId || sheet.user.managerId,
        },
        e.hours
      );
      continue;
    }
    if (HR_TYPES.includes(e.type)) {
      add(
        "HR",
        {
          category: "HR",
          refId: null,
          label: "HR time (PTO / sick / holiday / overhead)",
          approverId: hrApprover,
        },
        e.hours
      );
    } else if (e.projectId && e.project) {
      add(
        `P:${e.projectId}`,
        {
          category: "PROJECT",
          refId: e.projectId,
          label: `Project ${e.project.number}`,
          approverId: e.project.projectManagerId || sheet.user.managerId,
        },
        e.hours
      );
    } else if (e.engTaskId && e.engTask) {
      const proj = e.engTask.project;
      if (proj) {
        add(
          `P:${proj.id}`,
          {
            category: "PROJECT",
            refId: proj.id,
            label: `Project ${proj.number}`,
            approverId: proj.projectManagerId || sheet.user.managerId,
          },
          e.hours
        );
      } else {
        const dept =
          e.engTask.discipline || sheet.user.department || "ENGINEERING";
        add(
          `D:${dept}`,
          {
            category: "DIRECT",
            refId: dept,
            label: `${dept} task time`,
            approverId: null,
          },
          e.hours
        );
      }
    } else {
      const dept =
        e.workOrder?.department || sheet.user.department || "GENERAL";
      add(
        `D:${dept}`,
        {
          category: "DIRECT",
          refId: dept,
          label: `${dept} direct charge${e.workOrder ? "s" : "s"}`,
          approverId: null,
        },
        e.hours
      );
    }
  }
  for (const [key, b] of buckets) {
    if (b.category === "DIRECT") {
      b.approverId = await departmentManagerFor(b.refId, sheet.user);
    }
    void key;
  }
  for (const b of buckets.values()) {
    await prisma.timesheetApproval.create({
      data: {
        timesheetId: sheetId,
        category: b.category,
        refId: b.refId,
        label: b.label,
        hours: Math.round(b.hours * 100) / 100,
        approverId: b.approverId,
      },
    });
  }
}

/** Finalize an all-buckets-approved sheet: cost out with OT multipliers. */
async function finalizeApprovedTimesheet(sheetId: string) {
  const [sheet, policy] = await Promise.all([
    prisma.timesheet.findUniqueOrThrow({
      where: { id: sheetId },
      include: { entries: true },
    }),
    getPayrollPolicy(),
  ]);
  const cls = classifyHours(policy, sheet.entries);
  const worked = cls.regular + cls.overtime + cls.doubletime;
  // Blend the OT premium across worked entries proportionally
  const blend =
    worked > 0
      ? (cls.regular +
          cls.overtime * policy.otMultiplier +
          cls.doubletime * policy.dtMultiplier) /
        worked
      : 1;
  const userRate = await laborRateForUser(sheet.userId);
  for (const e of sheet.entries) {
    const rate = e.laborRate || userRate || DEFAULT_LABOR_RATE;
    const mult = WORKED_TYPES.includes(e.type) ? blend : 1;
    let budgetId = e.budgetId;
    if (!budgetId && e.chargeCode) {
      budgetId = await budgetIdForChargeCode(e.chargeCode);
    }
    await prisma.timeEntry.update({
      where: { id: e.id },
      data: {
        status: "APPROVED",
        laborRate: rate,
        costAmount: Math.round(e.hours * rate * mult * 100) / 100,
        ...(budgetId ? { budgetId } : {}),
      },
    });
  }
  const updated = await prisma.timesheet.update({
    where: { id: sheetId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  // Roll approved labor into enacted budgets + accounting
  try {
    const { postTimesheetBudgetCharges } = await import(
      "@/lib/services/budgets"
    );
    await postTimesheetBudgetCharges(sheetId);
  } catch {
    /* non-fatal */
  }
  return updated;
}

/** Decide one routed approval bucket. */
export async function decideTimesheetApproval(params: {
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  approver: { id: string; role: string };
  notes?: string;
}) {
  const approval = await prisma.timesheetApproval.findUniqueOrThrow({
    where: { id: params.approvalId },
    include: { timesheet: true },
  });
  if (approval.status !== "PENDING") {
    throw new Error(`This bucket is already ${approval.status}`);
  }
  const isAssignee = approval.approverId === params.approver.id;
  const isAdmin =
    params.approver.role === "ADMIN" ||
    (await userHasPermission(params.approver.id, "hr.admin"));
  if (!isAssignee && !isAdmin) {
    throw new Error("This approval is routed to someone else");
  }

  await prisma.timesheetApproval.update({
    where: { id: approval.id },
    data: {
      status: params.decision,
      notes: params.notes?.trim() || null,
      decidedAt: new Date(),
      approverId: approval.approverId || params.approver.id,
    },
  });
  await logAudit({
    entityType: "Timesheet",
    entityId: approval.timesheetId,
    action: `BUCKET_${params.decision}`,
    userId: params.approver.id,
    metadata: { bucket: approval.label },
  });

  if (params.decision === "REJECTED") {
    await prisma.timeEntry.updateMany({
      where: { timesheetId: approval.timesheetId },
      data: { status: "DRAFT" },
    });
    return prisma.timesheet.update({
      where: { id: approval.timesheetId },
      data: {
        status: "REJECTED",
        notes: params.notes?.trim() || approval.timesheet.notes,
      },
    });
  }

  const remaining = await prisma.timesheetApproval.count({
    where: { timesheetId: approval.timesheetId, status: { not: "APPROVED" } },
  });
  if (remaining === 0) {
    return finalizeApprovedTimesheet(approval.timesheetId);
  }
  return approval.timesheet;
}

export type TimecardReviewItem = {
  timesheetId: string;
  employeeName: string;
  employeeTitle: string | null;
  department: string | null;
  periodStart: Date;
  periodEnd: Date;
  totalHours: number;
  myBuckets: { id: string; label: string; hours: number }[];
  myHours: number;
};

/**
 * A reviewer's timecard queue, grouped one row per submitted timesheet
 * (not per bucket) — the line-item list the approvals page renders.
 */
export async function getTimecardReviewQueue(user: {
  id: string;
  role: string;
}): Promise<TimecardReviewItem[]> {
  const isHrAdmin =
    user.role === "ADMIN" || (await userHasPermission(user.id, "hr.admin"));

  const buckets = await prisma.timesheetApproval.findMany({
    where: {
      status: "PENDING",
      timesheet: { status: "SUBMITTED" },
      ...(isHrAdmin ? {} : { approverId: user.id }),
    },
    include: {
      timesheet: {
        include: {
          user: { select: { name: true, title: true, department: true } },
          entries: { select: { hours: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const bySheet = new Map<string, TimecardReviewItem>();
  for (const b of buckets) {
    let item = bySheet.get(b.timesheetId);
    if (!item) {
      item = {
        timesheetId: b.timesheetId,
        employeeName: b.timesheet.user.name,
        employeeTitle: b.timesheet.user.title,
        department: b.timesheet.user.department,
        periodStart: b.timesheet.periodStart,
        periodEnd: b.timesheet.periodEnd,
        totalHours: b.timesheet.entries.reduce((s, e) => s + e.hours, 0),
        myBuckets: [],
        myHours: 0,
      };
      bySheet.set(b.timesheetId, item);
    }
    item.myBuckets.push({ id: b.id, label: b.label, hours: b.hours });
    item.myHours += b.hours;
  }
  return [...bySheet.values()];
}

/**
 * Decide every bucket on a timesheet that is routed to this reviewer,
 * in one shot. Returns how many timecards remain in the reviewer's
 * queue afterward (so the UI can celebrate an empty queue).
 */
export async function decideReviewerBucketsForTimesheet(params: {
  timesheetId: string;
  decision: "APPROVED" | "REJECTED";
  approver: { id: string; role: string };
  notes?: string;
}): Promise<{ remaining: number }> {
  if (params.decision === "REJECTED" && !params.notes?.trim()) {
    throw new Error("A rejection reason is required.");
  }
  const isHrAdmin =
    params.approver.role === "ADMIN" ||
    (await userHasPermission(params.approver.id, "hr.admin"));

  const myBuckets = await prisma.timesheetApproval.findMany({
    where: {
      timesheetId: params.timesheetId,
      status: "PENDING",
      ...(isHrAdmin ? {} : { approverId: params.approver.id }),
    },
    select: { id: true },
  });

  for (const b of myBuckets) {
    await decideTimesheetApproval({
      approvalId: b.id,
      decision: params.decision,
      approver: params.approver,
      notes: params.notes,
    });
    // A rejection rejects the whole sheet; stop after the first.
    if (params.decision === "REJECTED") break;
  }

  const queue = await getTimecardReviewQueue(params.approver);
  return { remaining: queue.length };
}

/** Accounting: process an approved sheet for payroll (accrual JE). */
export async function processTimesheet(params: {
  id: string;
  processor: { id: string; role: string };
}) {
  const ok = await userHasPermission(params.processor.id, "accounting.journal.post");
  if (!ok) throw new Error("Payroll processing requires accounting authority");

  const sheet = await prisma.timesheet.findUniqueOrThrow({
    where: { id: params.id },
    include: { entries: true, user: true },
  });
  if (sheet.status !== "APPROVED") {
    throw new Error(`Timesheet is ${sheet.status}, not ready for payroll`);
  }

  // Entries were costed with the blended OT premium at approval time
  const amount = sheet.entries.reduce(
    (s, e) =>
      s + (e.costAmount || e.hours * (e.laborRate || DEFAULT_LABOR_RATE)),
    0
  );

  // Federal withholding via the IRS percentage method (Pub 15-T) from
  // the employee's W-4 profile; FICA with the SS wage-base cap and
  // Additional Medicare from YTD gross; state stays a flat percentage.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const gross = r2(amount);
  const taxYear = sheet.periodEnd.getFullYear();
  const policy = await getPayrollPolicy();
  const periodsPerYear = PERIODS_PER_YEAR[policy.timesheetFrequency] || 52;
  const ytdAgg = await prisma.timesheet.aggregate({
    where: {
      userId: sheet.userId,
      status: "PROCESSED",
      id: { not: sheet.id },
      periodEnd: {
        gte: new Date(taxYear, 0, 1),
        lte: sheet.periodEnd,
      },
    },
    _sum: { grossPay: true },
  });
  const ytdGrossBefore = ytdAgg._sum.grossPay || 0;

  const fedWithheld = computeFederalWithholding({
    grossForPeriod: gross,
    periodsPerYear,
    filingStatus: (sheet.user.filingStatus as FilingStatus) || "SINGLE",
    dependentCredits: sheet.user.dependentCredits || 0,
    extraPerPeriod: sheet.user.extraWithholding || 0,
    year: taxYear,
  });
  const stateWithheld = r2(gross * (sheet.user.stateWithholdingPct ?? 0.04));
  const fica = computeFica({
    grossForPeriod: gross,
    ytdGrossBefore,
    year: taxYear,
  });
  const ficaEmployee = fica.employeeTotal;
  const ficaEmployer = fica.employerTotal;
  const netPay = r2(gross - fedWithheld - stateWithheld - ficaEmployee);

  let journalEntryId: string | null = null;
  if (gross > 0) {
    const { postJournal } = await import("@/lib/services/gaap");
    const [wages, taxExpense, fedPayable, statePayable, ficaPayable, wagesPayable] =
      await Promise.all([
        ensurePayrollAccount("6000", "Salaries & Wages", "EXPENSE"),
        ensurePayrollAccount("6010", "Payroll Tax Expense", "EXPENSE"),
        ensurePayrollAccount("2200", "Federal Withholding Payable", "LIABILITY"),
        ensurePayrollAccount("2210", "State Withholding Payable", "LIABILITY"),
        ensurePayrollAccount("2220", "FICA Payable", "LIABILITY"),
        ensurePayrollAccount("2110", "Wages Payable", "LIABILITY"),
      ]);
    const period = `${sheet.periodStart.toISOString().slice(0, 10)} → ${sheet.periodEnd.toISOString().slice(0, 10)}`;
    const je = await postJournal({
      description: `Payroll — ${sheet.user.name} ${period}`,
      source: "PAYROLL",
      sourceId: sheet.id,
      createdById: params.processor.id,
      lines: [
        { accountId: wages.id, debit: gross, memo: "Gross wages" },
        { accountId: taxExpense.id, debit: ficaEmployer, memo: "Employer FICA match" },
        { accountId: fedPayable.id, credit: fedWithheld, memo: "Federal income tax withheld" },
        { accountId: statePayable.id, credit: stateWithheld, memo: "State income tax withheld" },
        { accountId: ficaPayable.id, credit: r2(ficaEmployee + ficaEmployer), memo: "FICA (employee + employer)" },
        { accountId: wagesPayable.id, credit: netPay, memo: "Net pay due employee" },
      ].filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0),
    });
    journalEntryId = je.id;
  }

  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: {
      status: "PROCESSED",
      processedById: params.processor.id,
      processedAt: new Date(),
      journalEntryId,
      grossPay: gross,
      fedWithheld,
      stateWithheld,
      ficaEmployee,
      ficaEmployer,
      netPay,
    },
  });
  await logAudit({
    entityType: "Timesheet",
    entityId: sheet.id,
    action: "TIMESHEET_PROCESSED",
    userId: params.processor.id,
    metadata: { gross, netPay, journalEntryId },
  });
  return updated;
}

/** Statutory FICA rate (Social Security + Medicare), each side. */
export const FICA_RATE = 0.0765;

/** Find a payroll GL account by code, creating it if the chart lacks it. */
async function ensurePayrollAccount(code: string, name: string, type: string) {
  const existing = await prisma.account.findFirst({ where: { code } });
  if (existing) return existing;
  return prisma.account.create({
    data: { code, name, type, subtype: "PAYROLL" },
  });
}

/**
 * Printable pay-stub data for a processed timesheet: period breakdown as
 * captured at processing time plus year-to-date totals across the
 * employee's processed sheets.
 */
export async function getPayStub(timesheetId: string) {
  const sheet = await prisma.timesheet.findUnique({
    where: { id: timesheetId },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, department: true, title: true,
          stateWithholdingPct: true, filingStatus: true,
          dependentCredits: true, extraWithholding: true,
        },
      },
      entries: { select: { hours: true, type: true } },
    },
  });
  if (!sheet || sheet.status !== "PROCESSED") return null;

  const yearStart = new Date(sheet.periodEnd.getFullYear(), 0, 1);
  const ytdSheets = await prisma.timesheet.findMany({
    where: {
      userId: sheet.userId,
      status: "PROCESSED",
      periodEnd: { gte: yearStart, lte: sheet.periodEnd },
    },
    select: {
      grossPay: true, fedWithheld: true, stateWithheld: true,
      ficaEmployee: true, netPay: true,
    },
  });
  const ytd = (k: "grossPay" | "fedWithheld" | "stateWithheld" | "ficaEmployee" | "netPay") =>
    Math.round(ytdSheets.reduce((s, t) => s + (t[k] || 0), 0) * 100) / 100;

  return {
    sheet,
    hours: sheet.entries.reduce((s, e) => s + e.hours, 0),
    current: {
      gross: sheet.grossPay || 0,
      fed: sheet.fedWithheld || 0,
      state: sheet.stateWithheld || 0,
      fica: sheet.ficaEmployee || 0,
      net: sheet.netPay || 0,
    },
    ytd: {
      gross: ytd("grossPay"),
      fed: ytd("fedWithheld"),
      state: ytd("stateWithheld"),
      fica: ytd("ficaEmployee"),
      net: ytd("netPay"),
    },
  };
}

/**
 * Payroll module data: approved timesheets ready to run, plus the most
 * recent processed runs. This is where payroll happens now — not on any
 * individual employee or timesheet page.
 */
export async function getPayrollRun() {
  const [ready, recent] = await Promise.all([
    prisma.timesheet.findMany({
      where: { status: "APPROVED" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            department: true,
            stateWithholdingPct: true,
            filingStatus: true,
            dependentCredits: true,
            extraWithholding: true,
          },
        },
        entries: { select: { hours: true, costAmount: true, laborRate: true, type: true } },
      },
      orderBy: { periodEnd: "asc" },
    }),
    prisma.timesheet.findMany({
      where: { status: "PROCESSED" },
      include: { user: { select: { name: true } } },
      orderBy: { processedAt: "desc" },
      take: 25,
    }),
  ]);

  const cost = (
    entries: { hours: number; costAmount: number; laborRate: number }[]
  ) =>
    entries.reduce(
      (s, e) => s + (e.costAmount || e.hours * (e.laborRate || DEFAULT_LABOR_RATE)),
      0
    );

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const policy = await getPayrollPolicy();
  const periodsPerYear = PERIODS_PER_YEAR[policy.timesheetFrequency] || 52;
  const readyRows = await Promise.all(
    ready.map(async (t) => {
      const grossPay = r2(cost(t.entries));
      // Preview of what processing will withhold, at today's rates
      const taxYear = t.periodEnd.getFullYear();
      const ytdAgg = await prisma.timesheet.aggregate({
        where: {
          userId: t.user.id,
          status: "PROCESSED",
          periodEnd: { gte: new Date(taxYear, 0, 1), lte: t.periodEnd },
        },
        _sum: { grossPay: true },
      });
      const fed = computeFederalWithholding({
        grossForPeriod: grossPay,
        periodsPerYear,
        filingStatus: (t.user.filingStatus as FilingStatus) || "SINGLE",
        dependentCredits: t.user.dependentCredits || 0,
        extraPerPeriod: t.user.extraWithholding || 0,
        year: taxYear,
      });
      const fica = computeFica({
        grossForPeriod: grossPay,
        ytdGrossBefore: ytdAgg._sum.grossPay || 0,
        year: taxYear,
      });
      const netPay = r2(
        grossPay -
          fed -
          r2(grossPay * (t.user.stateWithholdingPct ?? 0.04)) -
          fica.employeeTotal
      );
      return {
        id: t.id,
        employee: t.user.name,
        department: t.user.department,
        periodStart: t.periodStart,
        periodEnd: t.periodEnd,
        hours: t.entries.reduce((s, e) => s + e.hours, 0),
        grossPay,
        netPay,
      };
    })
  );

  return {
    ready: readyRows,
    recent: recent.map((t) => ({
      id: t.id,
      employee: t.user.name,
      periodStart: t.periodStart,
      periodEnd: t.periodEnd,
      processedAt: t.processedAt,
      journalEntryId: t.journalEntryId,
      grossPay: t.grossPay,
      netPay: t.netPay,
    })),
    totalReadyGross: r2(readyRows.reduce((s, r) => s + r.grossPay, 0)),
    totalReadyNet: r2(readyRows.reduce((s, r) => s + r.netPay, 0)),
  };
}

/** Process every approved timesheet in one payroll run. */
export async function runPayroll(processor: { id: string; role: string }) {
  const ok = await userHasPermission(processor.id, "accounting.journal.post");
  if (!ok) throw new Error("Payroll processing requires accounting authority");
  const ready = await prisma.timesheet.findMany({
    where: { status: "APPROVED" },
    select: { id: true },
  });
  let processed = 0;
  for (const t of ready) {
    await processTimesheet({ id: t.id, processor });
    processed++;
  }
  return { processed };
}

export async function getTimesheetDetail(id: string) {
  return prisma.timesheet.findUnique({
    where: { id },
    include: {
      user: { include: { manager: { select: { name: true } } } },
      entries: {
        orderBy: { date: "asc" },
        include: {
          workOrder: { select: { id: true, number: true } },
          project: { select: { id: true, number: true } },
          wbsElement: { select: { id: true, code: true } },
          engTask: { select: { id: true, number: true, name: true } },
        },
      },
      approvals: {
        include: { approver: { select: { name: true } } },
        orderBy: { category: "asc" },
      },
    },
  });
}

export async function listMyTimesheets(userId: string) {
  return prisma.timesheet.findMany({
    where: { userId },
    orderBy: { periodStart: "desc" },
    include: { entries: true },
    take: 12,
  });
}

/**
 * PTO / sick balances for the current year: accrual per the payroll
 * policy minus approved usage, with pending requests reserved.
 */
export async function getPtoBalances(userId: string) {
  const policy = await getPayrollPolicy();
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const elapsedDays = Math.floor(
    (startOfDay(now).getTime() - yearStart.getTime()) / DAY
  );

  let periodsElapsed: number;
  switch (policy.timesheetFrequency) {
    case "BIWEEKLY":
      periodsElapsed = Math.floor(elapsedDays / 14);
      break;
    case "SEMIMONTHLY":
      periodsElapsed = now.getMonth() * 2 + (now.getDate() > 15 ? 1 : 0);
      break;
    default: // WEEKLY
      periodsElapsed = Math.floor(elapsedDays / 7);
  }

  const requests = await prisma.ptoRequest.findMany({
    where: { userId, startDate: { gte: yearStart } },
  });
  const sum = (type: string, statuses: string[]) =>
    requests
      .filter((r) => r.type === type && statuses.includes(r.status))
      .reduce((s, r) => s + r.hours, 0);

  const ptoAccrued = periodsElapsed * policy.ptoAccrualHoursPerPeriod;
  const ptoUsed = sum("PTO", ["APPROVED"]);
  const ptoPending = sum("PTO", ["PENDING"]);
  const sickUsed = sum("SICK", ["APPROVED"]);
  const sickPending = sum("SICK", ["PENDING"]);

  return {
    pto: {
      accrued: Math.round(ptoAccrued * 10) / 10,
      used: ptoUsed,
      pending: ptoPending,
      available: Math.round((ptoAccrued - ptoUsed - ptoPending) * 10) / 10,
    },
    sick: {
      granted: policy.sickHoursPerYear,
      used: sickUsed,
      pending: sickPending,
      available:
        Math.round((policy.sickHoursPerYear - sickUsed - sickPending) * 10) /
        10,
    },
  };
}
