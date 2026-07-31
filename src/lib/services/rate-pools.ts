/**
 * Indirect rate pools and the government cost build-up.
 *
 * Pools apply in sequence and compound. Fringe burdens labour; overhead
 * burdens labour plus the fringe already applied to it; G&A burdens total cost
 * input, which is everything else added together. Treating the rates as
 * independent percentages that add up understates the wrap rate — a 30/50/12
 * stack is a 2.184 wrap on labour, not 1.92 — and that gap is what turns into
 * an under-recovery at year end.
 *
 * Three rates per year are kept apart on purpose. Provisional is what may be
 * billed now, actual is what the books support, final is what has been
 * negotiated. The difference between provisional and actual is the true-up,
 * and it cannot be computed if the three are collapsed into one number.
 */
import { prisma } from "@/lib/db";

export const POOL_TYPES = [
  "FRINGE",
  "OVERHEAD",
  "G_AND_A",
  "MATERIAL_HANDLING",
  "OTHER",
] as const;

export const ALLOCATION_BASES = [
  "DIRECT_LABOR",
  "TOTAL_LABOR",
  "DIRECT_LABOR_PLUS_FRINGE",
  "DIRECT_MATERIAL",
  "TOTAL_COST_INPUT",
] as const;

export const BASE_LABELS: Record<string, string> = {
  DIRECT_LABOR: "Direct labour",
  TOTAL_LABOR: "Total labour",
  DIRECT_LABOR_PLUS_FRINGE: "Direct labour + fringe",
  DIRECT_MATERIAL: "Direct material",
  TOTAL_COST_INPUT: "Total cost input",
};

export const RATE_BASIS = ["PROVISIONAL", "ACTUAL", "FINAL"] as const;
export type RateBasis = (typeof RATE_BASIS)[number];

/** Booked pool over booked base. Zero base yields zero, never Infinity. */
export function actualRate(year: {
  poolAmount: number;
  baseAmount: number;
}): number {
  if (!year.baseAmount) return 0;
  return year.poolAmount / year.baseAmount;
}

/**
 * The rate to use for a given basis. FINAL falls back to actual and then to
 * provisional, because a year that has not been negotiated still has to price
 * something rather than silently costing at zero.
 */
export function rateFor(
  year: {
    provisionalRate: number;
    poolAmount: number;
    baseAmount: number;
    finalRate?: number | null;
  },
  basis: RateBasis
): number {
  if (basis === "PROVISIONAL") return year.provisionalRate;
  if (basis === "ACTUAL") return actualRate(year);
  if (year.finalRate != null) return year.finalRate;
  // actualRate returns 0 for an unbooked year rather than null, so fall
  // through on zero rather than costing the year at nothing.
  return actualRate(year) || year.provisionalRate;
}

export type StackPool = {
  code: string;
  name?: string;
  poolType: string;
  allocationBase: string;
  sequence: number;
  rate: number;
};

export type DirectCosts = {
  directLabor?: number;
  directMaterial?: number;
  subcontract?: number;
  otherDirect?: number;
};

export type BurdenLine = {
  code: string;
  poolType: string;
  allocationBase: string;
  base: number;
  rate: number;
  amount: number;
};

export type BurdenResult = {
  directLabor: number;
  directMaterial: number;
  subcontract: number;
  otherDirect: number;
  totalDirect: number;
  lines: BurdenLine[];
  /** Everything except pools whose base is total cost input. */
  totalCostInput: number;
  totalIndirect: number;
  totalCost: number;
  /** Fully burdened cost per dollar of direct labour, 0 when there is none. */
  wrapRate: number;
};

/**
 * Apply a stack of pools to a set of direct costs.
 *
 * Each pool's base is resolved from what has been applied so far, so ordering
 * by `sequence` is what makes the compounding correct. A TOTAL_COST_INPUT pool
 * (G&A) sees every direct cost plus every indirect applied before it, and
 * never itself.
 */
export function burden(direct: DirectCosts, pools: StackPool[]): BurdenResult {
  const directLabor = direct.directLabor || 0;
  const directMaterial = direct.directMaterial || 0;
  const subcontract = direct.subcontract || 0;
  const otherDirect = direct.otherDirect || 0;
  const totalDirect = directLabor + directMaterial + subcontract + otherDirect;

  const ordered = [...pools].sort((a, b) => a.sequence - b.sequence);
  const lines: BurdenLine[] = [];

  // Indirect applied so far, split by what it burdens, so later pools can
  // resolve their own base without re-deriving the whole chain.
  let fringeApplied = 0;
  let indirectApplied = 0;

  for (const p of ordered) {
    let base = 0;
    switch (p.allocationBase) {
      case "DIRECT_LABOR":
        base = directLabor;
        break;
      case "TOTAL_LABOR":
        base = directLabor + fringeApplied;
        break;
      case "DIRECT_LABOR_PLUS_FRINGE":
        base = directLabor + fringeApplied;
        break;
      case "DIRECT_MATERIAL":
        base = directMaterial + subcontract;
        break;
      case "TOTAL_COST_INPUT":
        base = totalDirect + indirectApplied;
        break;
      default:
        base = 0;
    }

    const amount = base * p.rate;
    lines.push({
      code: p.code,
      poolType: p.poolType,
      allocationBase: p.allocationBase,
      base,
      rate: p.rate,
      amount,
    });

    if (p.poolType === "FRINGE") fringeApplied += amount;
    indirectApplied += amount;
  }

  // Total cost input is the G&A base: everything except G&A itself.
  const gaAmount = lines
    .filter((l) => l.allocationBase === "TOTAL_COST_INPUT")
    .reduce((s, l) => s + l.amount, 0);
  const totalIndirect = indirectApplied;
  const totalCostInput = totalDirect + (totalIndirect - gaAmount);
  const totalCost = totalDirect + totalIndirect;

  return {
    directLabor,
    directMaterial,
    subcontract,
    otherDirect,
    totalDirect,
    lines,
    totalCostInput,
    totalIndirect,
    totalCost,
    wrapRate: directLabor ? totalCost / directLabor : 0,
  };
}

