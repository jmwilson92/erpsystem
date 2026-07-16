"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  putAwayInventory,
  recordTrace,
  refreshAllWaitingMaterial,
} from "@/lib/services/order-fulfillment";
import { getDefaultWorkCenter } from "@/lib/services/workcenters";
// Avoid circular import with supply-chain — load NCR helper on demand
async function openNcrFromInspection(
  params: Parameters<
    typeof import("@/lib/services/supply-chain").createNcrAndMrbFromInspection
  >[0]
) {
  const { createNcrAndMrbFromInspection } = await import(
    "@/lib/services/supply-chain"
  );
  return createNcrAndMrbFromInspection(params);
}

export type DocInput = {
  url: string;
  fileName?: string;
  caption?: string;
};

export type DocType =
  | "PACKING_LIST"
  | "COC"
  | "MATERIAL_CERT"
  | "DD1149"
  | "VISUAL_DOCS"
  | "GDT_DOCS"
  | "FUNCTIONAL_TEST"
  | "OTHER";

export async function saveReceivingDocuments(params: {
  docs: { docType: DocType; url: string; fileName?: string; caption?: string }[];
  partId?: string;
  receiptId?: string;
  receiptLineId?: string;
  inventoryItemId?: string;
  purchaseOrderId?: string;
  inspectionId?: string;
  lotNumber?: string;
  userId?: string;
}) {
  const created = [];
  for (const d of params.docs) {
    if (!d.url) continue;
    const row = await prisma.receivingDocument.create({
      data: {
        docType: d.docType,
        url: d.url,
        fileName: d.fileName,
        caption: d.caption || d.fileName || d.docType,
        partId: params.partId,
        receiptId: params.receiptId,
        receiptLineId: params.receiptLineId,
        inventoryItemId: params.inventoryItemId,
        purchaseOrderId: params.purchaseOrderId,
        inspectionId: params.inspectionId,
        lotNumber: params.lotNumber,
        uploadedById: params.userId,
      },
    });
    created.push(row);
  }
  return created;
}

/**
 * After dock receive for a line: open inspections on the receiving traveler
 * (no work orders). Material moves as child RCV-T travelers.
 * - GD&T / visual → QA station queue
 * - Functional (power) → Test Center queue (after QA if both required)
 * Putaway deferred until all linked inspections pass → READY_TO_STOCK.
 */
