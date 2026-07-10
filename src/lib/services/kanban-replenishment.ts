import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { startPrApprovalWorkflow } from "@/lib/services/pr-approval";
import { isSupplierApprovedForPo } from "@/lib/services/items";

export type KanbanShortage = {
  partId: string;
  partNumber: string;
  description: string;
  uom: string;
  minStock: number;
  maxStock: number;
  available: number;
  onHand: number;
  qtyToOrder: number;
  unitCost: number;
  supplierId: string | null;
  leadTimeDays: number;
};

/**
 * Find kanban parts at or below min, compute refill qty (toward max),
 * and skip parts that already have an open PR or open PO line.
 */
export async function findKanbanShortages(): Promise<KanbanShortage[]> {
  const parts = await prisma.part.findMany({
    where: {
      isKanban: true,
      isActive: true,
      minStock: { gt: 0 },
    },
    include: {
      inventoryItems: {
        select: {
          quantityAvailable: true,
          quantityOnHand: true,
          ownership: true,
        },
      },
      vendors: {
        where: { isActive: true },
        orderBy: [{ isPreferred: "desc" }, { unitCost: "asc" }],
        include: { supplier: true },
      },
    },
  });

  // Open PR lines for these parts (don't double-order)
  const openPrLines = await prisma.purchaseRequestLine.findMany({
    where: {
      partId: { not: null },
      purchaseRequest: {
        status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
      },
    },
    select: { partId: true, quantity: true },
  });
  const openPrQtyByPart = new Map<string, number>();
  for (const l of openPrLines) {
    if (!l.partId) continue;
    openPrQtyByPart.set(
      l.partId,
      (openPrQtyByPart.get(l.partId) || 0) + l.quantity
    );
  }

  // Open PO lines not fully received
  const openPoLines = await prisma.purchaseOrderLine.findMany({
    where: {
      partId: { not: null },
      purchaseOrder: {
        status: {
          in: [
            "DRAFT",
            "APPROVED",
            "ISSUED",
            "ACKNOWLEDGED",
            "PARTIAL_RECEIPT",
          ],
        },
      },
    },
    select: {
      partId: true,
      quantity: true,
      quantityReceived: true,
    },
  });
  const openPoQtyByPart = new Map<string, number>();
  for (const l of openPoLines) {
    if (!l.partId) continue;
    const remaining = Math.max(0, l.quantity - (l.quantityReceived || 0));
    if (remaining <= 0) continue;
    openPoQtyByPart.set(
      l.partId,
      (openPoQtyByPart.get(l.partId) || 0) + remaining
    );
  }

  const shortages: KanbanShortage[] = [];

  for (const part of parts) {
    // Company stock only for kanban trigger (GFP is not refillable the same way)
    const companyItems = part.inventoryItems.filter(
      (i) => i.ownership === "COMPANY" || i.ownership === "CUSTOMER"
    );
    const available = companyItems.reduce((s, i) => s + i.quantityAvailable, 0);
    const onHand = companyItems.reduce((s, i) => s + i.quantityOnHand, 0);

    if (available > part.minStock) continue;

    const target =
      part.maxStock > 0
        ? part.maxStock
        : Math.max(part.minStock + (part.safetyStock || 0), part.minStock * 2);
    let qtyToOrder = Math.max(0, target - available);

    // Subtract already on-order
    const alreadyOrdered =
      (openPrQtyByPart.get(part.id) || 0) + (openPoQtyByPart.get(part.id) || 0);
    qtyToOrder = Math.max(0, qtyToOrder - alreadyOrdered);
    if (qtyToOrder <= 0) continue;

    // Preferred ASL vendor if any
    const vendor =
      part.vendors.find((v) => isSupplierApprovedForPo(v.supplier)) ||
      part.vendors[0] ||
      null;

    const unitCost =
      vendor?.unitCost ||
      part.lastBuyCost ||
      part.averageCost ||
      part.standardCost ||
      0;

    // Respect MOQ
    if (vendor && vendor.minOrderQty > 0 && qtyToOrder < vendor.minOrderQty) {
      qtyToOrder = vendor.minOrderQty;
    }

    shortages.push({
      partId: part.id,
      partNumber: part.partNumber,
      description: part.description,
      uom: part.uom,
      minStock: part.minStock,
      maxStock: part.maxStock,
      available,
      onHand,
      qtyToOrder,
      unitCost,
      supplierId: vendor?.supplierId || null,
      leadTimeDays: vendor?.leadTimeDays || part.leadTimeDays || 0,
    });
  }

  return shortages;
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Auto-create purchase requests for kanban parts at/below min.
 * Groups lines by preferred supplier (one PR per supplier + one unassigned).
 * Returns created PRs (empty if nothing needed).
 */
export async function ensureKanbanReplenishmentPrs(params?: {
  userId?: string;
  /** Only evaluate these part IDs (optional optimization after a stock move) */
  partIds?: string[];
}): Promise<{
  created: { id: string; number: string; lineCount: number; supplierId: string | null }[];
  shortages: KanbanShortage[];
}> {
  let shortages = await findKanbanShortages();
  if (params?.partIds?.length) {
    const set = new Set(params.partIds);
    shortages = shortages.filter((s) => set.has(s.partId));
  }

  if (shortages.length === 0) {
    return { created: [], shortages: [] };
  }

  // Group by supplier
  const bySupplier = new Map<string | null, KanbanShortage[]>();
  for (const s of shortages) {
    const key = s.supplierId;
    const list = bySupplier.get(key) || [];
    list.push(s);
    bySupplier.set(key, list);
  }

  // Fallback supplier for unassigned lines
  const fallbackSupplier = await prisma.supplier.findFirst({
    where: {
      isApprovedVendor: true,
      status: { in: ["APPROVED", "CONDITIONAL"] },
    },
    orderBy: { overallScore: "desc" },
  });

  const created: {
    id: string;
    number: string;
    lineCount: number;
    supplierId: string | null;
  }[] = [];

  for (const [supplierKey, lines] of bySupplier) {
    const supplierId = supplierKey || fallbackSupplier?.id || null;
    const maxLead = Math.max(...lines.map((l) => l.leadTimeDays), 7);
    const totalEstimate = lines.reduce(
      (s, l) => s + l.qtyToOrder * l.unitCost,
      0
    );

    const prCount = await prisma.purchaseRequest.count();
    const number = `PR-${String(prCount + 1).padStart(5, "0")}`;

    const justification = [
      "Kanban replenishment — auto-created when stock reached min level.",
      ...lines.map(
        (l) =>
          `${l.partNumber}: avail ${l.available} ≤ min ${l.minStock} → order ${l.qtyToOrder} (target max ${l.maxStock || "n/a"})`
      ),
    ].join("\n");

    const pr = await prisma.purchaseRequest.create({
      data: {
        number,
        status: "SUBMITTED",
        requestedById: params?.userId,
        department: "Inventory",
        neededBy: daysFromNow(maxLead),
        justification,
        totalEstimate,
        supplierId,
        lines: {
          create: lines.map((l) => ({
            partId: l.partId,
            description: `${l.partNumber} — ${l.description}`,
            quantity: l.qtyToOrder,
            estimatedUnitCost: l.unitCost,
            uom: l.uom,
            notes: `Kanban refill: min ${l.minStock} / max ${l.maxStock} · on-hand avail ${l.available}`,
          })),
        },
      },
    });

    await startPrApprovalWorkflow({
      purchaseRequestId: pr.id,
      userId: params?.userId,
    });

    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "CREATED_FROM_KANBAN",
      userId: params?.userId,
      metadata: {
        number,
        parts: lines.map((l) => l.partNumber),
        totalEstimate,
      },
    });

    created.push({
      id: pr.id,
      number: pr.number,
      lineCount: lines.length,
      supplierId,
    });
  }

  return { created, shortages };
}
