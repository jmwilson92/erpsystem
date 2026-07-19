/**
 * Memorized / recurring journal templates — rent, depreciation, standing
 * accruals. Templates store their lines as JSON and are materialized into
 * real journal entries when due. An autoReverse template posts each entry
 * with an autoReverseOn date (1st of the following month) so gaap.ts
 * runDueAutoReversals flips it automatically.
 */
import { prisma } from "@/lib/db";
import { postJournal } from "@/lib/services/gaap";

export type RecurringLine = {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
};

const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const;
export type RecurringFrequency = (typeof FREQUENCIES)[number];

/** Next run strictly after `after` for the given schedule. */
export function computeNextRun(
  frequency: string,
  dayOfMonth: number,
  after: Date
): Date {
  const d = new Date(after);
  if (frequency === "WEEKLY") {
    // dayOfMonth doubles as ISO weekday 1=Mon..7=Sun
    const target = Math.min(Math.max(dayOfMonth, 1), 7) % 7; // JS: 0=Sun
    const next = new Date(d);
    next.setHours(9, 0, 0, 0);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() !== target);
    return next;
  }
  const day = Math.min(Math.max(dayOfMonth, 1), 28);
  const step = frequency === "QUARTERLY" ? 3 : frequency === "ANNUALLY" ? 12 : 1;
  const next = new Date(d.getFullYear(), d.getMonth(), day, 9, 0, 0, 0);
  while (next <= after) next.setMonth(next.getMonth() + step);
  return next;
}

function parseLines(linesJson: string): RecurringLine[] {
  const lines = JSON.parse(linesJson) as RecurringLine[];
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("Template needs at least two lines");
  }
  return lines;
}

export async function createRecurringJournal(params: {
  name: string;
  description?: string | null;
  frequency: string;
  dayOfMonth: number;
  lines: RecurringLine[];
  autoReverse?: boolean;
  createdById?: string | null;
}) {
  if (!FREQUENCIES.includes(params.frequency as RecurringFrequency)) {
    throw new Error(`Frequency must be one of ${FREQUENCIES.join(", ")}`);
  }
  const debit = params.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = params.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.001) {
    throw new Error(`Template not balanced: debits ${debit} ≠ credits ${credit}`);
  }
  if (params.lines.length < 2) {
    throw new Error("Template needs at least two lines");
  }
  return prisma.recurringJournal.create({
    data: {
      name: params.name.trim(),
      description: params.description?.trim() || null,
      frequency: params.frequency,
      dayOfMonth: params.dayOfMonth,
      linesJson: JSON.stringify(params.lines),
      autoReverse: !!params.autoReverse,
      createdById: params.createdById || null,
      nextRunAt: computeNextRun(params.frequency, params.dayOfMonth, new Date()),
    },
  });
}

export async function setRecurringJournalActive(id: string, isActive: boolean) {
  return prisma.recurringJournal.update({
    where: { id },
    data: {
      isActive,
      // Re-arming resumes from today rather than back-filling missed runs.
      ...(isActive
        ? {
            nextRunAt: undefined, // set below with fresh compute
          }
        : {}),
    },
  }).then(async (rj) => {
    if (isActive) {
      return prisma.recurringJournal.update({
        where: { id },
        data: { nextRunAt: computeNextRun(rj.frequency, rj.dayOfMonth, new Date()) },
      });
    }
    return rj;
  });
}

export async function deleteRecurringJournal(id: string) {
  return prisma.recurringJournal.delete({ where: { id } });
}

export async function listRecurringJournals() {
  const templates = await prisma.recurringJournal.findMany({
    orderBy: { createdAt: "asc" },
  });
  const accountIds = new Set<string>();
  for (const t of templates) {
    try {
      for (const l of parseLines(t.linesJson)) accountIds.add(l.accountId);
    } catch {
      /* malformed template still listed */
    }
  }
  const accounts = await prisma.account.findMany({
    where: { id: { in: [...accountIds] } },
    select: { id: true, code: true, name: true },
  });
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  return templates.map((t) => {
    let lines: (RecurringLine & { accountCode?: string; accountName?: string })[] = [];
    let amount = 0;
    try {
      lines = parseLines(t.linesJson).map((l) => ({
        ...l,
        accountCode: acctById.get(l.accountId)?.code,
        accountName: acctById.get(l.accountId)?.name,
      }));
      amount = lines.reduce((s, l) => s + (l.debit || 0), 0);
    } catch {
      /* leave empty */
    }
    return { ...t, lines, amount };
  });
}

/** First day of the month after `d`, 9am — standard accrual-reversal date. */
function firstOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 9, 0, 0, 0);
}

/**
 * Post every active template whose nextRunAt has arrived, then advance the
 * schedule. Catch-up safe: a template that missed several periods posts one
 * entry per missed period (capped at 12 to avoid runaway back-fill).
 * Idempotent between due dates — safe to call on every accounting page load.
 */
export async function runDueRecurringJournals(userId?: string | null) {
  const due = await prisma.recurringJournal.findMany({
    where: { isActive: true, nextRunAt: { lte: new Date() } },
  });
  const posted: { templateId: string; number: string; date: Date }[] = [];
  for (const t of due) {
    let lines: RecurringLine[];
    try {
      lines = parseLines(t.linesJson);
    } catch {
      continue;
    }
    let runAt = t.nextRunAt || new Date();
    let guard = 0;
    while (runAt <= new Date() && guard < 12) {
      guard++;
      try {
        const je = await postJournal({
          description: t.name,
          source: "RECURRING",
          sourceId: t.id,
          createdById: userId || t.createdById || undefined,
          date: runAt,
          status: "POSTED",
          autoReverseOn: t.autoReverse ? firstOfNextMonth(runAt) : undefined,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            memo: l.memo || t.name,
          })),
        });
        posted.push({ templateId: t.id, number: je.number, date: runAt });
      } catch {
        // period closed or account deleted — skip this occurrence
      }
      runAt = computeNextRun(t.frequency, t.dayOfMonth, runAt);
    }
    await prisma.recurringJournal.update({
      where: { id: t.id },
      data: { lastRunAt: new Date(), nextRunAt: runAt },
    });
  }
  return posted;
}