export async function routeReceivingLineForInspection(params: {
  partId: string;
  partNumber: string;
  quantity: number;
  lotNumber?: string | null;
  inventoryItemId: string;
  purchaseOrderId?: string | null;
  receiptId: string;
  receiptLineId: string;
  plannedPutawayCode?: string;
  visualResult?: "PASS" | "FAIL" | "PENDING";
  gdtResult?: "PASS" | "FAIL" | "PENDING";
  functionalResult?: "PASS" | "FAIL" | "PENDING";
  userId?: string;
}) {
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  if (!part) throw new Error("Part not found");

  const needsGdt = part.requiresGdtInspection;
  const needsFunctional = part.requiresFunctionalTest;

  if (!needsGdt && !needsFunctional) {
    return {
      routedToTest: false as const,
      workOrderId: null as string | null,
      inspectionIds: [] as string[],
      deferPutaway: false,
      station: null as "QA" | "TEST" | null,
    };
  }

  const inspectionIds: string[] = [];

  // QA first when visual/GD&T required; functional-only goes straight to TEST.
  if (needsGdt) {
    const station = await getDefaultWorkCenter("QA");
    const qaCode = station?.code || "QA-01";

    const visualStatus =
      params.visualResult === "PASS"
        ? "PASSED"
        : params.visualResult === "FAIL"
          ? "FAILED"
          : "PENDING";
    const gdtStatus =
      params.gdtResult === "PASS"
        ? "PASSED"
        : params.gdtResult === "FAIL"
          ? "FAILED"
          : "PENDING";

    const visual = await createInspection({
      type: "VISUAL",
      status: visualStatus,
      partId: part.id,
      purchaseOrderId: params.purchaseOrderId,
      receiptId: params.receiptId,
      inventoryItemId: params.inventoryItemId,
      lotNumber: params.lotNumber,
      quantity: params.quantity,
      workCenter: qaCode,
      plannedPutawayCode: params.plannedPutawayCode,
      userId: params.userId,
      notes: needsFunctional
        ? "Receiving visual (QA) — functional TEST after pass · no WO"
        : "Receiving visual (QA) · no WO",
      characteristics: [
        {
          characteristic: "Visual condition",
          specification: "No damage, correct P/N, clean",
          result:
            visualStatus === "PASSED"
              ? "PASS"
              : visualStatus === "FAILED"
                ? "FAIL"
                : "NA",
        },
      ],
    });
    inspectionIds.push(visual.id);

    const gdt = await createInspection({
      type: "GDT",
      status: gdtStatus,
      partId: part.id,
      purchaseOrderId: params.purchaseOrderId,
      receiptId: params.receiptId,
      inventoryItemId: params.inventoryItemId,
      lotNumber: params.lotNumber,
      quantity: params.quantity,
      workCenter: qaCode,
      plannedPutawayCode: params.plannedPutawayCode,
      userId: params.userId,
      notes: "GD&T / dimensional (QA) · no WO",
      characteristics: [
        {
          characteristic: "GD&T / dimensional",
          specification: "Per drawing / GD&T callouts",
          result:
            gdtStatus === "PASSED"
              ? "PASS"
              : gdtStatus === "FAILED"
                ? "FAIL"
                : "NA",
        },
      ],
    });
    inspectionIds.push(gdt.id);

    await recordTrace({
      eventType: "ROUTED_TO_QA",
      partId: part.id,
      lotNumber: params.lotNumber,
      quantity: params.quantity,
      purchaseOrderId: params.purchaseOrderId || undefined,
      toLocation: qaCode,
      notes: `Take material to ${qaCode} (QA) for visual + GD&T — stays on RCV traveler`,
      metadata: { needsFunctionalNext: needsFunctional, noWorkOrder: true },
      userId: params.userId,
    });
  } else if (needsFunctional) {
    const ids = await spawnFunctionalReceivingInspection({
      partId: part.id,
      partNumber: part.partNumber,
      quantity: params.quantity,
      lotNumber: params.lotNumber,
      inventoryItemId: params.inventoryItemId,
      purchaseOrderId: params.purchaseOrderId,
      receiptId: params.receiptId,
      plannedPutawayCode: params.plannedPutawayCode,
      functionalResult: params.functionalResult,
      userId: params.userId,
    });
    inspectionIds.push(...ids.inspectionIds);
  }

  const failed = await prisma.inspection.findMany({
    where: { id: { in: inspectionIds }, status: "FAILED" },
  });
  for (const f of failed) {
    await openNcrFromInspection({
      inspectionId: f.id,
      partId: part.id,
      quantity: params.quantity,
      lotNumber: params.lotNumber || undefined,
      createdById: params.userId,
      inventoryItemId: params.inventoryItemId,
    });
  }

  await tryCompleteInventoryReceivingInspections({
    inventoryItemId: params.inventoryItemId,
    userId: params.userId,
  });

  await logAudit({
    entityType: "InventoryItem",
    entityId: params.inventoryItemId,
    action: "RECEIVING_INSPECTIONS_ROUTED",
    userId: params.userId,
    metadata: {
      partNumber: part.partNumber,
      inspectionIds,
      needsGdt,
      needsFunctional,
      qaFirst: needsGdt && needsFunctional,
      noWorkOrder: true,
    },
  });

  return {
    routedToTest: true as const,
    workOrderId: null as string | null,
    inspectionIds,
    deferPutaway: true,
    station: (needsGdt ? "QA" : "TEST") as "QA" | "TEST",
  };
}

