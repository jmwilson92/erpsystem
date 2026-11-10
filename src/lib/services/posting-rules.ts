/**
 * Pure accounting rules. No database. Shop-floor posting, government-contract
 * worksheets, and period locks all call these so the same math is tested
 * without standing up the ledger.
 *
 * Nothing here certifies FAR, CAS, or DCAA compliance. It is the arithmetic
 * a controller uses before their CPA reviews it.
 */

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundRate(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export type MoneyLine = { debit?: number; credit?: number };

/** Null when the entry is balanced and has two or more lines. */
export function journalBalanceError(lines: MoneyLine[]): string | null {
  if (lines.length < 2) return "Journal needs at least two lines";
  const debit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.001) {
    return `Journal not balanced: debits ${roundMoney(debit)} ≠ credits ${roundMoney(credit)}`;
  }
  return null;
}

export function isPeriodLocked(
  date: Date,
  closedThrough: Date | null,
  closedRanges: { start: Date; end: Date }[]
): boolean {
  if (closedThrough && date.getTime() <= closedThrough.getTime()) return true;
  return closedRanges.some(
    (r) => date.getTime() >= r.start.getTime() && date.getTime() <= r.end.getTime()
  );
}

/**
 * Separation of duties for manual journals. System-generated entries have
 * no creator and are not blocked. A controller may override.
 */
export function journalApprovalBlock(opts: {
  creatorId: string | null | undefined;
  approverId: string | null | undefined;
  requireSoD: boolean;
  approverIsController: boolean;
}): string | null {
  if (!opts.requireSoD) return null;
  if (!opts.creatorId || !opts.approverId) return null;
  if (opts.creatorId !== opts.approverId) return null;
  if (opts.approverIsController) return null;
  return "Someone else needs to approve this entry. A controller can override.";
}

export type IncurredLine = {
  programId?: string | null;
  projectId?: string | null;
  workOrderId?: string | null;
  costElement?: string | null;
  unallowable?: boolean;
  debit?: number;
  credit?: number;
};

export type IncurredBuckets = {
  material: number;
  labor: number;
  fringe: number;
  overhead: number;
  osp: number;
  other: number;
  unallowable: number;
  allowable: number;
  total: number;
};

const EMPTY_BUCKETS = (): IncurredBuckets => ({
  material: 0,
  labor: 0,
  fringe: 0,
  overhead: 0,
  osp: 0,
  other: 0,
  unallowable: 0,
  allowable: 0,
  total: 0,
});

/**
 * Cost that "happened" on a job or program. Only lines stamped with a cost
 * element count, so moving the same dollars from WIP to finished goods does
 * not count them again. Unallowable lines are reported beside the total and
 * left out of allowable unless includeUnallowable is set.
 */
export function netIncurred(
  lines: IncurredLine[],
  opts?: {
    programId?: string | null;
    projectId?: string | null;
    workOrderId?: string | null;
    includeUnallowable?: boolean;
  }
): IncurredBuckets {
  const out = EMPTY_BUCKETS();
  for (const l of lines) {
    if (!l.costElement) continue;
    if (opts?.programId && l.programId !== opts.programId) continue;
    if (opts?.projectId && l.projectId !== opts.projectId) continue;
    if (opts?.workOrderId && l.workOrderId !== opts.workOrderId) continue;
    const amt = roundMoney((l.debit || 0) - (l.credit || 0));
    if (l.unallowable) {
      out.unallowable = roundMoney(out.unallowable + amt);
      if (!opts?.includeUnallowable) continue;
    }
    switch (l.costElement) {
      case "MATERIAL":
        out.material = roundMoney(out.material + amt);
        break;
      case "LABOR":
        out.labor = roundMoney(out.labor + amt);
        break;
      case "FRINGE":
        out.fringe = roundMoney(out.fringe + amt);
        break;
      case "OVERHEAD":
        out.overhead = roundMoney(out.overhead + amt);
        break;
      case "OSP":
        out.osp = roundMoney(out.osp + amt);
        break;
      default:
        out.other = roundMoney(out.other + amt);
    }
  }
  out.allowable = roundMoney(
    out.material + out.labor + out.fringe + out.overhead + out.osp + out.other
  );
  out.total = roundMoney(out.allowable + out.unallowable);
  return out;
}

/** Pool dollars that are allowed to sit in a rate. Unallowable amounts drop out. */
export function allowablePoolCosts(
  rows: { amount: number; unallowable?: boolean }[]
): number {
  return roundMoney(
    rows.reduce((s, r) => s + (r.unallowable ? 0 : r.amount), 0)
  );
}

/** Actual indirect rate. Null when the base is zero so we never divide by it. */
export function actualIndirectRate(
  poolCosts: number,
  base: number
): number | null {
  if (!(base > 0)) return null;
  return roundRate(poolCosts / base);
}

export function allocateIndirect(
  baseByKey: { key: string; base: number }[],
  rate: number
): { key: string; amount: number }[] {
  return baseByKey.map((row) => ({
    key: row.key,
    amount: roundMoney(row.base * rate),
  }));
}

export function programOutlook(input: {
  funded: number;
  ceiling: number;
  billed: number;
  incurredAllowable: number;
  /** 0–100, from the program's projects */
  percentComplete: number;
  budget: number;
}): {
  eac: number;
  burn: number | null;
  remainingFunding: number;
  ceilingRoom: number;
  marginOnBillings: number;
} {
  const pct = input.percentComplete > 0 ? input.percentComplete / 100 : 0;
  const eac =
    pct >= 0.05
      ? roundMoney(input.incurredAllowable / pct)
      : roundMoney(Math.max(input.budget, input.incurredAllowable));
  const burn = input.funded > 0 ? input.incurredAllowable / input.funded : null;
  return {
    eac,
    burn,
    remainingFunding: roundMoney(input.funded - input.billed),
    ceilingRoom: roundMoney(input.ceiling - input.incurredAllowable),
    marginOnBillings: roundMoney(input.billed - input.incurredAllowable),
  };
}

