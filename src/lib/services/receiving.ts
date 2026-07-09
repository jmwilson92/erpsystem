"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Create a receiving traveler when a PO is issued (one open root traveler per PO). */
export async function createReceivingTravelerForPo(params: {
  purchaseOrderId: string;
  userId?: string;
  notes?: string;
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: {
      receivingTravelers: true,
      lines: true,
    },
  });
  if (!po) throw new Error("Purchase order not found");

  const open = po.receivingTravelers.find(
    (t) => ["WAITING", "PARTIAL"].includes(t.status) && !t.parentId
  );
  if (open) return open;

  // PO dock travelers are not GFP — gov prop only via dedicated GFP receiving traveler
  const count = await prisma.receivingTraveler.count();
  const number = `RCV-T-${String(count + 1).padStart(5, "0")}`;

  const traveler = await prisma.receivingTraveler.create({
    data: {
      number,
      travelerType: "PO",
      purchaseOrderId: po.id,
      isGovernmentProperty: false,
      status: "WAITING",
      expectedDate: po.promisedDate,
      contractNumber: po.clin || undefined,
      notes:
        params.notes ||
        `Receiving traveler for ${po.number} — dock hold until material arrives`,
      lines: {
        create: po.lines.map((l, i) => ({
          partId: l.partId || undefined,
          description: l.description,
          quantity: l.quantity,
          quantityReceived: l.quantityReceived,
          uom: l.uom,
          lineNumber: l.lineNumber || i + 1,
          unitCost: l.unitCost,
          ownership: "COMPANY",
        })),
      },
    },
  });

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "CREATED",
    userId: params.userId,
    metadata: {
      number,
      poNumber: po.number,
    },
  });

  return traveler;
}

/**
 * Customer / direct GFP receiving traveler — not tied to a purchase order.
 * Used when government property is customer-furnished or transferred without PO.
 */
export async function createCustomerGfpTraveler(params: {
  customerId?: string;
  contractNumber?: string;
  clin?: string;
  expectedDate?: Date;
  notes?: string;
  shipFromName?: string;
  shipFromAddress?: string;
  travelerType?: "CUSTOMER_GFP" | "DIRECT_GFP";
  lines: {
    partId?: string;
    description: string;
    quantity: number;
    uom?: string;
    unitCost?: number;
    ownership?: string;
  }[];
  userId?: string;
}) {
  if (!params.lines.length) throw new Error("Add at least one line");

  const count = await prisma.receivingTraveler.count();
  const number = `RCV-T-${String(count + 1).padStart(5, "0")}`;
  const travelerType = params.travelerType || "CUSTOMER_GFP";

  const traveler = await prisma.receivingTraveler.create({
    data: {
      number,
      travelerType,
      customerId: params.customerId,
      contractNumber: params.contractNumber,
      clin: params.clin,
      isGovernmentProperty: true,
      status: "WAITING",
      expectedDate: params.expectedDate,
      shipFromName: params.shipFromName,
      shipFromAddress: params.shipFromAddress,
      notes: params.notes || undefined,
      lines: {
        create: params.lines.map((l, i) => ({
          partId: l.partId,
          description: l.description,
          quantity: l.quantity,
          uom: l.uom || "EA",
          unitCost: l.unitCost || 0,
          lineNumber: i + 1,
          ownership: "GOVERNMENT",
        })),
      },
    },
    include: { lines: true, customer: true },
  });

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "CREATED_GFP",
    userId: params.userId,
    metadata: {
      number,
      travelerType,
      customerId: params.customerId,
      contractNumber: params.contractNumber,
      lines: params.lines.length,
    },
  });

  return traveler;
}

/**
 * After a receive (full or partial), update travelers and optionally spawn a
 * child traveler for the open remainder.
 * Works for PO-backed and GFP (non-PO) travelers.
 */