/** Open powered functional inspection on TEST station — no work order. */
export async function spawnFunctionalReceivingInspection(params: {
  partId: string;
  partNumber: string;
  quantity: number;
  lotNumber?: string | null;
  inventoryItemId: string;
  purchaseOrderId?: string | null;
  receiptId: string;
  plannedPutawayCode?: string;
  functionalResult?: "PASS" | "FAIL" | "PENDING";
  userId?: string;
}) {
  const station = await getDefaultWorkCenter("TEST");
  const code = station?.code || "TEST-01";

  const fnStatus =
    params.functionalResult === "PASS"
      ? "PASSED"
      : params.functionalResult === "FAIL"
        ? "FAILED"
        : "PENDING";
  const fn = await createInspection({
    type: "FUNCTIONAL",
    status: fnStatus,
    partId: params.partId,
    purchaseOrderId: params.purchaseOrderId,
    receiptId: params.receiptId,
    inventoryItemId: params.inventoryItemId,
    lotNumber: params.lotNumber,
    quantity: params.quantity,
    workCenter: code,
    plannedPutawayCode: params.plannedPutawayCode,
    userId: params.userId,
    notes: "Receiving functional test (power applied) · no WO",
    characteristics: [
      {
        characteristic: "Functional test",
        specification: "Per functional test procedure (power applied)",
        result:
          fnStatus === "PASSED"
            ? "PASS"
            : fnStatus === "FAILED"
              ? "FAIL"
              : "NA",
      },
    ],
  });

  await recordTrace({
    eventType: "ROUTED_TO_TEST",
    partId: params.partId,
    lotNumber: params.lotNumber,
    quantity: params.quantity,
    purchaseOrderId: params.purchaseOrderId || undefined,
    toLocation: code,
    notes: `Take material to ${code} (Test) for functional — stays on RCV traveler`,
    metadata: { noWorkOrder: true },
    userId: params.userId,
  });

  return { workOrderId: null as string | null, inspectionIds: [fn.id] };
}

async function createInspection(params: {
  type: string;
  status: string;
  partId: string;
  workOrderId?: string | null;
  purchaseOrderId?: string | null;
  receiptId: string;
  inventoryItemId: string;
  lotNumber?: string | null;
  quantity: number;
  workCenter: string;
  plannedPutawayCode?: string;
  userId?: string;
  notes?: string;
  characteristics: {
    characteristic: string;
    specification?: string;
    measuredValue?: string;
    result: string;
  }[];
}) {
  const count = await prisma.inspection.count();
  const number = `INSP-${String(count + 1).padStart(5, "0")}`;
  const completed =
    params.status === "PASSED" || params.status === "FAILED"
      ? new Date()
      : null;

  return prisma.inspection.create({
    data: {
      number,
      type: params.type,
      status: params.status,
      partId: params.partId,
      workOrderId: params.workOrderId || undefined,
      purchaseOrderId: params.purchaseOrderId || undefined,
      receiptId: params.receiptId,
      inventoryItemId: params.inventoryItemId,
      lotNumber: params.lotNumber || undefined,
      quantity: params.quantity,
      quantityPassed:
        params.status === "PASSED" ? params.quantity : 0,
      quantityFailed:
        params.status === "FAILED" ? params.quantity : 0,
      inspectorId:
        completed ? params.userId : undefined,
      workCenter: params.workCenter,
      plannedPutawayCode: params.plannedPutawayCode,
      notes: params.notes,
      completedAt: completed,
      results: {
        create: params.characteristics.map((c) => ({
          characteristic: c.characteristic,
          specification: c.specification,
          measuredValue: c.measuredValue,
          result: c.result,
        })),
      },
    },
  });
}

/** Complete a single VISUAL / GDT / FUNCTIONAL inspection (TEST-01 queue). */
/**
 * Post-hoc dock attestation: a RECEIVING inspection left PENDING because
 * the receiver didn't sign at the dock can be attested afterward — this
 * is the only way a doc-only receipt clears its INSP and the traveler
 * moves on to putaway.
 */
