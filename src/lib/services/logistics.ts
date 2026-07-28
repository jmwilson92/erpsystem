/**
 * Freight and landed cost.
 *
 * A part's real cost is not the PO price. Freight, duty, brokerage, and
 * insurance are paid on the receipt and then vanish — margin quietly reads
 * high because the cost of getting the material here was never attached to it.
 *
 * This module attaches it: charges are recorded against a Receipt, allocated
 * across that receipt's lines by value, weight, or quantity, and then folded
 * into each line's unit cost. Applying is one-way and stamped, because the
 * failure mode that matters is charging the same freight twice.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const CARRIER_MODES = ["PARCEL", "LTL", "FTL", "AIR", "OCEAN", "COURIER"] as const;
export const CHARGE_TYPES = [
  "FREIGHT",
  "DUTY",
  "BROKERAGE",
  "INSURANCE",
  "HANDLING",
  "TARIFF",
  "OTHER",
] as const;
export const ALLOCATION_METHODS = ["VALUE", "WEIGHT", "QUANTITY"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

// ─── Carriers ───────────────────────────────────────────────────

export async function listCarriers(activeOnly = false) {
  return prisma.carrier.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createCarrier(params: {
  code: string;
  name: string;
  mode?: string;
  accountNumber?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  trackingUrl?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const code = params.code.trim().toUpperCase();
  if (!code) throw new Error("Carrier code is required");
  const carrier = await prisma.carrier.create({
    data: {
      code,
      name: params.name.trim() || code,
      mode: params.mode || "PARCEL",
      accountNumber: params.accountNumber?.trim() || null,
      contactName: params.contactName?.trim() || null,
      contactPhone: params.contactPhone?.trim() || null,
      trackingUrl: params.trackingUrl?.trim() || null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Carrier",
    entityId: carrier.id,
    action: "CREATED",
    userId: params.userId,
  });
  return carrier;
}

export async function updateCarrier(id: string, data: Record<string, unknown>) {
  return prisma.carrier.update({ where: { id }, data });
}

/** Tracking deep-link. `{tracking}` in the carrier's URL is substituted. */
export function trackingLink(
  trackingUrl: string | null | undefined,
  trackingNumber: string | null | undefined
): string | null {
  if (!trackingUrl || !trackingNumber) return null;
  return trackingUrl.includes("{tracking}")
    ? trackingUrl.replace("{tracking}", encodeURIComponent(trackingNumber))
    : `${trackingUrl}${encodeURIComponent(trackingNumber)}`;
}

// ─── Freight ────────────────────────────────────────────────────

export async function recordFreight(params: {
  carrierId?: string | null;
  shipmentId?: string | null;
  receiptId?: string | null;
  direction?: string;
  trackingNumber?: string | null;
  service?: string | null;
  weight?: number | null;
  weightUnit?: string;
  cost: number;
  billedAmount?: number | null;
  shippedAt?: Date | null;
  notes?: string | null;
  userId?: string;
}) {
  if (!(params.cost >= 0)) throw new Error("Freight cost must be zero or more");
  return prisma.freightCost.create({
    data: {
      carrierId: params.carrierId || null,
      shipmentId: params.shipmentId || null,
      receiptId: params.receiptId || null,
      direction: params.direction || (params.receiptId ? "INBOUND" : "OUTBOUND"),
      trackingNumber: params.trackingNumber?.trim() || null,
      service: params.service?.trim() || null,
      weight: params.weight ?? null,
      weightUnit: params.weightUnit || "LB",
      cost: params.cost,
      billedAmount: params.billedAmount ?? null,
      shippedAt: params.shippedAt ?? null,
      notes: params.notes?.trim() || null,
    },
  });
}

