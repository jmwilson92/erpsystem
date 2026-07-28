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
  /** Charge apportioned to this line. */
  allocated: number;
  /** Unit cost once the charge is folded in. */
  newUnitCost: number;
};

/**
 * Work out how one charge spreads across a receipt's lines.
 *
 * Pure — it computes, it doesn't write, so the UI can show the result before
 * anyone commits to it. WEIGHT falls back to QUANTITY when no line carries a
 * weight, which is the common case here: ReceiptLine has no weight column, so
 * quantity is the honest proxy rather than silently allocating nothing.
 */
export async function previewAllocation(params: {
  receiptId: string;
  amount: number;
  allocation: AllocationMethod;
}): Promise<Allocation[]> {
  const lines = await prisma.receiptLine.findMany({
    where: { receiptId: params.receiptId },
  });
  if (lines.length === 0) return [];

  const basis = (l: (typeof lines)[number]): number => {
    switch (params.allocation) {
      case "QUANTITY":
      case "WEIGHT":
        return l.quantityReceived;
      case "VALUE":
      default:
        return l.quantityReceived * l.unitCost;
    }
  };

  let total = lines.reduce((n, l) => n + basis(l), 0);
  // A zero basis (free-of-charge receipt, or every line zero qty) would divide
  // by zero. Spread evenly instead of dropping the charge on the floor.
  const even = total <= 0;
  if (even) total = lines.length;

  const out: Allocation[] = [];
  let running = 0;
  lines.forEach((l, i) => {
    const share = even ? 1 : basis(l);
    // Last line absorbs the rounding remainder so the parts sum to the whole.
    const allocated =
      i === lines.length - 1
        ? Math.round((params.amount - running) * 100) / 100
        : Math.round(((params.amount * share) / total) * 100) / 100;
    running += allocated;
    const extended = l.quantityReceived * l.unitCost;
    out.push({
      lineId: l.id,
      description: l.description,
      partId: l.partId,
      quantity: l.quantityReceived,
      unitCost: l.unitCost,
      extended,
      allocated,
      newUnitCost:
        l.quantityReceived > 0
          ? Math.round((l.unitCost + allocated / l.quantityReceived) * 10000) / 10000
          : l.unitCost,
    });
  });
  return out;
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

  const allocations = await previewAllocation({
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