/**
 * Move a finished job out of WIP. Standard cost lands in finished goods.
 * The difference between what the job absorbed and standard cost lands in
 * variance. Returns null when the job has no WIP on the books.
 */
export function completionEntry(params: {
  wipBalance: number;
  standardCost: number;
  fgAccountId: string;
  wipAccountId: string;
  varianceAccountId: string;
}): { accountId: string; debit: number; credit: number; memo: string }[] | null {
  const wip = roundMoney(params.wipBalance);
  if (wip <= 0.001) return null;
  const std = roundMoney(params.standardCost > 0 ? params.standardCost : wip);
  const variance = roundMoney(wip - std);
  const lines = [
    {
      accountId: params.fgAccountId,
      debit: std,
      credit: 0,
      memo: "Finished goods at standard cost",
    },
    {
      accountId: params.wipAccountId,
      debit: 0,
      credit: wip,
      memo: "Job costs moved off WIP",
    },
  ];
  if (variance > 0.001) {
    lines.push({
      accountId: params.varianceAccountId,
      debit: variance,
      credit: 0,
      memo: "Job ran over standard cost",
    });
  } else if (variance < -0.001) {
    lines.push({
      accountId: params.varianceAccountId,
      debit: 0,
      credit: roundMoney(-variance),
      memo: "Job ran under standard cost",
    });
  }
  return lines;
}

export function provisionalBilling(params: {
  contractType: string;
  allowableCost: number;
  feePercent: number;
  tmHours: { hours: number; billingRate: number }[];
  funded: number;
}): { basis: string; amount: number; fee: number } {
  const type = params.contractType.toUpperCase();
  if (type === "TM" || type === "T&M" || type === "TIME_AND_MATERIALS") {
    const amount = roundMoney(
      params.tmHours.reduce((s, h) => s + h.hours * h.billingRate, 0)
    );
    return {
      basis: "Hours times the labor-category rate. Unallowable cost is not in this figure.",
      amount,
      fee: 0,
    };
  }
  if (type === "COST_PLUS" || type === "CPFF" || type === "CPIF") {
    const fee = roundMoney(params.allowableCost * (params.feePercent / 100));
    return {
      basis:
        "Allowable cost plus the provisional fee. Unallowable cost is left out. Your accountant still has to agree the pool and the fee.",
      amount: roundMoney(params.allowableCost + fee),
      fee,
    };
  }
  return {
    basis: "Firm price. Cost is tracked so you can see margin. It is not billed as cost.",
    amount: roundMoney(params.funded),
    fee: 0,
  };
}

/** Weekdays in the range with less recorded time than the company expects. */
export function weekdayShortfalls(params: {
  datesWithHours: { date: string; hours: number }[];
  from: string;
  to: string;
  expected: number;
}): { date: string; hours: number; shortfall: number }[] {
  const totals = new Map<string, number>();
  for (const e of params.datesWithHours) {
    totals.set(e.date, roundMoney((totals.get(e.date) || 0) + e.hours));
  }
  const out: { date: string; hours: number; shortfall: number }[] = [];
  const cursor = new Date(`${params.from}T00:00:00Z`);
  const end = new Date(`${params.to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let t = cursor.getTime(); t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    const hours = totals.get(iso) || 0;
    if (hours + 0.001 < params.expected) {
      out.push({
        date: iso,
        hours,
        shortfall: roundMoney(params.expected - hours),
      });
    }
  }
  return out;
}

export type TimeSlice = { key: string; hours: number; charge: string };

export function describeTimeEdits(
  before: TimeSlice[],
  after: TimeSlice[]
): { key: string; field: string; beforeValue: string; afterValue: string }[] {
  const b = new Map(before.map((x) => [x.key, x]));
  const a = new Map(after.map((x) => [x.key, x]));
  const keys = new Set([...b.keys(), ...a.keys()]);
  const edits: {
    key: string;
    field: string;
    beforeValue: string;
    afterValue: string;
  }[] = [];
  for (const key of keys) {
    const prev = b.get(key);
    const next = a.get(key);
    if (!prev && next) {
      edits.push({
        key,
        field: "hours",
        beforeValue: "0",
        afterValue: String(next.hours),
      });
      continue;
    }
    if (prev && !next) {
      edits.push({
        key,
        field: "hours",
        beforeValue: String(prev.hours),
        afterValue: "0",
      });
      continue;
    }
    if (!prev || !next) continue;
    if (Math.abs(prev.hours - next.hours) > 0.001) {
      edits.push({
        key,
        field: "hours",
        beforeValue: String(prev.hours),
        afterValue: String(next.hours),
      });
    }
    if (prev.charge !== next.charge) {
      edits.push({
        key,
        field: "charge",
        beforeValue: prev.charge,
        afterValue: next.charge,
      });
    }
  }
  return edits;
}

/**
 * Government-furnished property may be kitted only when its contract number
 * matches the PMO program (or another charge string the caller passes).
 * Short tokens are ignored so a blank or a 1-character code cannot match everything.
 */
export function gfpContractMatches(
  contractNumber: string | null | undefined,
  candidates: (string | null | undefined)[]
): boolean {
  const c = (contractNumber || "").trim().toUpperCase();
  if (!c) return false;
  return candidates.some((raw) => {
    const v = (raw || "").trim().toUpperCase();
    if (v.length < 3) return false;
    return c === v || c.includes(v) || v.includes(c);
  });
}
