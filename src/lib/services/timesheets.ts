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
import { canDecideFor } from "@/lib/services/hr";
import { userHasPermission } from "@/lib/auth";

const DEFAULT_LABOR_RATE = 65; // $/hr for shop/overhead time without a rate

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
    return Array.isArray(arr)
      ? arr.filter((h) => h && typeof h.date === "string")
      : [];
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
  if (sheet.entries.length === 0) {
    throw new Error("Add at least one entry before submitting");
  }
  await prisma.timeEntry.updateMany({
    where: { timesheetId: sheet.id },
    data: { status: "SUBMITTED" },
  });
  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
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

export async function decideTimesheet(params: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  approver: { id: string; role: string };
  notes?: string;
}) {
  const sheet = await prisma.timesheet.findUniqueOrThrow({
    where: { id: params.id },
    include: { entries: true },
  });
  if (sheet.status !== "SUBMITTED") {
    throw new Error(`Timesheet is ${sheet.status}, not awaiting approval`);
  }
  const ok = await canDecideFor(params.approver, sheet.userId, "hr.time.decide");
  if (!ok) throw new Error("Not authorized to decide this timesheet");

  if (params.decision === "APPROVED") {
    // Labor cost posts on approval (default rate when none was set)
    for (const e of sheet.entries) {
      const rate = e.laborRate || DEFAULT_LABOR_RATE;
      await prisma.timeEntry.update({
        where: { id: e.id },
        data: {
          status: "APPROVED",
          laborRate: rate,
          costAmount: e.hours * rate,
        },
      });
    }
  } else {
    await prisma.timeEntry.updateMany({
      where: { timesheetId: sheet.id },
      data: { status: "DRAFT" },
    });
  }
  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: {
      status: params.decision,
      approvedById: params.approver.id,
      approvedAt: params.decision === "APPROVED" ? new Date() : null,
      notes: params.notes?.trim() || sheet.notes,
    },
  });
  await logAudit({
    entityType: "Timesheet",
    entityId: sheet.id,
    action: `TIMESHEET_${params.decision}`,
    userId: params.approver.id,
  });
  return updated;
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

  const amount = sheet.entries.reduce(
    (s, e) => s + e.hours * (e.laborRate || DEFAULT_LABOR_RATE),
    0
  );
  let journalEntryId: string | null = null;
  if (amount > 0) {
    const [wages, accrued] = await Promise.all([
      prisma.account.findFirst({ where: { code: "6000" } }),
      prisma.account.findFirst({ where: { code: "2100" } }),
    ]);
    if (wages && accrued) {
      const { postJournal } = await import("@/lib/services/gaap");
      const je = await postJournal({
        description: `Payroll accrual — ${sheet.user.name} ${sheet.periodStart.toISOString().slice(0, 10)} → ${sheet.periodEnd.toISOString().slice(0, 10)}`,
        source: "PAYROLL",
        sourceId: sheet.id,
        createdById: params.processor.id,
        lines: [
          { accountId: wages.id, debit: amount, memo: "Gross labor" },
          { accountId: accrued.id, credit: amount, memo: "Accrued payroll" },
        ],
      });
      journalEntryId = je.id;
    }
  }

  const updated = await prisma.timesheet.update({
    where: { id: sheet.id },
    data: {
      status: "PROCESSED",
      processedById: params.processor.id,
      processedAt: new Date(),
      journalEntryId,
    },
  });
  await logAudit({
    entityType: "Timesheet",
    entityId: sheet.id,
    action: "TIMESHEET_PROCESSED",
    userId: params.processor.id,
    metadata: { amount, journalEntryId },
  });
  return updated;
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
        },
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
