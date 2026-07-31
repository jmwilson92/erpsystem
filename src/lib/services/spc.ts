/**
 * Statistical process control — control charts and capability.
 *
 * The distinction this module exists to keep straight is that control limits
 * and specification limits are different things from different sources.
 * Control limits are computed from the process's own variation and answer "is
 * this process behaving the way it usually does". Spec limits come off the
 * drawing and answer "is this part acceptable". Drawing spec limits on a
 * control chart, or judging control by the tolerance, is the classic SPC
 * error: a process can sit comfortably inside tolerance while being wildly
 * out of control, and a perfectly stable process can be incapable.
 *
 * Two sigmas are likewise kept apart. Within-subgroup sigma, estimated from
 * mean range over d2, drives Cp/Cpk — short-term capability. Overall sample
 * sigma drives Pp/Ppk — long-term performance including drift between
 * subgroups. Reporting one as the other flatters or damns a process wrongly.
 */
import { prisma } from "@/lib/db";

/** Shewhart constants by subgroup size. */
const CONSTANTS: Record<number, { d2: number; A2: number; D3: number; D4: number }> = {
  2: { d2: 1.128, A2: 1.88, D3: 0, D4: 3.267 },
  3: { d2: 1.693, A2: 1.023, D3: 0, D4: 2.574 },
  4: { d2: 2.059, A2: 0.729, D3: 0, D4: 2.282 },
  5: { d2: 2.326, A2: 0.577, D3: 0, D4: 2.114 },
  6: { d2: 2.534, A2: 0.483, D3: 0, D4: 2.004 },
  7: { d2: 2.704, A2: 0.419, D3: 0.076, D4: 1.924 },
  8: { d2: 2.847, A2: 0.373, D3: 0.136, D4: 1.864 },
  9: { d2: 2.97, A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { d2: 3.078, A2: 0.308, D3: 0.223, D4: 1.777 },
};

/** Individuals charts use the n=2 constant, since moving ranges are pairs. */
const MR_D2 = 1.128;
const MR_D4 = 3.267;
const I_CHART_FACTOR = 2.66; // 3 / d2 for n = 2

/**
 * Measurements arrive as free text. Accepts a plain number, tolerates units
 * and stray whitespace, and returns null rather than NaN so callers cannot
 * accidentally average a non-measurement into the chart.
 */
export function parseMeasurement(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = /-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(String(raw).trim());
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). Zero for fewer than two points. */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

export function movingRanges(xs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) out.push(Math.abs(xs[i] - xs[i - 1]));
  return out;
}