export async function syncReceivingTravelerStatus(
  purchaseOrderId: string | null | undefined,
  options?: {
    sourceTravelerId?: string;
    userId?: string;
    createChildIfPartial?: boolean;
  }
) {
  // Non-PO / GFP: sync by traveler id only
  if (options?.sourceTravelerId && !purchaseOrderId) {
    return syncGfpTravelerById(options.sourceTravelerId, options);
  }

  // If we only have traveler id, resolve PO if any
  if (options?.sourceTravelerId && !purchaseOrderId) {
    // unreachable - kept for clarity
  }

  let poId = purchaseOrderId || null;
  if (!poId && options?.sourceTravelerId) {
    const t = await prisma.receivingTraveler.findUnique({
      where: { id: options.sourceTravelerId },
      select: { purchaseOrderId: true },
    });
    poId = t?.purchaseOrderId || null;
    if (!poId) {
      return syncGfpTravelerById(options.sourceTravelerId, options);
    }
  }

  if (!poId) {
    return { allReceived: false, child: null as null };
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      lines: { include: { part: true } },
      receivingTravelers: true,
    },
  });
  if (!po) return { allReceived: false, child: null as null };

  const allReceived = po.lines.every((l) => l.quantityReceived >= l.quantity);
  const anyReceived = po.lines.some((l) => l.quantityReceived > 0);
  const openLines = po.lines
    .filter((l) => l.quantityReceived < l.quantity)
    .map((l) => ({
      poLineId: l.id,
      partNumber: l.part?.partNumber || null,
      description: l.description,
      ordered: l.quantity,
      received: l.quantityReceived,
      openQty: l.quantity - l.quantityReceived,
    }));

  return applyTravelerSplit({
    purchaseOrderId: po.id,
    travelers: po.receivingTravelers,
    allReceived,
    anyReceived,
    openLines,
    poNumber: po.number,
    promisedDate: po.promisedDate,
    options: {
      ...options,
      sourceTravelerId: options?.sourceTravelerId,
    },
    isGovernmentProperty: po.isGovernmentProperty,
    travelerType: "PO",
  });
}

async function syncGfpTravelerById(
  travelerId: string,
  options?: {
    sourceTravelerId?: string;
    userId?: string;
    createChildIfPartial?: boolean;
  }
) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: travelerId },
    include: {
      lines: { include: { part: true } },
      children: true,
      parent: true,
    },
  });
  if (!traveler) return { allReceived: false, child: null as null };

  const lines = traveler.lines;
  const allReceived = lines.every((l) => l.quantityReceived >= l.quantity);
  const anyReceived = lines.some((l) => l.quantityReceived > 0);
  const openLines = lines
    .filter((l) => l.quantityReceived < l.quantity)
    .map((l) => ({
      travelerLineId: l.id,
      partNumber: l.part?.partNumber || null,
      description: l.description,
      ordered: l.quantity,
      received: l.quantityReceived,
      openQty: l.quantity - l.quantityReceived,
    }));

  const rootId = traveler.parentId || traveler.id;
  const family = await prisma.receivingTraveler.findMany({
    where: {
      OR: [{ id: rootId }, { parentId: rootId }],
    },
  });

  return applyTravelerSplit({
    purchaseOrderId: null,
    travelers: family,
    allReceived,
    anyReceived,
    openLines,
    poNumber: undefined,
    promisedDate: traveler.expectedDate,
    options: { ...options, sourceTravelerId: travelerId },
    isGovernmentProperty: traveler.isGovernmentProperty,
    customerId: traveler.customerId,
    contractNumber: traveler.contractNumber,
    travelerType: traveler.travelerType,
  });
}

