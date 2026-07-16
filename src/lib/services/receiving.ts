"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Structural role only — children are NOT siloed by QA vs Test.
 * What to do next is driven by status + open inspections on that traveler.
 */
export type TravelerPurpose = "ROOT" | "CHILD" | "REMAINDER";

export type TravelerSnapshot = {
  purpose: TravelerPurpose;
  openLines?: Record<string, unknown>[];
  inventoryItemIds?: string[];
};

export function parseTravelerSnapshot(
  raw: string | null | undefined
): TravelerSnapshot | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as TravelerSnapshot | Record<string, unknown>[];
    if (Array.isArray(j)) return { purpose: "ROOT", openLines: j };
    if (j && typeof j === "object" && "purpose" in j) {
      const snap = j as TravelerSnapshot & { purpose: string };
      // Legacy snapshots used QA / TEST / PUTAWAY — collapse to CHILD
      if (["QA", "TEST", "PUTAWAY"].includes(snap.purpose)) {
        return { ...snap, purpose: "CHILD" };
      }
      return snap as TravelerSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

export function travelerPurpose(
  t: { openLinesSnapshot?: string | null; parentId?: string | null; status?: string }
): TravelerPurpose {
  const snap = parseTravelerSnapshot(t.openLinesSnapshot);
  if (snap?.purpose === "REMAINDER") return "REMAINDER";
  if (snap?.purpose === "ROOT") return "ROOT";
  if (snap?.purpose === "CHILD") return "CHILD";
  if (!t.parentId) return "ROOT";
  if (t.status === "WAITING" || t.status === "PARTIAL") {
    // Parent split remainder vs active child — remainder waits at dock
    return "REMAINDER";
  }
  return "CHILD";
}

/** Parent RCV-T-00005 → next free RCV-T-00005-01, RCV-T-00005-02, … (pure sequence). */
export function nextChildTravelerNumber(
  parentNumber: string,
  siblingNumbers: string[]
): string {
  const prefix = `${parentNumber}-`;
  let max = 0;
  for (const n of siblingNumbers) {
    if (!n.startsWith(prefix)) continue;
    const rest = n.slice(prefix.length);
    const m = rest.match(/^(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${parentNumber}-${String(max + 1).padStart(2, "0")}`;
}

/** Plain-English notes — never “this dash is the QA traveler”. */
function handlerNote(
  purpose: TravelerPurpose,
  number: string,
  detail?: string
): string {
  switch (purpose) {
    case "REMAINDER":
      return `${number} · DOCK — still waiting for more material${
        detail ? ` (${detail})` : ""
      }.`;
    case "CHILD":
      return (
        detail ||
        `${number} · In process — complete whatever inspections this material needs, then put away at dock.`
      );
    default:
      return `${number} · DOCK — receive material here.`;
  }
}

function snapshotJson(
  purpose: TravelerPurpose,
  openLines?: Record<string, unknown>[],
  inventoryItemIds?: string[]
): string {
  return JSON.stringify({
    purpose,
    openLines: openLines || [],
    inventoryItemIds: inventoryItemIds || [],
  } satisfies TravelerSnapshot);
}

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
    (t) =>
      ["WAITING", "PARTIAL"].includes(t.status) &&
      !t.parentId &&
      travelerPurpose(t) === "ROOT"
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
        handlerNote("ROOT", number),
      openLinesSnapshot: snapshotJson("ROOT"),
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
 *
 * Always safe to call even when material was routed to QA/Test — remainder
 * children stay WAITING so the dock is never stuck.
 */
export async function syncReceivingTravelerStatus(
  purchaseOrderId: string | null | undefined,
  options?: {
    sourceTravelerId?: string;
    userId?: string;
    createChildIfPartial?: boolean;
    /** When true, source keeps IN_INSPECTION / READY_TO_STOCK (don't overwrite). */
    preserveInspectionStatus?: boolean;
  }
) {
  // Non-PO / GFP: sync by traveler id only
  if (options?.sourceTravelerId && !purchaseOrderId) {
    return syncGfpTravelerById(options.sourceTravelerId, options);
  }

  let poId = purchaseOrderId || null;
  if (!poId && options?.sourceTravelerId) {
    const t = await prisma.receivingTraveler.findUnique({
      where: { id: options.sourceTravelerId },
      select: { purchaseOrderId: true },
    });
    poId = t?.purchaseOrderId || null;
    if (!poId) {
      return syncGfpTravelerById(options.sourceTravelerId!, options);
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
      partId: l.partId,
      partNumber: l.part?.partNumber || null,
      description: l.description,
      ordered: l.quantity,
      received: l.quantityReceived,
      openQty: l.quantity - l.quantityReceived,
      uom: l.uom,
      unitCost: l.unitCost,
      lineNumber: l.lineNumber,
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

/**
 * After dock receive:
 *  - Dock-only lines (no inspection flags) → put away at dock, no child.
 *  - Each line that needs further work → next sequential child (-01, -02, …).
 *    Child is purpose-agnostic: whatever inspections the material needs live on it.
 *  - Open remainder qty → next sequential child as REMAINDER (dock again later).
 * No work orders.
 */
export async function splitTravelerAfterReceive(params: {
  sourceTravelerId: string;
  receiptId: string;
  /** Inventory items that still need post-dock work (any inspection mix). */
  routedInventoryItemIds?: string[];
  /** @deprecated ignored — children are not station-siloed */
  station?: "QA" | "TEST" | null;
  /** @deprecated ignored — use flat routedInventoryItemIds (one child per line) */
  routedGroups?: { station: "QA" | "TEST"; inventoryItemIds: string[] }[];
  putAwayCount?: number;
  userId?: string;
  createRemainderIfOpen?: boolean;
}) {
  const source = await prisma.receivingTraveler.findUnique({
    where: { id: params.sourceTravelerId },
    include: {
      lines: true,
      children: true,
      parent: true,
      purchaseOrder: { include: { lines: { include: { part: true } } } },
    },
  });
  if (!source) throw new Error("Traveler not found");

  const rootId = source.parentId || source.id;
  const root =
    rootId === source.id
      ? source
      : await prisma.receivingTraveler.findUnique({
          where: { id: rootId },
          include: { children: true, lines: true },
        });
  if (!root) throw new Error("Root traveler not found");

  const family = await prisma.receivingTraveler.findMany({
    where: { OR: [{ id: root.id }, { parentId: root.id }] },
    select: { id: true, number: true, status: true, parentId: true },
  });
  const siblingNumbers = family.map((t) => t.number);

  const childrenCreated: { id: string; number: string; purpose: TravelerPurpose }[] =
    [];

  // Flatten routed inventory (legacy groups collapse — no QA/TEST silo)
  const routedIds = [
    ...new Set([
      ...(params.routedInventoryItemIds || []),
      ...(params.routedGroups || []).flatMap((g) => g.inventoryItemIds),
    ]),
  ];

  const receipt = await prisma.receipt.findUnique({
    where: { id: params.receiptId },
    include: { lines: true },
  });

  const invRows =
    routedIds.length > 0
      ? await prisma.inventoryItem.findMany({
          where: { id: { in: routedIds } },
          select: {
            id: true,
            partId: true,
            lotNumber: true,
            quantityOnHand: true,
            unitCost: true,
            part: {
              select: {
                partNumber: true,
                requiresGdtInspection: true,
                requiresFunctionalTest: true,
              },
            },
          },
        })
      : [];
  const invById = Object.fromEntries(invRows.map((i) => [i.id, i]));

  // ── 1) One child per routed line (sequential -01, -02, …) ──
  // Pair each inventory item with its receipt line when possible.
  let receiptAssigned = false;
  const usedReceiptLineIds = new Set<string>();

  for (const invId of routedIds) {
    const inv = invById[invId];
    if (!inv) continue;

    const number = nextChildTravelerNumber(root.number, siblingNumbers);
    siblingNumbers.push(number);

    const receiptLine =
      (receipt?.lines || []).find(
        (l) =>
          !usedReceiptLineIds.has(l.id) &&
          l.partId === inv.partId &&
          (!inv.lotNumber || !l.lotNumber || l.lotNumber === inv.lotNumber)
      ) ||
      (receipt?.lines || []).find(
        (l) => !usedReceiptLineIds.has(l.id) && l.partId === inv.partId
      );

    if (receiptLine) usedReceiptLineIds.add(receiptLine.id);

    const needs: string[] = [];
    if (inv.part?.requiresGdtInspection) needs.push("visual/GD&T");
    if (inv.part?.requiresFunctionalTest) needs.push("functional");
    const needLabel = needs.length ? needs.join(" + ") : "receiving checks";
    const partLabel =
      inv.part?.partNumber || receiptLine?.description?.slice(0, 40) || "material";

    const child = await prisma.receivingTraveler.create({
      data: {
        number,
        travelerType: source.travelerType,
        purchaseOrderId: source.purchaseOrderId || undefined,
        customerId: source.customerId || undefined,
        contractNumber: source.contractNumber || undefined,
        isGovernmentProperty: source.isGovernmentProperty,
        parentId: root.id,
        status: "IN_INSPECTION",
        expectedDate: source.expectedDate || undefined,
        notes: handlerNote(
          "CHILD",
          number,
          `${number} · ${partLabel} — complete open work (${needLabel}), then put away at dock.`
        ),
        openLinesSnapshot: snapshotJson(
          "CHILD",
          [
            {
              inventoryItemId: invId,
              partId: inv.partId,
              partNumber: inv.part?.partNumber,
              lotNumber: inv.lotNumber,
            },
          ],
          [invId]
        ),
        lines: {
          create: [
            {
              partId: inv.partId || undefined,
              description:
                receiptLine?.description ||
                inv.part?.partNumber ||
                "Received material",
              quantity: receiptLine?.quantityReceived || inv.quantityOnHand || 1,
              quantityReceived:
                receiptLine?.quantityReceived || inv.quantityOnHand || 1,
              uom: "EA",
              lineNumber: 1,
              unitCost: receiptLine?.unitCost || inv.unitCost || 0,
              ownership: receiptLine?.ownership || "COMPANY",
              notes: inv.lotNumber ? `Lot ${inv.lotNumber}` : undefined,
            },
          ],
        },
      },
    });

    // First child owns the receipt row for inspection linkage; others match via inv id
    if (!receiptAssigned) {
      await prisma.receipt.update({
        where: { id: params.receiptId },
        data: { travelerId: child.id },
      });
      receiptAssigned = true;
    }

    childrenCreated.push({ id: child.id, number: child.number, purpose: "CHILD" });

    await logAudit({
      entityType: "ReceivingTraveler",
      entityId: child.id,
      action: "CHILD_CREATED",
      userId: params.userId,
      metadata: {
        number,
        parentId: root.id,
        purpose: "CHILD",
        inventoryItemId: invId,
        receiptId: params.receiptId,
        sequenceOnly: true,
      },
    });
  }

  // ── 2) Remainder child when PO / traveler still has open qty ──
  const createRemainder = params.createRemainderIfOpen !== false;
  if (createRemainder) {
    let openLines: {
      partId?: string | null;
      description: string;
      openQty: number;
      uom?: string;
      unitCost?: number;
      lineNumber?: number;
      poLineId?: string;
      partNumber?: string | null;
    }[] = [];

    if (source.purchaseOrder) {
      openLines = source.purchaseOrder.lines
        .filter((l) => l.quantityReceived < l.quantity)
        .map((l) => ({
          partId: l.partId,
          description: l.description,
          openQty: l.quantity - l.quantityReceived,
          uom: l.uom,
          unitCost: l.unitCost,
          lineNumber: l.lineNumber,
          poLineId: l.id,
          partNumber: l.part?.partNumber || null,
        }));
    } else {
      openLines = source.lines
        .filter((l) => l.quantityReceived < l.quantity)
        .map((l) => ({
          partId: l.partId,
          description: l.description,
          openQty: l.quantity - l.quantityReceived,
          uom: l.uom,
          unitCost: l.unitCost,
          lineNumber: l.lineNumber,
        }));
    }

    if (openLines.length > 0) {
      // Reuse existing open remainder child if present
      const existingRem = family.find((t) => {
        if (t.parentId !== root.id) return false;
        if (!["WAITING", "PARTIAL"].includes(t.status)) return false;
        // Prefer ones already tagged REMAINDER
        return true;
      });

      // Prefer a child that is actually remainder purpose
      let remainderId: string | null = null;
      for (const t of await prisma.receivingTraveler.findMany({
        where: {
          parentId: root.id,
          status: { in: ["WAITING", "PARTIAL"] },
        },
      })) {
        if (travelerPurpose(t) === "REMAINDER") {
          remainderId = t.id;
          break;
        }
      }

      if (remainderId) {
        await prisma.receivingTravelerLine.deleteMany({
          where: { travelerId: remainderId },
        });
        const rem = await prisma.receivingTraveler.update({
          where: { id: remainderId },
          data: {
            status: "WAITING",
            notes: handlerNote("REMAINDER", existingRem?.number || ""),
            openLinesSnapshot: snapshotJson(
              "REMAINDER",
              openLines.map((l) => ({
                poLineId: l.poLineId,
                partNumber: l.partNumber,
                description: l.description,
                openQty: l.openQty,
              }))
            ),
            lines: {
              create: openLines.map((l, i) => ({
                partId: l.partId || undefined,
                description: l.description,
                quantity: l.openQty,
                quantityReceived: 0,
                uom: l.uom || "EA",
                lineNumber: l.lineNumber || i + 1,
                unitCost: l.unitCost || 0,
                ownership: source.isGovernmentProperty
                  ? "GOVERNMENT"
                  : "COMPANY",
              })),
            },
          },
        });
        // Fix notes with actual number
        await prisma.receivingTraveler.update({
          where: { id: rem.id },
          data: { notes: handlerNote("REMAINDER", rem.number) },
        });
        childrenCreated.push({
          id: rem.id,
          number: rem.number,
          purpose: "REMAINDER",
        });
      } else {
        const number = nextChildTravelerNumber(root.number, siblingNumbers);
        siblingNumbers.push(number);
        const rem = await prisma.receivingTraveler.create({
          data: {
            number,
            travelerType: source.travelerType,
            purchaseOrderId: source.purchaseOrderId || undefined,
            customerId: source.customerId || undefined,
            contractNumber: source.contractNumber || undefined,
            isGovernmentProperty: source.isGovernmentProperty,
            parentId: root.id,
            status: "WAITING",
            expectedDate: source.expectedDate || undefined,
            notes: handlerNote("REMAINDER", number),
            openLinesSnapshot: snapshotJson(
              "REMAINDER",
              openLines.map((l) => ({
                poLineId: l.poLineId,
                partNumber: l.partNumber,
                description: l.description,
                openQty: l.openQty,
              }))
            ),
            lines: {
              create: openLines.map((l, i) => ({
                partId: l.partId || undefined,
                description: l.description,
                quantity: l.openQty,
                quantityReceived: 0,
                uom: l.uom || "EA",
                lineNumber: l.lineNumber || i + 1,
                unitCost: l.unitCost || 0,
                ownership: source.isGovernmentProperty
                  ? "GOVERNMENT"
                  : "COMPANY",
              })),
            },
          },
        });
        childrenCreated.push({
          id: rem.id,
          number: rem.number,
          purpose: "REMAINDER",
        });
        await logAudit({
          entityType: "ReceivingTraveler",
          entityId: rem.id,
          action: "CHILD_CREATED",
          userId: params.userId,
          metadata: { number, parentId: root.id, purpose: "REMAINDER" },
        });
      }
    }
  }

  // ── 3) Update source / root status ──
  // Dock-only putaway does not need an inspection child. When we peeled
  // QA/Test material onto children, parent becomes the umbrella card.
  const openOnPo = source.purchaseOrder
    ? source.purchaseOrder.lines.some((l) => l.quantityReceived < l.quantity)
    : source.lines.some((l) => l.quantityReceived < l.quantity);

  const hadInspectionChildren = routedIds.length > 0;
  const putAwayN = params.putAwayCount || 0;

  if (hadInspectionChildren || putAwayN > 0 || openOnPo) {
    if (!source.parentId) {
      const bits: string[] = [];
      if (putAwayN > 0) bits.push(`${putAwayN} line(s) put away at dock`);
      if (hadInspectionChildren) {
        bits.push(
          `${routedIds.length} child traveler(s) for lines still in process`
        );
      }
      if (openOnPo) bits.push("remainder child owns open qty");

      await prisma.receivingTraveler.update({
        where: { id: source.id },
        data: {
          // Parent is never stuck IN_INSPECTION when children own that work
          status: openOnPo
            ? "PARTIAL"
            : hadInspectionChildren
              ? "PARTIAL"
              : "COMPLETE",
          notes:
            bits.length > 0
              ? `${source.number} · Parent — ${bits.join("; ")}. Follow -01, -02… children.`
              : handlerNote("ROOT", source.number),
          openLinesSnapshot: snapshotJson("ROOT"),
        },
      });
    } else if (travelerPurpose(source) === "REMAINDER") {
      const srcLines = await prisma.receivingTravelerLine.findMany({
        where: { travelerId: source.id },
      });
      const remDone =
        srcLines.length > 0 &&
        srcLines.every((l) => l.quantityReceived >= l.quantity);
      await prisma.receivingTraveler.update({
        where: { id: source.id },
        data: {
          status:
            remDone && !openOnPo
              ? "COMPLETE"
              : openOnPo
                ? "PARTIAL"
                : "COMPLETE",
        },
      });
    }
  }

  return { children: childrenCreated, rootId: root.id };
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
  travelers: {
    id: string;
    number?: string;
    status: string;
    parentId: string | null;
    notes: string | null;
    openLinesSnapshot?: string | null;
  }[];
  allReceived: boolean;
  anyReceived: boolean;
  openLines: Record<string, unknown>[];
  poNumber?: string;
  promisedDate?: Date | null;
  options?: {
    sourceTravelerId?: string;
    userId?: string;
    createChildIfPartial?: boolean;
    preserveInspectionStatus?: boolean;
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
    // Only complete WAITING/PARTIAL dock travelers — leave IN_INSPECTION / READY_TO_STOCK alone
    for (const t of params.travelers) {
      if (["IN_INSPECTION", "READY_TO_STOCK"].includes(t.status)) continue;
      if (t.status !== "CLOSED" && t.status !== "COMPLETE") {
        // Don't force-complete remainder/inspection children that are mid-flight
        if (t.parentId && travelerPurpose(t) !== "REMAINDER") continue;
        await prisma.receivingTraveler.update({
          where: { id: t.id },
          data: {
            status: "COMPLETE",
            openLinesSnapshot: snapshotJson(
              travelerPurpose(t) === "ROOT" ? "ROOT" : "REMAINDER",
              []
            ),
          },
        });
      }
    }
    return { allReceived: true, anyReceived, openLines, child: null };
  }

  const sourceId = options?.sourceTravelerId;
  if (sourceId && anyReceived) {
    const source = params.travelers.find((t) => t.id === sourceId);
    const preserve =
      options?.preserveInspectionStatus ||
      (source &&
        ["IN_INSPECTION", "READY_TO_STOCK"].includes(source.status));

    if (!preserve) {
      await prisma.receivingTraveler.update({
        where: { id: sourceId },
        data: {
          status: "PARTIAL",
          openLinesSnapshot: snapshotJson("ROOT", openLines),
        },
      });
    }

    if (options?.createChildIfPartial !== false && openLines.length > 0) {
      // Prefer existing REMAINDER child under root
      const rootId =
        source?.parentId ||
        params.travelers.find((t) => t.id === sourceId)?.parentId ||
        sourceId;
      const rootTraveler =
        params.travelers.find((t) => t.id === rootId) || source;
      const rootNumber =
        rootTraveler && "number" in rootTraveler && rootTraveler.number
          ? rootTraveler.number
          : (
              await prisma.receivingTraveler.findUnique({
                where: { id: rootId! },
                select: { number: true },
              })
            )?.number || "RCV-T-00000";

      const family = await prisma.receivingTraveler.findMany({
        where: { OR: [{ id: rootId! }, { parentId: rootId! }] },
      });

      let existingRem = family.find(
        (t) =>
          t.parentId === rootId &&
          ["WAITING", "PARTIAL"].includes(t.status) &&
          travelerPurpose(t) === "REMAINDER"
      );
      if (!existingRem) {
        existingRem = family.find(
          (t) =>
            t.parentId === rootId &&
            ["WAITING", "PARTIAL"].includes(t.status)
        );
      }

      const lineCreates = openLines.map((l, i) => {
        const row = l as {
          partId?: string | null;
          description?: string;
          openQty?: number;
          uom?: string;
          unitCost?: number;
          lineNumber?: number;
        };
        return {
          partId: row.partId || undefined,
          description: row.description || "Open line",
          quantity: row.openQty || 0,
          quantityReceived: 0,
          uom: row.uom || "EA",
          lineNumber: row.lineNumber || i + 1,
          unitCost: row.unitCost || 0,
          ownership: params.isGovernmentProperty ? "GOVERNMENT" : "COMPANY",
        };
      });

      if (existingRem) {
        await prisma.receivingTravelerLine.deleteMany({
          where: { travelerId: existingRem.id },
        });
        const existing = await prisma.receivingTraveler.update({
          where: { id: existingRem.id },
          data: {
            status: "WAITING",
            openLinesSnapshot: snapshotJson("REMAINDER", openLines),
            notes: handlerNote("REMAINDER", existingRem.number),
            lines: { create: lineCreates },
          },
        });
        child = { id: existing.id, number: existing.number };
      } else {
        const number = nextChildTravelerNumber(
          rootNumber,
          family.map((t) => t.number)
        );
        const created = await prisma.receivingTraveler.create({
          data: {
            number,
            travelerType: params.travelerType || "PO",
            purchaseOrderId: purchaseOrderId || undefined,
            customerId: params.customerId || undefined,
            contractNumber: params.contractNumber || undefined,
            isGovernmentProperty: params.isGovernmentProperty || false,
            parentId: rootId,
            status: "WAITING",
            expectedDate: params.promisedDate || undefined,
            notes: handlerNote("REMAINDER", number),
            openLinesSnapshot: snapshotJson("REMAINDER", openLines),
            lines: { create: lineCreates },
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
            parentId: rootId,
            purpose: "REMAINDER",
            openLines,
            poNumber: params.poNumber,
          },
        });
      }
    }
  } else {
    for (const t of params.travelers) {
      if (
        t.status === "CLOSED" ||
        t.status === "COMPLETE" ||
        t.status === "IN_INSPECTION" ||
        t.status === "READY_TO_STOCK"
      ) {
        continue;
      }
      const next = anyReceived ? "PARTIAL" : "WAITING";
      if (t.status !== next) {
        await prisma.receivingTraveler.update({
          where: { id: t.id },
          data: {
            status: next,
            openLinesSnapshot: openLines.length
              ? snapshotJson(travelerPurpose(t), openLines)
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