/** Split a series into consecutive subgroups, discarding any short tail. */
export function subgroups(xs: number[], size: number): number[][] {
  if (size < 2) return xs.map((x) => [x]);
  const out: number[][] = [];
  for (let i = 0; i + size <= xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export type ControlChart = {
  chartType: "I_MR" | "XBAR_R";
  subgroupSize: number;
  /** Plotted points — individuals, or subgroup means. */
  points: number[];
  centerLine: number;
  ucl: number;
  lcl: number;
  /** Range chart, alongside. */
  ranges: number[];
  rangeCenter: number;
  rangeUcl: number;
  rangeLcl: number;
  /** Within-subgroup sigma, from mean range over d2. */
  sigmaWithin: number;
};

/**
 * Control limits from the data itself. Never from spec limits — that is the
 * whole point of the chart.
 */
export function controlChart(values: number[], subgroupSize = 1): ControlChart {
  const n = Math.max(1, Math.min(10, Math.floor(subgroupSize)));

  if (n === 1) {
    const mr = movingRanges(values);
    const mrBar = mean(mr);
    const center = mean(values);
    const sigmaWithin = mrBar / MR_D2;
    return {
      chartType: "I_MR",
      subgroupSize: 1,
      points: values,
      centerLine: center,
      ucl: center + I_CHART_FACTOR * mrBar,
      lcl: center - I_CHART_FACTOR * mrBar,
      ranges: mr,
      rangeCenter: mrBar,
      rangeUcl: MR_D4 * mrBar,
      rangeLcl: 0,
      sigmaWithin,
    };
  }

  const groups = subgroups(values, n);
  const means = groups.map(mean);
  const ranges = groups.map((g) => Math.max(...g) - Math.min(...g));
  const grand = mean(means);
  const rBar = mean(ranges);
  const k = CONSTANTS[n];

  return {
    chartType: "XBAR_R",
    subgroupSize: n,
    points: means,
    centerLine: grand,
    ucl: grand + k.A2 * rBar,
    lcl: grand - k.A2 * rBar,
    ranges,
    rangeCenter: rBar,
    rangeUcl: k.D4 * rBar,
    rangeLcl: k.D3 * rBar,
    sigmaWithin: rBar / k.d2,
  };
}

export type Capability = {
  n: number;
  mean: number;
  sigmaWithin: number;
  sigmaOverall: number;
  /** Potential capability — needs both spec limits. */
  cp: number | null;
  /** Actual capability against the nearer limit. */
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
};

/**
 * Cp/Cpk use within-subgroup sigma, Pp/Ppk the overall sample sigma. Cpk takes
 * the nearer spec limit, which is what makes it drop when the process is
 * centred badly even though the spread is fine — Cp alone would not notice.
 */
export function capability(
  values: number[],
  opts: { usl?: number | null; lsl?: number | null; subgroupSize?: number }
): Capability {
  const chart = controlChart(values, opts.subgroupSize ?? 1);
  const mu = mean(values);
  const sWithin = chart.sigmaWithin;
  const sOverall = stdDev(values);
  const { usl, lsl } = opts;

  const index = (sigma: number) => {
    if (!sigma || sigma <= 0) return { c: null as number | null, ck: null as number | null };
    const c = usl != null && lsl != null ? (usl - lsl) / (6 * sigma) : null;
    const upper = usl != null ? (usl - mu) / (3 * sigma) : null;
    const lower = lsl != null ? (mu - lsl) / (3 * sigma) : null;
    const sides = [upper, lower].filter((v): v is number => v != null);
    const ck = sides.length ? Math.min(...sides) : null;
    return { c, ck };
  };

  const within = index(sWithin);
  const overall = index(sOverall);

  return {
    n: values.length,
    mean: mu,
    sigmaWithin: sWithin,
    sigmaOverall: sOverall,
    cp: within.c,
    cpk: within.ck,
    pp: overall.c,
    ppk: overall.ck,
  };
}

export type Violation = { rule: number; index: number; description: string };

/**
 * Nelson rules 1-4. Rule 1 is the one everybody knows; 2-4 are what catch a
 * process that has shifted without any single point leaving the limits.
 */
export function violations(chart: ControlChart): Violation[] {
  const out: Violation[] = [];
  const { points, centerLine, ucl, lcl } = chart;
  const sigma = (ucl - centerLine) / 3;

  points.forEach((v, i) => {
    if (v > ucl || v < lcl) {
      out.push({ rule: 1, index: i, description: "Point beyond a control limit" });
    }
  });

  // Rule 2 — nine consecutive points on the same side of the centre line.
  let run = 0;
  let runSign = 0;
  points.forEach((v, i) => {
    const sign = v > centerLine ? 1 : v < centerLine ? -1 : 0;
    if (sign !== 0 && sign === runSign) run++;
    else {
      run = sign === 0 ? 0 : 1;
      runSign = sign;
    }
    if (run >= 9) {
      out.push({ rule: 2, index: i, description: "Nine points on one side of centre" });
    }
  });

  // Rule 3 — six consecutive points steadily increasing or decreasing.
  let trend = 1;
  let dir = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.sign(points[i] - points[i - 1]);
    if (d !== 0 && d === dir) trend++;
    else {
      trend = d === 0 ? 1 : 2;
      dir = d;
    }
    if (trend >= 6) {
      out.push({ rule: 3, index: i, description: "Six points trending in one direction" });
    }
  }

  // Rule 4 — two of three consecutive points beyond two sigma, same side.
  if (sigma > 0) {
    for (let i = 2; i < points.length; i++) {
      const win = [points[i - 2], points[i - 1], points[i]];
      const hi = win.filter((v) => v > centerLine + 2 * sigma).length;
      const lo = win.filter((v) => v < centerLine - 2 * sigma).length;
      if (hi >= 2 || lo >= 2) {
        out.push({ rule: 4, index: i, description: "Two of three beyond two sigma" });
      }
    }
  }

  return out;
}

/** True when no rule fired — the process is behaving like itself. */
export function inControl(chart: ControlChart): boolean {
  return violations(chart).length === 0;
}

// ---------------------------------------------------------------- persistence

export async function listCharacteristics() {
  return prisma.spcCharacteristic.findMany({
    orderBy: [{ name: "asc" }],
    include: { part: { select: { id: true, partNumber: true } } },
  });
}

export async function upsertCharacteristic(input: {
  id?: string;
  partId?: string | null;
  name: string;
  unit?: string | null;
  usl?: number | null;
  lsl?: number | null;
  target?: number | null;
  subgroupSize?: number;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("A characteristic name is required");
  if (input.usl != null && input.lsl != null && input.usl <= input.lsl) {
    throw new Error("The upper spec limit must be above the lower");
  }
  const size = input.subgroupSize ?? 1;
  if (size < 1 || size > 10) {
    throw new Error("Subgroup size must be between 1 and 10");
  }

  const data = {
    partId: input.partId || null,
    name,
    unit: (input.unit || "").trim() || null,
    usl: input.usl ?? null,
    lsl: input.lsl ?? null,
    target: input.target ?? null,
    subgroupSize: size,
  };

  return input.id
    ? prisma.spcCharacteristic.update({ where: { id: input.id }, data })
    : prisma.spcCharacteristic.create({ data });
}

/**
 * Pull the measurement series for a characteristic, oldest first, skipping
 * anything that does not parse as a number.
 */
export async function measurementsFor(characteristicId: string, limit = 250) {
  const ch = await prisma.spcCharacteristic.findUnique({
    where: { id: characteristicId },
    include: { part: { select: { id: true, partNumber: true } } },
  });
  if (!ch) return null;

  const rows = await prisma.inspectionResult.findMany({
    where: {
      characteristic: ch.name,
      ...(ch.partId ? { inspection: { partId: ch.partId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, measuredValue: true, result: true },
  });

  const values: number[] = [];
  let skipped = 0;
  for (const r of rows) {
    const v = parseMeasurement(r.measuredValue);
    if (v == null) skipped++;
    else values.push(v);
  }

  return { characteristic: ch, values, skipped, sampled: rows.length };
}

export async function analyse(characteristicId: string) {
  const data = await measurementsFor(characteristicId);
  if (!data) return null;
  const { characteristic: ch, values } = data;

  const chart = controlChart(values, ch.subgroupSize);
  const cap = capability(values, {
    usl: ch.usl,
    lsl: ch.lsl,
    subgroupSize: ch.subgroupSize,
  });

  return {
    ...data,
    chart,
    capability: cap,
    violations: violations(chart),
  };
}