async function applyTravelerSplit(params: {
  purchaseOrderId: string | null;
  travelers: { id: string; status: string; parentId: string | null; notes: string | null }[];
  allReceived: boolean;
  anyReceived: boolean;
  openLines: Record<string, unknown>[];
  poNumber?: string;
  promisedDate?: Date | null;
  options?: {
    sourceTravelerId?: string;
    userId?: string;
    createChildIfPartial?: boolean;
  };
  isGovernmentProperty?: boolean;
  customerId?: string | null;
  contractNumber?: string | null;
  travelerType?: string;
}) {
  const {
    allReceived,
    anyReceived,
    openLines,
    options,
    purchaseOrderId,
  } = params;

  let child: { id: string; number: string } | null = null;

  if (allReceived) {
    for (const t of params.travelers) {
      if (t.status !== "CLOSED" && t.status !== "COMPLETE") {
        await prisma.receivingTraveler.update({
          where: { id: t.id },
          data: { status: "COMPLETE", openLinesSnapshot: null },
        });
      }
    }
    return { allReceived: true, anyReceived, openLines, child: null };
  }

  const sourceId = options?.sourceTravelerId;
  if (sourceId && anyReceived) {
    await prisma.receivingTraveler.update({
      where: { id: sourceId },
      data: {
        status: "PARTIAL",
        openLinesSnapshot: JSON.stringify(openLines),
      },
    });

    if (options?.createChildIfPartial !== false) {
      const existingChild = params.travelers.find(
        (t) =>
          t.parentId === sourceId && ["WAITING", "PARTIAL"].includes(t.status)
      );

      if (existingChild) {
        const existing = await prisma.receivingTraveler.findUnique({
          where: { id: existingChild.id },
        });
        child = existing
          ? { id: existing.id, number: existing.number }
          : null;
        if (existing) {
          await prisma.receivingTraveler.update({
            where: { id: existing.id },
            data: {
              status: "WAITING",
              openLinesSnapshot: JSON.stringify(openLines),
              notes: `Remainder waiting: ${openLines
                .map(
                  (l) =>
                    `${(l as { partNumber?: string }).partNumber || "line"} × ${(l as { openQty?: number }).openQty}`
                )
                .join(", ")}`,
            },
          });
        }
      } else {
        const count = await prisma.receivingTraveler.count();
        const number = `RCV-T-${String(count + 1).padStart(5, "0")}`;
        const remainderSummary = openLines
          .map(
            (l) =>
              `${(l as { partNumber?: string; description?: string }).partNumber || (l as { description?: string }).description}: ${(l as { openQty?: number }).openQty} open`
          )
          .join("; ");

        const created = await prisma.receivingTraveler.create({
          data: {
            number,
            travelerType: params.travelerType || "PO",
            purchaseOrderId: purchaseOrderId || undefined,
            customerId: params.customerId || undefined,
            contractNumber: params.contractNumber || undefined,
            isGovernmentProperty: params.isGovernmentProperty || false,
            parentId: sourceId,
            status: "WAITING",
            expectedDate: params.promisedDate || undefined,
            notes: `Child traveler — remainder after partial receive. ${remainderSummary}`,
            openLinesSnapshot: JSON.stringify(openLines),
          },
        });
        child = { id: created.id, number: created.number };

        await logAudit({
          entityType: "ReceivingTraveler",
          entityId: created.id,
          action: "CHILD_CREATED",
          userId: options?.userId,
          metadata: {
            number,
            parentId: sourceId,
            openLines,
            poNumber: params.poNumber,
          },
        });
      }
    }
  } else {
    for (const t of params.travelers) {
      if (t.status === "CLOSED" || t.status === "COMPLETE") continue;
      const next = anyReceived ? "PARTIAL" : "WAITING";
      if (t.status !== next) {
        await prisma.receivingTraveler.update({
          where: { id: t.id },
          data: {
            status: next,
            openLinesSnapshot: openLines.length
              ? JSON.stringify(openLines)
              : null,
          },
        });
      }
    }
  }

  return { allReceived: false, anyReceived, openLines, child };
}

/** Close PO from purchasing when every line is fully received. */
export async function closePurchaseOrderFromReceiving(params: {
  purchaseOrderId: string;
  userId?: string;
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: { lines: true, receivingTravelers: true },
  });
  if (!po) throw new Error("Purchase order not found");

  const allReceived = po.lines.every((l) => l.quantityReceived >= l.quantity);
  if (!allReceived) {
    const open = po.lines
      .filter((l) => l.quantityReceived < l.quantity)
      .map((l) => `${l.description}: ${l.quantity - l.quantityReceived} open`)
      .join("; ");
    throw new Error(
      `Cannot close PO — material still open on lines. ${open}`
    );
  }

  if (["CLOSED", "CANCELLED"].includes(po.status)) {
    return po;
  }

  // Only close the PO — travelers keep their own lifecycle (COMPLETE/CLOSED independently)
  const updated = await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "CLOSED" },
  });

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "CLOSED_BY_PURCHASING",
    userId: params.userId,
    metadata: { poNumber: po.number },
  });

  return updated;
}

/** Close a non-PO GFP traveler when fully received. */
export async function closeGfpTraveler(params: {
  travelerId: string;
  userId?: string;
}) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: params.travelerId },
    include: { lines: true, children: true },
  });
  if (!traveler) throw new Error("Traveler not found");
  if (traveler.purchaseOrderId) {
    throw new Error("Use Close PO for purchase-order travelers");
  }

  const allReceived = traveler.lines.every(
    (l) => l.quantityReceived >= l.quantity
  );
  if (!allReceived) {
    throw new Error("Cannot close — lines still open on this traveler");
  }

  await prisma.receivingTraveler.update({
    where: { id: traveler.id },
    data: { status: "CLOSED" },
  });
  for (const c of traveler.children) {
    if (c.status !== "CLOSED") {
      await prisma.receivingTraveler.update({
        where: { id: c.id },
        data: { status: "CLOSED" },
      });
    }
  }

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "CLOSED_GFP",
    userId: params.userId,
  });

  return traveler;
}