export async function attestDockAcceptance(params: {
  inspectionId: string;
  notes?: string;
  userId?: string;
}) {
  const insp = await prisma.inspection.findUnique({
    where: { id: params.inspectionId },
    include: { results: true },
  });
  if (!insp) throw new Error("Inspection not found");
  if (insp.type !== "RECEIVING") {
    throw new Error(
      "Only dock (RECEIVING) inspections can be attested — QA/Test inspections complete from their queues"
    );
  }
  if (insp.status !== "PENDING") {
    throw new Error(`Inspection already ${insp.status}`);
  }

  await prisma.inspection.update({
    where: { id: insp.id },
    data: {
      status: "PASSED",
      quantityPassed: insp.quantity,
      quantityFailed: 0,
      inspectorId: params.userId || null,
      completedAt: new Date(),
      notes: [
        "Dock acceptance attested",
        params.notes?.trim() || null,
        insp.plannedPutawayCode
          ? `putaway ${insp.plannedPutawayCode}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  });
  const visual = insp.results.find((r) =>
    r.characteristic.toLowerCase().includes("visual")
  );
  if (visual) {
    await prisma.inspectionResult.update({
      where: { id: visual.id },
      data: {
        result: "PASS",
        measuredValue: "Attested by receiver (post-receipt)",
      },
    });
  }

  await logAudit({
    entityType: "Inspection",
    entityId: insp.id,
    action: "DOCK_ATTESTED",
    userId: params.userId,
    metadata: { number: insp.number },
  });

  // Advance the traveler if everything on this material is now clear
  if (insp.inventoryItemId) {
    await tryCompleteInventoryReceivingInspections({
      inventoryItemId: insp.inventoryItemId,
      userId: params.userId,
    });
  }
  return insp.number;
}

export async function completeReceivingInspection(params: {
  inspectionId: string;
  result: "PASS" | "FAIL";
  notes?: string;
  measuredValue?: string;
  documents?: DocInput[];
  userId?: string;
}) {
  if (!params.documents?.length) {
    throw new Error(
      "Upload test / inspection documentation before Pass or Fail"
    );
  }
  const insp = await prisma.inspection.findUnique({
    where: { id: params.inspectionId },
    include: { results: true, workOrder: true },
  });
  if (!insp) throw new Error("Inspection not found");
  if (["PASSED", "FAILED", "WAIVED"].includes(insp.status)) {
    throw new Error(`Inspection already ${insp.status}`);
  }

  const status = params.result === "PASS" ? "PASSED" : "FAILED";
  const docType: DocType =
    insp.type === "FUNCTIONAL"
      ? "FUNCTIONAL_TEST"
      : insp.type === "GDT"
        ? "GDT_DOCS"
        : insp.type === "VISUAL"
          ? "VISUAL_DOCS"
          : "OTHER";

  await prisma.inspection.update({
    where: { id: insp.id },
    data: {
      status,
      quantityPassed: params.result === "PASS" ? insp.quantity : 0,
      quantityFailed: params.result === "FAIL" ? insp.quantity : 0,
      inspectorId: params.userId,
      completedAt: new Date(),
      notes: [insp.notes, params.notes].filter(Boolean).join("\n") || undefined,
    },
  });

  if (insp.results[0]) {
    await prisma.inspectionResult.update({
      where: { id: insp.results[0].id },
      data: {
        result: params.result === "PASS" ? "PASS" : "FAIL",
        measuredValue: params.measuredValue || params.result,
        notes: params.notes,
      },
    });
  }

  if (params.documents?.length) {
    await saveReceivingDocuments({
      docs: params.documents.map((d) => ({
        docType,
        url: d.url,
        fileName: d.fileName,
        caption: d.caption,
      })),
      partId: insp.partId || undefined,
      receiptId: insp.receiptId || undefined,
      inventoryItemId: insp.inventoryItemId || undefined,
      purchaseOrderId: insp.purchaseOrderId || undefined,
      inspectionId: insp.id,
      lotNumber: insp.lotNumber || undefined,
      userId: params.userId,
    });
  }

  if (params.result === "FAIL" && insp.partId) {
    await openNcrFromInspection({
      inspectionId: insp.id,
      partId: insp.partId,
      quantity: insp.quantity,
      lotNumber: insp.lotNumber || undefined,
      createdById: params.userId,
      inventoryItemId: insp.inventoryItemId || undefined,
      workOrderId: insp.workOrderId || undefined,
    });
    // Optional legacy: hold linked production WO if one exists
    if (insp.workOrderId) {
      await prisma.workOrder.update({
        where: { id: insp.workOrderId },
        data: {
          status: "ON_HOLD",
          statusHistory: {
            create: {
              fromStatus: insp.workOrder?.status,
              toStatus: "ON_HOLD",
              userId: params.userId,
              notes: `${insp.type} failed — held for MRB`,
            },
          },
        },
      });
    }
  }

  await recordTrace({
    eventType: "INSPECTION",
    partId: insp.partId,
    lotNumber: insp.lotNumber,
    quantity: insp.quantity,
    purchaseOrderId: insp.purchaseOrderId,
    workOrderId: insp.workOrderId,
    inspectionId: insp.id,
    notes: `${insp.type} ${status}${params.notes ? ` — ${params.notes}` : ""}`,
    userId: params.userId,
  });

  // Receiving material lives on RCV travelers — advance via inventory item
  if (insp.inventoryItemId) {
    await tryCompleteInventoryReceivingInspections({
      inventoryItemId: insp.inventoryItemId,
      userId: params.userId,
    });
  } else if (insp.workOrderId) {
    // Legacy inspection WOs (if any remain)
    await tryCompleteReceivingTestWo({
      workOrderId: insp.workOrderId,
      userId: params.userId,
    });
  }

  await logAudit({
    entityType: "Inspection",
    entityId: insp.id,
    action: status,
    userId: params.userId,
    metadata: { type: insp.type, result: params.result },
  });

  return { status };
}

/**
 * Complete a single inspection WO when its own inspections are done.
 * Putaway only when ALL inspections for the inventory item pass (QA + Test).
 */
export async function tryCompleteReceivingTestWo(params: {
  workOrderId: string;
  userId?: string;
}) {
  const inspections = await prisma.inspection.findMany({
    where: { workOrderId: params.workOrderId },
  });
  if (inspections.length === 0) return { completed: false };

  const pending = inspections.filter((i) =>
    ["PENDING", "IN_PROGRESS"].includes(i.status)
  );
  if (pending.length > 0) return { completed: false, pending: pending.length };

  const anyFail = inspections.some((i) => i.status === "FAILED");
  if (anyFail) {
    await prisma.workOrder.update({
      where: { id: params.workOrderId },
      data: {
        status: "ON_HOLD",
        notes: "Receiving inspection failed — see NCR/MRB",
      },
    });
    return { completed: false, failed: true };
  }

  await prisma.workOrder.update({
    where: { id: params.workOrderId },
    data: {
      status: "COMPLETED",
      quantityCompleted: inspections[0]?.quantity || 1,
      actualEnd: new Date(),
      statusHistory: {
        create: {
          toStatus: "COMPLETED",
          userId: params.userId,
          notes: "Receiving inspections for this workcenter complete",
        },
      },
    },
  });

  const invIds = [
    ...new Set(
      inspections
        .map((i) => i.inventoryItemId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  for (const inventoryItemId of invIds) {
    await tryCompleteInventoryReceivingInspections({
      inventoryItemId,
      userId: params.userId,
    });
  }

  return { completed: true };
}

/**
 * After QA (and optionally TEST) inspections settle:
 * - If QA done and part still needs functional → spawn TEST WO
 * - If all done → READY_TO_STOCK on traveler (dock completes putaway — no auto putaway)
 */
export async function tryCompleteInventoryReceivingInspections(params: {
  inventoryItemId: string;
  userId?: string;
}) {
  const inspections = await prisma.inspection.findMany({
    where: { inventoryItemId: params.inventoryItemId },
  });
  if (inspections.length === 0) return { ready: false };

  const pending = inspections.filter((i) =>
    ["PENDING", "IN_PROGRESS"].includes(i.status)
  );
  if (pending.length > 0) return { ready: false, pending: pending.length };

  if (inspections.some((i) => i.status === "FAILED")) {
    return { ready: false, failed: true };
  }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: params.inventoryItemId },
    include: { part: true },
  });
  if (!item?.part) return { ready: false };

  const hasFunctional = inspections.some((i) => i.type === "FUNCTIONAL");
  const hasQa = inspections.some((i) =>
    ["VISUAL", "GDT"].includes(i.type)
  );

  // QA first path: after visual/GD&T pass, open functional if still required
  if (
    item.part.requiresFunctionalTest &&
    !hasFunctional &&
    hasQa
  ) {
    const sample = inspections[0];
    await spawnFunctionalReceivingInspection({
      partId: item.partId,
      partNumber: item.part.partNumber,
      quantity: sample.quantity || item.quantityOnHand,
      lotNumber: item.lotNumber,
      inventoryItemId: item.id,
      purchaseOrderId: sample.purchaseOrderId,
      receiptId: sample.receiptId || "",
      plannedPutawayCode: sample.plannedPutawayCode || undefined,
      userId: params.userId,
    });
    await markTravelersForInventory(
      item.id,
      "IN_INSPECTION",
      params.userId,
      "TEST"
    );
    return { ready: false, spawnedFunctional: true };
  }

  // All required inspections passed — return to receiving for putaway (do not putaway here)
  await markTravelersForInventory(
    item.id,
    "READY_TO_STOCK",
    params.userId,
    "DOCK"
  );

  await recordTrace({
    eventType: "READY_TO_STOCK",
    partId: item.partId,
    lotNumber: item.lotNumber,
    quantity: item.quantityOnHand,
    notes:
      "QA/Test complete — take RCV traveler back to dock to put away",
    userId: params.userId,
  });

  return { ready: true };
}

async function markTravelersForInventory(
  inventoryItemId: string,
  status: "IN_INSPECTION" | "READY_TO_STOCK",
  userId?: string,
  stationHint?: "QA" | "TEST" | "DOCK"
) {
  const inspections = await prisma.inspection.findMany({
    where: { inventoryItemId, receiptId: { not: null } },
    select: { receiptId: true, type: true, status: true, workCenter: true },
  });
  const receiptIds = [
    ...new Set(
      inspections
        .map((i) => i.receiptId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const travelerIdSet = new Set<string>();

  if (receiptIds.length) {
    const receipts = await prisma.receipt.findMany({
      where: { id: { in: receiptIds } },
      select: { travelerId: true },
    });
    for (const r of receipts) {
      if (r.travelerId) travelerIdSet.add(r.travelerId);
    }
  }

  // Also match children that own this inventory via openLinesSnapshot
  // (used when one receipt has both QA and TEST functional children).
  const snapHits = await prisma.receivingTraveler.findMany({
    where: {
      status: {
        in: ["WAITING", "PARTIAL", "IN_INSPECTION", "READY_TO_STOCK"],
      },
      openLinesSnapshot: { contains: inventoryItemId },
    },
    select: { id: true },
  });
  for (const t of snapHits) travelerIdSet.add(t.id);

  if (!travelerIdSet.size) return;

  for (const id of travelerIdSet) {
    const t = await prisma.receivingTraveler.findUnique({ where: { id } });
    if (!t || ["CLOSED", "COMPLETE"].includes(t.status)) continue;
    // Don't downgrade READY_TO_STOCK back to IN_INSPECTION
    if (status === "IN_INSPECTION" && t.status === "READY_TO_STOCK") continue;

    // Only move the child that actually owns this inventory when possible
    const owns =
      !t.openLinesSnapshot ||
      t.openLinesSnapshot.includes(inventoryItemId) ||
      !t.parentId;
    if (t.parentId && t.openLinesSnapshot && !owns) continue;

    // Status drives the job — child is not “the QA dash” or “the Test dash”
    let notes = t.notes || "";
    if (status === "READY_TO_STOCK") {
      notes = `${t.number} · BACK TO DOCK — inspections complete. Put away to stock.`;
    } else if (stationHint === "TEST") {
      notes = `${t.number} · In process — functional / power still open, then put away.`;
    } else if (stationHint === "QA") {
      notes = `${t.number} · In process — visual / GD&T still open (then any further tests), then put away.`;
    }

    await prisma.receivingTraveler.update({
      where: { id },
      data: {
        status,
        notes,
        openLinesSnapshot:
          status === "READY_TO_STOCK"
            ? JSON.stringify({
                purpose: "CHILD",
                inventoryItemIds: [inventoryItemId],
              })
            : t.openLinesSnapshot,
      },
    });
    await logAudit({
      entityType: "ReceivingTraveler",
      entityId: id,
      action: status,
      userId,
      metadata: { stationHint, inventoryItemId },
    });
  }
}

/** Dock putaway after READY_TO_STOCK — completes material stock and traveler. */
export async function completeReceivingAfterInspection(params: {
  travelerId: string;
  putawayLocationCode: string;
  userId?: string;
}) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: params.travelerId },
    include: {
      receipts: { include: { lines: true } },
      lines: true,
      purchaseOrder: { include: { lines: true } },
    },
  });
  if (!traveler) throw new Error("Traveler not found");
  if (traveler.status !== "READY_TO_STOCK") {
    throw new Error(
      `Traveler is ${traveler.status} — complete QA/Test first, then put away at receiving`
    );
  }

  // Put away all RECEIVING stock linked to this traveler's receipts
  const receiptIds = traveler.receipts.map((r) => r.id);
  const inspections = await prisma.inspection.findMany({
    where: {
      receiptId: { in: receiptIds },
      inventoryItemId: { not: null },
      status: "PASSED",
    },
    select: { inventoryItemId: true, plannedPutawayCode: true },
  });
  const invIds = [
    ...new Set(
      inspections
        .map((i) => i.inventoryItemId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  for (const inventoryItemId of invIds) {
    const planned = inspections.find(
      (i) => i.inventoryItemId === inventoryItemId
    )?.plannedPutawayCode;
    await putAwayInventory({
      inventoryItemId,
      userId: params.userId,
      capturePhotos: false,
      targetLocationCode: params.putawayLocationCode || planned || undefined,
    });
  }

  await prisma.receivingTraveler.update({
    where: { id: traveler.id },
    data: { status: "COMPLETE" },
  });

  // If PO fully qty-received and no open inspection travelers, leave PO as RECEIVED
  if (traveler.purchaseOrderId) {
    const po = traveler.purchaseOrder;
    if (po) {
      const allQty = po.lines.every((l) => l.quantityReceived >= l.quantity);
      const openInsp = await prisma.receivingTraveler.count({
        where: {
          purchaseOrderId: po.id,
          status: { in: ["WAITING", "PARTIAL", "IN_INSPECTION", "READY_TO_STOCK"] },
        },
      });
      if (allQty && openInsp === 0) {
        // ok
      }
    }
  }

  await refreshAllWaitingMaterial(params.userId);

  // Receive→kit handoff: freshly stocked material may complete a WO's
  // BOM — open kit travelers for anything now ready inside its window.
  try {
    const { sweepKitReadiness } = await import("@/lib/services/kitting");
    await sweepKitReadiness(params.userId);
  } catch {
    /* advisory — never block putaway */
  }

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "COMPLETE_AFTER_INSPECTION",
    userId: params.userId,
    metadata: { putaway: params.putawayLocationCode },
  });

  return { status: "COMPLETE" };
}

export async function updatePartInspectionFlags(params: {
  partId: string;
  requiresGdtInspection: boolean;
  requiresFunctionalTest: boolean;
  userId?: string;
}) {
  const part = await prisma.part.update({
    where: { id: params.partId },
    data: {
      requiresGdtInspection: params.requiresGdtInspection,
      requiresFunctionalTest: params.requiresFunctionalTest,
    },
  });
  await logAudit({
    entityType: "Part",
    entityId: part.id,
    action: "ITEM_FLAGS_UPDATED",
    userId: params.userId,
    metadata: {
      requiresGdtInspection: params.requiresGdtInspection,
      requiresFunctionalTest: params.requiresFunctionalTest,
    },
  });
  return part;
}



export async function listOpenTestInspections() {
  return prisma.inspection.findMany({
    where: {
      workCenter: "TEST-01",
      status: { in: ["PENDING", "IN_PROGRESS"] },
      type: { in: ["VISUAL", "GDT", "FUNCTIONAL"] },
    },
    include: {
      workOrder: { select: { id: true, number: true, status: true } },
      results: true,
      documents: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
