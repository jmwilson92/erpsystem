"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createWorkOrder } from "@/lib/services/work-orders";
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
 * After dock receive for a line: route inspections by workload.
 * - GD&T / visual → QA-01 (DMM / dimensional / visual — Quality)
 * - Functional (power applied) → TEST-01 (Test Center)
 * Putaway deferred until all linked inspections pass.
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
    };
  }

  const inspectionIds: string[] = [];
  let primaryWoId: string | null = null;

  async function openInspectionWo(opts: {
    area: "QA" | "TEST";
    description: string;
    estimatedMinutes: number;
    notes: string;
  }) {
    const station = await getDefaultWorkCenter(opts.area);
    const code = station?.code || (opts.area === "QA" ? "QA-01" : "TEST-01");
    const wo = await createWorkOrder({
      type: "INSPECTION",
      partId: part!.id,
      quantity: params.quantity,
      workCenter: code,
      department: opts.area,
      description: opts.description,
      travelerNotes: [
        `Receive lot ${params.lotNumber || "—"}`,
        params.plannedPutawayCode
          ? `Planned putaway: ${params.plannedPutawayCode}`
          : null,
        opts.notes,
      ]
        .filter(Boolean)
        .join(" · "),
      createdById: params.userId,
      priority: "HIGH",
      requiresInspection: true,
    });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        status: "RELEASED",
        workCenter: code,
        department: opts.area,
        estimatedMinutes: opts.estimatedMinutes,
        statusHistory: {
          create: {
            fromStatus: "PLANNED",
            toStatus: "RELEASED",
            userId: params.userId,
            notes: `Routed to ${code} (${opts.area})`,
          },
        },
      },
    });
    if (!primaryWoId) primaryWoId = wo.id;
    return { wo, code };
  }

  // If both QA + functional needed: always QA first (visual/GD&T). Functional opens after QA passes.
  // If only functional: route straight to TEST.
  if (needsGdt) {
    const { wo: qaWo, code: qaCode } = await openInspectionWo({
      area: "QA",
      description: `Receiving QA — ${part.partNumber} (visual + GD&T)`,
      estimatedMinutes: 45,
      notes: needsFunctional
        ? "QA first; functional TEST after visual/GD&T pass"
        : "QA workload: visual / GD&T",
    });

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
      workOrderId: qaWo.id,
      purchaseOrderId: params.purchaseOrderId,
      receiptId: params.receiptId,
      inventoryItemId: params.inventoryItemId,
      lotNumber: params.lotNumber,
      quantity: params.quantity,
      workCenter: qaCode,
      plannedPutawayCode: params.plannedPutawayCode,
      userId: params.userId,
      notes: needsFunctional
        ? "Receiving visual (QA) — functional TEST queued after pass"
        : "Receiving visual (QA)",
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
      workOrderId: qaWo.id,
      purchaseOrderId: params.purchaseOrderId,
      receiptId: params.receiptId,
      inventoryItemId: params.inventoryItemId,
      lotNumber: params.lotNumber,
      quantity: params.quantity,
      workCenter: qaCode,
      plannedPutawayCode: params.plannedPutawayCode,
      userId: params.userId,
      notes: "GD&T / dimensional (QA)",
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
      workOrderId: qaWo.id,
      toLocation: qaCode,
      notes: `Routed to ${qaCode} (QA) for visual + GD&T — WO ${qaWo.number}`,
      metadata: { needsFunctionalNext: needsFunctional },
      userId: params.userId,
    });
  } else if (needsFunctional) {
    // Functional only — straight to TEST
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
    if (!primaryWoId) primaryWoId = ids.workOrderId;
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
      workOrderId: f.workOrderId || undefined,
    });
  }

  // Advance QA→TEST handoff or READY_TO_STOCK (no auto putaway — back to dock)
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
    },
  });

  return {
    routedToTest: true as const,
    workOrderId: primaryWoId,
    inspectionIds,
    deferPutaway: true,
  };
}