export async function listFreight(params?: { direction?: string; days?: number }) {
  const since = params?.days
    ? new Date(Date.now() - params.days * 86_400_000)
    : undefined;
  return prisma.freightCost.findMany({
    where: {
      ...(params?.direction ? { direction: params.direction } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    include: { carrier: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/**
 * Outbound freight recovery: what shipping cost versus what was billed on.
 * Consistently negative means the shipping rates being quoted are stale.
 */
export async function getFreightSummary(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.freightCost.findMany({
    where: { createdAt: { gte: since } },
    select: { direction: true, cost: true, billedAmount: true },
    take: 2000,
  });
  const outbound = rows.filter((r) => r.direction === "OUTBOUND");
  const inbound = rows.filter((r) => r.direction === "INBOUND");
  const outboundCost = outbound.reduce((n, r) => n + r.cost, 0);
  const billed = outbound.reduce((n, r) => n + (r.billedAmount ?? 0), 0);
  return {
    shipments: outbound.length,
    outboundCost,
    billed,
    recovery: outboundCost > 0 ? Math.round((billed / outboundCost) * 100) : 0,
    inboundCost: inbound.reduce((n, r) => n + r.cost, 0),
    inboundCount: inbound.length,
  };
}

// ─── Landed cost ────────────────────────────────────────────────

export async function addLandedCost(params: {
  receiptId: string;
  type: string;
  amount: number;
  allocation?: string;
  description?: string | null;
  vendor?: string | null;
  userId?: string;
}) {
  if (!(params.amount > 0)) throw new Error("Amount must be greater than zero");
  return prisma.landedCostCharge.create({
    data: {
      receiptId: params.receiptId,
      type: params.type || "FREIGHT",
      amount: params.amount,
      allocation: params.allocation || "VALUE",
      description: params.description?.trim() || null,
      vendor: params.vendor?.trim() || null,
    },
  });
}

export async function listLandedCosts(receiptId: string) {
  return prisma.landedCostCharge.findMany({
    where: { receiptId },
    orderBy: { createdAt: "asc" },
  });
}

export type Allocation = {
  lineId: string;
  description: string;
  partId: string | null;
  quantity: number;
  unitCost: number;
  extended: number;
  /** Line weight used for WEIGHT allocation, and where it came from. */
  weight: number | null;
  weightSource: "LINE" | "PART" | "NONE";
  /** Charge apportioned to this line. */
  allocated: number;
  /** Unit cost once the charge is folded in. */
  newUnitCost: number;
};

export type AllocationResult = {
  rows: Allocation[];
  /** What the split was actually computed on. */
  basis: AllocationMethod;
  /**
   * True when WEIGHT was asked for but nothing had a weight, so quantity was
   * used instead. Surfaced rather than silently swallowed — an allocation that
   * quietly changes basis is an allocation you can't defend to an auditor.
   */
  fellBackToQuantity: boolean;
  /** Lines with no weight when allocating by weight — the ones to go fix. */
  missingWeight: number;
  weightUom: string | null;
};

/**
 * Resolve a line's weight: what was actually weighed on the receipt, else
 * quantity x the part's unit weight, else nothing.
 */
function lineWeight(
  line: { quantityReceived: number; weight: number | null; partId: string | null },
  partWeight: Map<string, number>
): { weight: number | null; source: "LINE" | "PART" | "NONE" } {
  if (line.weight != null && line.weight > 0) {
    return { weight: line.weight, source: "LINE" };
  }
  const unit = line.partId ? partWeight.get(line.partId) : undefined;
  if (unit != null && unit > 0) {
    return { weight: unit * line.quantityReceived, source: "PART" };
  }
  return { weight: null, source: "NONE" };
}

/**
 * Work out how one charge spreads across a receipt's lines.
 *
 * Pure — it computes, it doesn't write, so the UI can show the result before
 * anyone commits to it.
 *
 * WEIGHT uses the line's actual weight when receiving recorded one, otherwise
 * quantity x the part's unit weight. If nothing on the receipt has a weight at
 * all it falls back to quantity and says so, because an ocean freight bill
 * split by value when you asked for weight is wrong in a way that is invisible
 * afterwards.
 */
export async function previewAllocation(params: {
  receiptId: string;
  amount: number;
  allocation: AllocationMethod;
}): Promise<AllocationResult> {
  const lines = await prisma.receiptLine.findMany({
    where: { receiptId: params.receiptId },
  });
  if (lines.length === 0) {
    return {
      rows: [],
      basis: params.allocation,
      fellBackToQuantity: false,
      missingWeight: 0,
      weightUom: null,
    };
  }

  // Unit weights for any catalogued parts on the receipt.
  const partIds = [...new Set(lines.map((l) => l.partId).filter(Boolean))] as string[];
  const parts = partIds.length
    ? await prisma.part.findMany({
        where: { id: { in: partIds } },
        select: { id: true, unitWeight: true, weightUom: true },
      })
    : [];
  const partWeight = new Map(
    parts.filter((p) => p.unitWeight != null).map((p) => [p.id, p.unitWeight as number])
  );
  const weightUom =
    lines.find((l) => l.weight != null)?.weightUom ??
    parts.find((p) => p.unitWeight != null)?.weightUom ??
    "LB";

  const weights = lines.map((l) => lineWeight(l, partWeight));
  const totalWeight = weights.reduce((n, w) => n + (w.weight ?? 0), 0);
  const missingWeight = weights.filter((w) => w.weight == null).length;

  // Asked for weight, nothing has one → quantity, and say so.
  const fellBackToQuantity = params.allocation === "WEIGHT" && totalWeight <= 0;
  const basis: AllocationMethod = fellBackToQuantity ? "QUANTITY" : params.allocation;

  const shareOf = (i: number): number => {
    const l = lines[i];
    switch (basis) {
      case "WEIGHT":
        // A line with no weight gets nothing from a weight-based split, which
        // is correct: it contributed nothing to the freight bill.
        return weights[i].weight ?? 0;
      case "QUANTITY":
        return l.quantityReceived;
      case "VALUE":
      default:
        return l.quantityReceived * l.unitCost;
    }
  };

  let total = lines.reduce((n, _l, i) => n + shareOf(i), 0);
  // A zero basis (free-of-charge receipt, or every line zero qty) would divide
  // by zero. Spread evenly instead of dropping the charge on the floor.
  const even = total <= 0;
  if (even) total = lines.length;

  const rows: Allocation[] = [];
  let running = 0;
  lines.forEach((l, i) => {
    const share = even ? 1 : shareOf(i);
    // Last line absorbs the rounding remainder so the parts sum to the whole.
    const allocated =
      i === lines.length - 1
        ? Math.round((params.amount - running) * 100) / 100
        : Math.round(((params.amount * share) / total) * 100) / 100;
    running += allocated;
    rows.push({
      lineId: l.id,
      description: l.description,
      partId: l.partId,
      quantity: l.quantityReceived,
      unitCost: l.unitCost,
      extended: l.quantityReceived * l.unitCost,
      weight: weights[i].weight,
      weightSource: weights[i].source,
      allocated,
      newUnitCost:
        l.quantityReceived > 0
          ? Math.round((l.unitCost + allocated / l.quantityReceived) * 10000) / 10000
          : l.unitCost,
    });
  });

  return { rows, basis, fellBackToQuantity, missingWeight, weightUom };
}

/** Record what a receipt line actually weighed. */
export async function setReceiptLineWeight(params: {
  lineId: string;
  weight: number | null;
  weightUom?: string;
}) {
  return prisma.receiptLine.update({
    where: { id: params.lineId },
    data: {
      weight: params.weight != null && params.weight > 0 ? params.weight : null,
      weightUom: params.weightUom || "LB",
    },
  });
}

/**
 * Commit a charge into the receipt lines' unit cost.
 *
 * Refuses to run twice on the same charge — double-applied freight is a silent
 * margin error nobody catches, so `appliedAt` is checked before anything is
 * written and stamped in the same transaction as the cost updates.
 */
export async function applyLandedCost(params: {
  chargeId: string;
  userId?: string;
}): Promise<{ applied: boolean; reason?: string; lines: number }> {
  const charge = await prisma.landedCostCharge.findUnique({
    where: { id: params.chargeId },
  });
  if (!charge) return { applied: false, reason: "Charge not found", lines: 0 };
  if (charge.appliedAt) {
    return { applied: false, reason: "Already applied", lines: 0 };
  }

  const { rows: allocations } = await previewAllocation({
    receiptId: charge.receiptId,
    amount: charge.amount,
    allocation: charge.allocation as AllocationMethod,
  });
  if (allocations.length === 0) {
    return { applied: false, reason: "Receipt has no lines", lines: 0 };
  }

  // Callback form, not the array form: the request-scoped `prisma` proxy
  // resolves the client per call and hands back plain promises, which
  // $transaction([...]) rejects. `tx` here is the real client.
  await prisma.$transaction(async (tx) => {
    for (const a of allocations) {
      await tx.receiptLine.update({
        where: { id: a.lineId },
        data: { unitCost: a.newUnitCost },
      });
    }
    await tx.landedCostCharge.update({
      where: { id: charge.id },
      data: { appliedAt: new Date(), appliedById: params.userId || null },
    });
  });

  await logAudit({
    entityType: "LandedCostCharge",
    entityId: charge.id,
    action: "APPLIED",
    userId: params.userId,
    metadata: {
      amount: charge.amount,
      allocation: charge.allocation,
      lines: allocations.length,
    },
  });
  return { applied: true, lines: allocations.length };
}

/** Total landed cost on a receipt, split by what's been applied. */
export async function getReceiptLandedTotals(receiptId: string) {
  const charges = await prisma.landedCostCharge.findMany({ where: { receiptId } });
  const applied = charges.filter((c) => c.appliedAt);
  return {
    total: charges.reduce((n, c) => n + c.amount, 0),
    applied: applied.reduce((n, c) => n + c.amount, 0),
    pending: charges
      .filter((c) => !c.appliedAt)
      .reduce((n, c) => n + c.amount, 0),
    count: charges.length,
  };
}

/** Receipts carrying charges that nobody has applied yet. */
export async function getUnappliedCharges(limit = 50) {
  return prisma.landedCostCharge.findMany({
    where: { appliedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