/** Fully burdened cost of one dollar of direct labour under a stack. */
export function wrapRate(pools: StackPool[]): number {
  return burden({ directLabor: 1 }, pools).totalCost;
}

/**
 * What was billed at provisional rates versus what the actuals support.
 * Positive means over-billed and owed back at settlement.
 */
export function trueUp(direct: DirectCosts, pools: StackPool[], actualPools: StackPool[]) {
  const billed = burden(direct, pools);
  const actual = burden(direct, actualPools);
  return {
    billed,
    actual,
    variance: billed.totalCost - actual.totalCost,
  };
}

// ---------------------------------------------------------------- persistence

export async function listPools() {
  return prisma.ratePool.findMany({
    orderBy: [{ sequence: "asc" }, { code: "asc" }],
    include: { years: { orderBy: { fiscalYear: "desc" } } },
  });
}

export async function getStack(
  fiscalYear: number,
  basis: RateBasis = "PROVISIONAL"
): Promise<StackPool[]> {
  const pools = await prisma.ratePool.findMany({
    where: { isActive: true },
    orderBy: { sequence: "asc" },
    include: { years: { where: { fiscalYear } } },
  });

  return pools.map((p) => {
    const y = p.years[0];
    return {
      code: p.code,
      name: p.name,
      poolType: p.poolType,
      allocationBase: p.allocationBase,
      sequence: p.sequence,
      rate: y ? rateFor(y, basis) : 0,
    };
  });
}

export async function upsertPool(input: {
  id?: string;
  code: string;
  name: string;
  poolType: string;
  allocationBase: string;
  sequence: number;
  description?: string | null;
}) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("A pool code is required");
  if (!(POOL_TYPES as readonly string[]).includes(input.poolType)) {
    throw new Error(`Unknown pool type: ${input.poolType}`);
  }
  if (!(ALLOCATION_BASES as readonly string[]).includes(input.allocationBase)) {
    throw new Error(`Unknown allocation base: ${input.allocationBase}`);
  }

  const data = {
    code,
    name: input.name.trim() || code,
    poolType: input.poolType,
    allocationBase: input.allocationBase,
    sequence: input.sequence,
    description: (input.description || "").trim() || null,
  };

  return input.id
    ? prisma.ratePool.update({ where: { id: input.id }, data })
    : prisma.ratePool.create({ data });
}

export async function upsertYear(input: {
  ratePoolId: string;
  fiscalYear: number;
  provisionalRate?: number;
  poolAmount?: number;
  baseAmount?: number;
  finalRate?: number | null;
  status?: string;
  notes?: string | null;
}) {
  if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 1990) {
    throw new Error("Give a four-digit fiscal year");
  }
  for (const [label, v] of [
    ["provisional rate", input.provisionalRate],
    ["final rate", input.finalRate],
  ] as const) {
    if (v != null && (v < 0 || v > 10)) {
      throw new Error(
        `A ${label} of ${v} looks like a percentage — rates are decimals, so 32% is 0.32`
      );
    }
  }

  const data = {
    provisionalRate: input.provisionalRate ?? 0,
    poolAmount: input.poolAmount ?? 0,
    baseAmount: input.baseAmount ?? 0,
    finalRate: input.finalRate ?? null,
    status: input.status || "PROVISIONAL",
    notes: (input.notes || "").trim() || null,
  };

  return prisma.ratePoolYear.upsert({
    where: {
      ratePoolId_fiscalYear: {
        ratePoolId: input.ratePoolId,
        fiscalYear: input.fiscalYear,
      },
    },
    create: { ratePoolId: input.ratePoolId, fiscalYear: input.fiscalYear, ...data },
    update: data,
  });
}

export async function listCostCenters() {
  return prisma.costCenter.findMany({
    orderBy: [{ kind: "asc" }, { code: "asc" }],
    include: { ratePool: { select: { id: true, code: true, name: true } } },
  });
}

export async function upsertCostCenter(input: {
  id?: string;
  code: string;
  name: string;
  kind: string;
  ratePoolId?: string | null;
}) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("A cost centre code is required");
  const kind = input.kind === "INDIRECT" ? "INDIRECT" : "DIRECT";
  if (kind === "DIRECT" && input.ratePoolId) {
    throw new Error(
      "A direct cost centre charges contracts, so it does not collect into a pool"
    );
  }

  const data = {
    code,
    name: input.name.trim() || code,
    kind,
    ratePoolId: kind === "INDIRECT" ? input.ratePoolId || null : null,
  };

  return input.id
    ? prisma.costCenter.update({ where: { id: input.id }, data })
    : prisma.costCenter.create({ data });
}