/** Spawn powered functional inspection on default TEST station. */
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
  const wo = await createWorkOrder({
    type: "INSPECTION",
    partId: params.partId,
    quantity: params.quantity,
    workCenter: code,
    department: "TEST",
    description: `Receiving functional — ${params.partNumber} (power applied)`,
    travelerNotes: [
      `Receive lot ${params.lotNumber || "—"}`,
      params.plannedPutawayCode
        ? `Planned putaway: ${params.plannedPutawayCode}`
        : null,
      "Test: powered functional",
    ]
      .filter(Boolean)
      .join(" · "),
    createdById: params.userId,
    priority: "HIGH",
    requiresInspection: true,
  });
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      status: "RELEASED",
      workCenter: code,
      department: "TEST",
      estimatedMinutes: 60,
      statusHistory: {
        create: {
          fromStatus: "PLANNED",
          toStatus: "RELEASED",
          userId: params.userId,
          notes: `Routed to ${code} (TEST)`,
        },
      },
    },
  });

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
    workOrderId: wo.id,
    purchaseOrderId: params.purchaseOrderId,
    receiptId: params.receiptId,
    inventoryItemId: params.inventoryItemId,
    lotNumber: params.lotNumber,
    quantity: params.quantity,
    workCenter: code,
    plannedPutawayCode: params.plannedPutawayCode,
    userId: params.userId,
    notes: "Receiving functional test (power applied)",
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
    workOrderId: wo.id,
    toLocation: code,
    notes: `Routed to ${code} (TEST) for functional — WO ${wo.number}`,
    userId: params.userId,
  });

  return { workOrderId: wo.id, inspectionIds: [fn.id] };
}

async function createInspection(params: {
  type: string;
  status: string;
  partId: string;
  workOrderId: string;
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
      workOrderId: params.workOrderId,
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
  } else if (insp.workOrderId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: insp.workOrderId },
    });
    if (wo && ["RELEASED", "PLANNED"].includes(wo.status)) {
      await prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          status: "IN_PROGRESS",
          actualStart: wo.actualStart || new Date(),
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

  if (insp.workOrderId) {
    await tryCompleteReceivingTestWo({
      workOrderId: insp.workOrderId,
      userId: params.userId,
    });
  }
  if (insp.inventoryItemId) {
    await tryCompleteInventoryReceivingInspections({
      inventoryItemId: insp.inventoryItemId,
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
    await markTravelersForInventory(item.id, "IN_INSPECTION", params.userId);
    return { ready: false, spawnedFunctional: true };
  }

  // All required inspections passed — return to receiving for putaway (do not putaway here)
  await markTravelersForInventory(item.id, "READY_TO_STOCK", params.userId);

  await recordTrace({
    eventType: "READY_TO_STOCK",
    partId: item.partId,
    lotNumber: item.lotNumber,
    quantity: item.quantityOnHand,
    notes:
      "QA/Test complete — return to receiving to put away and complete traveler",
    userId: params.userId,
  });

  return { ready: true };
}

async function markTravelersForInventory(
  inventoryItemId: string,
  status: "IN_INSPECTION" | "READY_TO_STOCK",
  userId?: string
) {
  const inspections = await prisma.inspection.findMany({
    where: { inventoryItemId, receiptId: { not: null } },
    select: { receiptId: true },
  });
  const receiptIds = [
    ...new Set(
      inspections
        .map((i) => i.receiptId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (!receiptIds.length) return;

  const receipts = await prisma.receipt.findMany({
    where: { id: { in: receiptIds } },
    select: { travelerId: true },
  });
  const travelerIds = [
    ...new Set(
      receipts
        .map((r) => r.travelerId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  for (const id of travelerIds) {
    const t = await prisma.receivingTraveler.findUnique({ where: { id } });
    if (!t || ["CLOSED", "COMPLETE"].includes(t.status)) continue;
    // Don't downgrade READY_TO_STOCK back to IN_INSPECTION
    if (status === "IN_INSPECTION" && t.status === "READY_TO_STOCK") continue;
    await prisma.receivingTraveler.update({
      where: { id },
      data: { status },
    });
    await logAudit({
      entityType: "ReceivingTraveler",
      entityId: id,
      action: status,
      userId,
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
