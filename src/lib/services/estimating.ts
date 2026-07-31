/**
 * Estimating — roll a BOM and a routing into a cost, then into a price.
 *
 * Three things here are easy to get wrong and are handled explicitly.
 *
 * Scrap compounds. A part with 5% scrap built from a sub-assembly with 5%
 * scrap needs 1.05 x 1.05 of the raw component, not 1.10. The multi-level walk
 * multiplies the factor down each level rather than summing percentages.
 *
 * Efficiency divides. Sixty standard minutes at 85% efficiency costs 70.6
 * minutes of paid time, not 51. Multiplying is the intuitive move and it
 * understates every labour estimate.
 *
 * Margin is not markup. A 30% margin prices at cost / 0.7; a 30% markup prices
 * at cost x 1.3. They differ by more than most people expect, and quoting one
 * while intending the other is how a shop wins work at a loss.
 *
 * Labour dollars produced here are unburdened. They are handed to the rate
 * stack in rate-pools.ts, which applies fringe, overhead and G&A. Burdening a
 * work centre rate and then running it through the stack would apply indirect
 * cost twice.
 */
import { prisma } from "@/lib/db";
import { burden, getStack, type StackPool, type RateBasis } from "./rate-pools";

export const COST_BASES = ["STANDARD", "LAST_BUY", "AVERAGE"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export type EstimatePart = {
  id: string;
  partNumber: string;
  standardCost: number;
  lastBuyCost: number;
  averageCost: number;
  sourcingMethod: string;
};

export type EstimateBomLine = {
  componentPartId: string;
  quantity: number;
  scrapFactor: number;
};

export type EstimateStep = {
  estimatedMinutes: number;
  workCenter?: string | null;
};

export type EstimateWorkCenter = {
  code: string;
  laborRate: number;
  efficiency: number;
};

export function unitCost(part: EstimatePart, basis: CostBasis): number {
  if (basis === "LAST_BUY") return part.lastBuyCost;
  if (basis === "AVERAGE") return part.averageCost;
  return part.standardCost;
}

export type MaterialLine = {
  partNumber: string;
  /** Quantity per one top-level unit, scrap included at every level. */
  effectiveQty: number;
  unitCost: number;
  extended: number;
  level: number;
};

/**
 * Walk the BOM, multiplying scrap down each level.
 *
 * A part already on the current branch is not expanded again — a BOM that
 * references itself is bad data, but it must not hang the estimator.
 */
export function rollMaterial(
  rootPartId: string,
  ctx: {
    parts: Map<string, EstimatePart>;
    bom: Map<string, EstimateBomLine[]>;
    basis: CostBasis;
  },
  qtyPer = 1,
  level = 0,
  seen: string[] = []
): MaterialLine[] {
  const lines = ctx.bom.get(rootPartId);
  if (!lines || lines.length === 0 || seen.includes(rootPartId)) return [];

  const out: MaterialLine[] = [];
  for (const l of lines) {
    const part = ctx.parts.get(l.componentPartId);
    if (!part) continue;

    // Scrap is applied at this level and carried into any deeper expansion.
    const effective = qtyPer * l.quantity * (1 + (l.scrapFactor || 0));
    const children = rollMaterial(
      l.componentPartId,
      ctx,
      effective,
      level + 1,
      [...seen, rootPartId]
    );

    if (children.length > 0) {
      // A made sub-assembly contributes its components, not its own cost.
      out.push(...children);
    } else {
      const cost = unitCost(part, ctx.basis);
      out.push({
        partNumber: part.partNumber,
        effectiveQty: effective,
        unitCost: cost,
        extended: effective * cost,
        level,
      });
    }
  }
  return out;
}

export type LaborLine = {
  workCenter: string;
  standardMinutes: number;
  /** Paid hours after dividing by the centre's efficiency. */
  paidHours: number;
  rate: number;
  extended: number;
};

export function rollLabor(
  steps: EstimateStep[],
  centers: Map<string, EstimateWorkCenter>,
  fallbackRate = 0
): LaborLine[] {
  const byCenter = new Map<string, number>();
  for (const s of steps) {
    const key = (s.workCenter || "").trim() || "UNASSIGNED";
    byCenter.set(key, (byCenter.get(key) || 0) + (s.estimatedMinutes || 0));
  }

  const out: LaborLine[] = [];
  for (const [code, minutes] of byCenter) {
    const wc = centers.get(code);
    // Efficiency below 1 means the standard time costs more paid time, so it
    // divides. A missing or nonsensical efficiency falls back to 1 rather
    // than to zero, which would make labour free.
    const eff = wc && wc.efficiency > 0 ? wc.efficiency : 1;
    const rate = wc ? wc.laborRate : fallbackRate;
    const paidHours = minutes / 60 / eff;
    out.push({
      workCenter: code,
      standardMinutes: minutes,
      paidHours,
      rate,
      extended: paidHours * rate,
    });
  }
  return out.sort((a, b) => b.extended - a.extended);
}

export type PricingInput = {
  /** Fractional margin on price, e.g. 0.3 for a 30% gross margin. */
  margin?: number | null;
  /** Fractional markup on cost, e.g. 0.3 for cost x 1.3. */
  markup?: number | null;
};

/**
 * Margin is taken out of price, markup is added onto cost. A 30% margin on
 * $100 of cost prices at $142.86; a 30% markup prices at $130.
 */
export function priceFromCost(cost: number, pricing: PricingInput): number {
  if (pricing.margin != null && pricing.margin !== 0) {
    if (pricing.margin >= 1) {
      throw new Error("A margin of 100% or more has no finite price");
    }
    return cost / (1 - pricing.margin);
  }
  if (pricing.markup != null) return cost * (1 + pricing.markup);
  return cost;
}

export type Estimate = {
  quantity: number;
  material: MaterialLine[];
  labor: LaborLine[];
  materialCost: number;
  laborCost: number;
  burdened: ReturnType<typeof burden>;
  unitCost: number;
  totalCost: number;
  unitPrice: number;
  totalPrice: number;
};

/**
 * Assemble a full estimate. Material and labour are per-unit, multiplied by
 * quantity before burden so that the rate stack sees the whole job — G&A on a
 * one-unit estimate multiplied by 100 is the same number, but keeping the
 * order explicit avoids a rounding argument later.
 */
export function assembleEstimate(input: {
  quantity: number;
  material: MaterialLine[];
  labor: LaborLine[];
  pools: StackPool[];
  otherDirect?: number;
  pricing?: PricingInput;
}): Estimate {
  const qty = Math.max(0, input.quantity);
  const materialPer = input.material.reduce((s, l) => s + l.extended, 0);
  const laborPer = input.labor.reduce((s, l) => s + l.extended, 0);

  const b = burden(
    {
      directLabor: laborPer * qty,
      directMaterial: materialPer * qty,
      otherDirect: (input.otherDirect || 0) * qty,
    },
    input.pools
  );

  const totalCost = b.totalCost;
  const totalPrice = priceFromCost(totalCost, input.pricing || {});

  return {
    quantity: qty,
    material: input.material,
    labor: input.labor,
    materialCost: materialPer,
    laborCost: laborPer,
    burdened: b,
    unitCost: qty ? totalCost / qty : 0,
    totalCost,
    unitPrice: qty ? totalPrice / qty : 0,
    totalPrice,
  };
}

// ---------------------------------------------------------------- persistence

/**
 * Load everything the roll needs in a bounded number of queries, expanding the
 * BOM breadth-first rather than issuing one query per node.
 */
async function loadBomContext(rootPartId: string, basis: CostBasis) {
  const parts = new Map<string, EstimatePart>();
  const bom = new Map<string, EstimateBomLine[]>();

  let frontier = [rootPartId];
  const visited = new Set<string>();

  while (frontier.length > 0) {
    const ids = frontier.filter((id) => !visited.has(id));
    ids.forEach((id) => visited.add(id));
    if (ids.length === 0) break;

    const headers = await prisma.bomHeader.findMany({
      where: {
        partId: { in: ids },
        status: { in: ["CERTIFIED", "PROTOTYPE", "IN_REVIEW", "DRAFT"] },
      },
      orderBy: [{ status: "asc" }, { revision: "desc" }],
      include: { lines: true },
    });

    // Prefer a certified BOM when a part has more than one revision on file.
    const chosen = new Map<string, (typeof headers)[number]>();
    for (const h of headers) {
      const existing = chosen.get(h.partId);
      if (!existing || (existing.status !== "CERTIFIED" && h.status === "CERTIFIED")) {
        chosen.set(h.partId, h);
      }
    }

    const next: string[] = [];
    for (const [partId, header] of chosen) {
      bom.set(
        partId,
        header.lines.map((l) => ({
          componentPartId: l.componentPartId,
          quantity: l.quantity,
          scrapFactor: l.scrapFactor,
        }))
      );
      for (const l of header.lines) next.push(l.componentPartId);
    }
    frontier = next;
  }

  const allIds = [...visited, ...[...bom.values()].flat().map((l) => l.componentPartId)];
  const partRows = await prisma.part.findMany({
    where: { id: { in: [...new Set(allIds)] } },
    select: {
      id: true,
      partNumber: true,
      standardCost: true,
      lastBuyCost: true,
      averageCost: true,
      sourcingMethod: true,
    },
  });
  for (const p of partRows) parts.set(p.id, p);

  return { parts, bom, basis };
}

export async function estimatePart(input: {
  partId: string;
  quantity: number;
  basis?: CostBasis;
  fiscalYear?: number;
  rateBasis?: RateBasis;
  margin?: number | null;
  markup?: number | null;
  otherDirect?: number;
}): Promise<Estimate | null> {
  const basis = input.basis || "STANDARD";
  const part = await prisma.part.findUnique({ where: { id: input.partId } });
  if (!part) return null;

  const ctx = await loadBomContext(input.partId, basis);
  const material = rollMaterial(input.partId, ctx);

  // A part with no BOM is bought, so its own cost is the material cost.
  const materialLines =
    material.length > 0
      ? material
      : [
          {
            partNumber: part.partNumber,
            effectiveQty: 1,
            unitCost: unitCost(part as EstimatePart, basis),
            extended: unitCost(part as EstimatePart, basis),
            level: 0,
          },
        ];

  const wi = await prisma.workInstruction.findFirst({
    where: { partId: input.partId },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  const steps: EstimateStep[] = (wi?.steps || []).map((s) => ({
    estimatedMinutes: s.estimatedMinutes || 0,
    workCenter: s.workCenter,
  }));

  const wcRows = await prisma.workCenter.findMany({
    where: { isActive: true },
    select: { code: true, laborRate: true, efficiency: true },
  });
  const centers = new Map(wcRows.map((w) => [w.code, w]));

  const pools = await getStack(
    input.fiscalYear || new Date().getFullYear(),
    input.rateBasis || "PROVISIONAL"
  );

  return assembleEstimate({
    quantity: input.quantity,
    material: materialLines,
    labor: rollLabor(steps, centers),
    pools,
    otherDirect: input.otherDirect,
    pricing: { margin: input.margin, markup: input.markup },
  });
}
