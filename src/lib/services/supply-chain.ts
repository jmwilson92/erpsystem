"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Core integrated flow:
 * PO Receipt → Inventory + Incoming Inspection → NCR/MRB if fail → Quarantine → Scorecard update
 */

export async function receivePurchaseOrder(params: {
  purchaseOrderId: string;
  lines: {
    poLineId: string;
    quantityReceived: number;
    lotNumber?: string;
    serialNumbers?: string[];
  }[];
  receivedById?: string;
  packingSlip?: string;
  notes?: string;
  failInspection?: boolean; // demo hook to force inspection failure
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: { lines: true, supplier: true },
  });
  if (!po) throw new Error("Purchase order not found");

  const receiptCount = await prisma.receipt.count();
  const receiptNumber = `RCV-${String(receiptCount + 1).padStart(5, "0")}`;

  const receipt = await prisma.receipt.create({
    data: {
      number: receiptNumber,
      purchaseOrderId: po.id,
      receivedById: params.receivedById,
      packingSlip: params.packingSlip,
      notes: params.notes,
      status: "COMPLETE",
      lines: {
        create: params.lines.map((l) => {
          const poLine = po.lines.find((pl) => pl.id === l.poLineId);
          return {
            poLineId: l.poLineId,
            partId: poLine?.partId,
            description: poLine?.description || "Item",
            quantityOrdered: poLine?.quantity || l.quantityReceived,
            quantityReceived: l.quantityReceived,
            lotNumber: l.lotNumber,
            serialNumbers: l.serialNumbers ? JSON.stringify(l.serialNumbers) : null,
            unitCost: poLine?.unitCost || 0,
          };
        }),
      },
    },
    include: { lines: true },
  });

  // Update PO line quantities
  for (const line of params.lines) {
    const poLine = po.lines.find((pl) => pl.id === line.poLineId);
    if (!poLine) continue;
    const newQty = poLine.quantityReceived + line.quantityReceived;
    await prisma.purchaseOrderLine.update({
      where: { id: poLine.id },
      data: { quantityReceived: newQty },
    });
  }

  // Refresh PO lines to determine status
  const updatedLines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po.id },
  });
  const allReceived = updatedLines.every((l) => l.quantityReceived >= l.quantity);
  const anyReceived = updatedLines.some((l) => l.quantityReceived > 0);
  const newStatus = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL_RECEIPT" : po.status;

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: newStatus },
  });

  // Find receiving location
  const receivingLoc =
    (await prisma.location.findFirst({ where: { type: "RECEIVING" } })) ||
    (await prisma.location.findFirst());

  // Create inventory and inspections for each line
  const inspectionResults: { inspectionId: string; status: string; ncrId?: string; mrbId?: string }[] = [];

  for (const line of receipt.lines) {
    if (!line.partId || !receivingLoc) continue;

    const existing = await prisma.inventoryItem.findFirst({
      where: {
        partId: line.partId,
        locationId: receivingLoc.id,
        lotNumber: line.lotNumber || null,
      },
    });

    let invItem;
    if (existing) {
      invItem = await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantityOnHand: existing.quantityOnHand + line.quantityReceived,
          quantityAvailable: existing.quantityAvailable + line.quantityReceived,
          unitCost: line.unitCost,
        },
      });
    } else {
      invItem = await prisma.inventoryItem.create({
        data: {
          partId: line.partId,
          locationId: receivingLoc.id,
          quantityOnHand: line.quantityReceived,
          quantityAvailable: line.quantityReceived,
          lotNumber: line.lotNumber,
          unitCost: line.unitCost,
          ownership: "COMPANY",
        },
      });
    }

    await prisma.materialTransaction.create({
      data: {
        type: "RECEIPT",
        partId: line.partId,
        inventoryItemId: invItem.id,
        purchaseOrderId: po.id,
        quantity: line.quantityReceived,
        unitCost: line.unitCost,
        toLocation: receivingLoc.code,
        lotNumber: line.lotNumber,
        reference: receipt.number,
        userId: params.receivedById,
      },
    });

    // Create incoming inspection
    const inspCount = await prisma.inspection.count();
    const inspNumber = `INSP-${String(inspCount + 1).padStart(5, "0")}`;
    const fail = params.failInspection === true;

    const inspection = await prisma.inspection.create({
      data: {
        number: inspNumber,
        type: "RECEIVING",
        status: fail ? "FAILED" : "PASSED",
        partId: line.partId,
        purchaseOrderId: po.id,
        inventoryItemId: invItem.id,
        lotNumber: line.lotNumber,
        quantity: line.quantityReceived,
        quantityPassed: fail ? 0 : line.quantityReceived,
        quantityFailed: fail ? line.quantityReceived : 0,
        inspectorId: params.receivedById,
        completedAt: new Date(),
        notes: fail ? "Dimensional non-conformance detected on receipt" : "Incoming inspection passed",
        results: {
          create: [
            {
              characteristic: "Visual",
              specification: "No damage, correct P/N",
              measuredValue: fail ? "Surface defect" : "OK",
              result: fail ? "FAIL" : "PASS",
            },
            {
              characteristic: "Dimensional",
              specification: "Per drawing",
              measuredValue: fail ? "Out of tolerance +0.015" : "Within tolerance",
              result: fail ? "FAIL" : "PASS",
            },
            {
              characteristic: "Documentation",
              specification: "CoC / packing slip",
              measuredValue: "Present",
              result: "PASS",
            },
          ],
        },
      },
    });

    let ncrId: string | undefined;
    let mrbId: string | undefined;

    if (fail) {
      // Create NCR → MRB → Quarantine inventory → Update scorecard
      const result = await createNcrAndMrbFromInspection({
        inspectionId: inspection.id,
        partId: line.partId,
        supplierId: po.supplierId,
        quantity: line.quantityReceived,
        lotNumber: line.lotNumber || undefined,
        createdById: params.receivedById,
        inventoryItemId: invItem.id,
      });
      ncrId = result.ncrId;
      mrbId = result.mrbId;
    }

    inspectionResults.push({
      inspectionId: inspection.id,
      status: inspection.status,
      ncrId,
      mrbId,
    });
  }

  await updateSupplierScorecard(po.supplierId);

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "RECEIVED",
    userId: params.receivedById,
    metadata: {
      receiptNumber: receipt.number,
      lines: params.lines.length,
      inspections: inspectionResults,
    },
  });

  return { receipt, poStatus: newStatus, inspections: inspectionResults };
}

export async function createNcrAndMrbFromInspection(params: {
  inspectionId: string;
  partId: string;
  supplierId?: string | null;
  quantity: number;
  lotNumber?: string;
  serialNumber?: string;
  createdById?: string;
  inventoryItemId?: string;
  workOrderId?: string;
}) {
  const ncrCount = await prisma.nonConformance.count();
  const ncrNumber = `NCR-${String(ncrCount + 1).padStart(5, "0")}`;

  const ncr = await prisma.nonConformance.create({
    data: {
      number: ncrNumber,
      title: `Receiving non-conformance — Inspection failed`,
      description:
        "Material failed incoming inspection. Held pending Material Review Board disposition.",
      status: "MRB",
      severity: "MAJOR",
      source: "RECEIVING",
      partId: params.partId,
      inspectionId: params.inspectionId,
      supplierId: params.supplierId,
      workOrderId: params.workOrderId,
      quantity: params.quantity,
      lotNumber: params.lotNumber,
      serialNumber: params.serialNumber,
      createdById: params.createdById,
    },
  });

  const mrbCount = await prisma.mrbCase.count();
  const mrbNumber = `MRB-${String(mrbCount + 1).padStart(5, "0")}`;

  const mrb = await prisma.mrbCase.create({
    data: {
      number: mrbNumber,
      ncrId: ncr.id,
      status: "OPEN",
      chairId: params.createdById,
      notes: "Auto-created from failed receiving inspection",
    },
  });

  // Quarantine inventory
  if (params.inventoryItemId) {
    const quarantineLoc = await prisma.location.findFirst({
      where: { type: "QUARANTINE" },
    });
    const item = await prisma.inventoryItem.findUnique({
      where: { id: params.inventoryItemId },
    });
    if (item) {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityQuarantine: item.quantityOnHand,
          quantityAvailable: 0,
          mrbCaseId: mrb.id,
          ...(quarantineLoc ? { locationId: quarantineLoc.id } : {}),
        },
      });
      await prisma.materialTransaction.create({
        data: {
          type: "QUARANTINE",
          partId: params.partId,
          inventoryItemId: item.id,
          quantity: item.quantityOnHand,
          toLocation: quarantineLoc?.code || "QUAR",
          lotNumber: params.lotNumber,
          reference: mrb.number,
          notes: "Held for MRB",
          userId: params.createdById,
        },
      });
    }
  }

  await logAudit({
    entityType: "NonConformance",
    entityId: ncr.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: { mrbNumber: mrb.number, inspectionId: params.inspectionId },
  });

  await logAudit({
    entityType: "MrbCase",
    entityId: mrb.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: { ncrNumber: ncr.number },
  });

  return { ncrId: ncr.id, mrbId: mrb.id, ncrNumber: ncr.number, mrbNumber: mrb.number };
}

export async function dispositionMrb(params: {
  mrbCaseId: string;
  disposition: "USE_AS_IS" | "REWORK" | "SCRAP" | "RETURN_TO_SUPPLIER" | "REPAIR";
  quantity: number;
  justification: string;
  decidedById?: string;
  createCar?: boolean;
}) {
  const mrb = await prisma.mrbCase.findUnique({
    where: { id: params.mrbCaseId },
    include: { ncr: true, inventoryHolds: true },
  });
  if (!mrb) throw new Error("MRB case not found");

  const carNumber = params.createCar
    ? `CAR-${String((await prisma.mrbDisposition.count()) + 1).padStart(5, "0")}`
    : null;

  const disposition = await prisma.mrbDisposition.create({
    data: {
      mrbCaseId: mrb.id,
      disposition: params.disposition,
      quantity: params.quantity,
      justification: params.justification,
      decidedById: params.decidedById,
      carNumber,
      carStatus: carNumber ? "OPEN" : null,
    },
  });

  // Update inventory based on disposition
  for (const item of mrb.inventoryHolds) {
    if (params.disposition === "SCRAP") {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: 0,
          quantityAvailable: 0,
          quantityQuarantine: 0,
          mrbCaseId: null,
        },
      });
      await prisma.materialTransaction.create({
        data: {
          type: "SCRAP",
          partId: item.partId,
          inventoryItemId: item.id,
          quantity: params.quantity,
          reference: mrb.number,
          notes: params.justification,
          userId: params.decidedById,
        },
      });
    } else if (params.disposition === "USE_AS_IS" || params.disposition === "REPAIR") {
      const storageLoc = await prisma.location.findFirst({
        where: { type: "STORAGE" },
      });
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityAvailable: item.quantityOnHand,
          quantityQuarantine: 0,
          mrbCaseId: null,
          ...(storageLoc ? { locationId: storageLoc.id } : {}),
        },
      });
      await prisma.materialTransaction.create({
        data: {
          type: "RELEASE",
          partId: item.partId,
          inventoryItemId: item.id,
          quantity: item.quantityOnHand,
          reference: mrb.number,
          notes: `Released after ${params.disposition}`,
          userId: params.decidedById,
        },
      });
    } else if (params.disposition === "RETURN_TO_SUPPLIER") {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: 0,
          quantityAvailable: 0,
          quantityQuarantine: 0,
          mrbCaseId: null,
        },
      });
      await prisma.materialTransaction.create({
        data: {
          type: "TRANSFER",
          partId: item.partId,
          inventoryItemId: item.id,
          quantity: params.quantity,
          reference: mrb.number,
          notes: "Return to supplier",
          userId: params.decidedById,
        },
      });
    }
    // REWORK leaves in quarantine / WIP path
  }

  await prisma.mrbCase.update({
    where: { id: mrb.id },
    data: { status: "DISPOSITIONED", closedAt: new Date() },
  });

  await prisma.nonConformance.update({
    where: { id: mrb.ncrId },
    data: {
      status: "DISPOSITIONED",
      rootCause: params.justification,
    },
  });

  if (mrb.ncr.supplierId) {
    await updateSupplierScorecard(mrb.ncr.supplierId);
  }

  await logAudit({
    entityType: "MrbCase",
    entityId: mrb.id,
    action: "DISPOSITIONED",
    userId: params.decidedById,
    changes: {
      disposition: params.disposition,
      quantity: params.quantity,
      carNumber,
    },
  });

  return disposition;
}

export async function updateSupplierScorecard(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return;

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      supplierId,
      status: { in: ["RECEIVED", "PARTIAL_RECEIPT", "CLOSED", "INVOICED", "ACKNOWLEDGED", "ISSUED"] },
    },
    include: { receipts: true, lines: true },
  });

  let onTime = 0;
  let totalWithPromise = 0;
  for (const po of pos) {
    if (!po.promisedDate) continue;
    totalWithPromise++;
    const lastReceipt = po.receipts.sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()
    )[0];
    if (lastReceipt && lastReceipt.receivedAt <= po.promisedDate) onTime++;
    else if (!lastReceipt && new Date() <= po.promisedDate) onTime++;
  }
  const onTimeDeliveryPct =
    totalWithPromise > 0 ? (onTime / totalWithPromise) * 100 : supplier.onTimeDeliveryPct;

  const ncrs = await prisma.nonConformance.findMany({
    where: { supplierId },
  });
  const totalReceived = pos.reduce(
    (sum, po) => sum + po.lines.reduce((s, l) => s + l.quantityReceived, 0),
    0
  );
  const failedQty = ncrs.reduce((s, n) => s + n.quantity, 0);
  const qualityPpm = totalReceived > 0 ? (failedQty / totalReceived) * 1_000_000 : 0;

  // Cost variance from PO lines vs standard (simplified)
  const costVariancePct = supplier.costVariancePct;

  // Weighted score: OTD 40%, Quality 40%, Cost 20%
  const qualityScore = Math.max(0, 100 - qualityPpm / 100);
  const costScore = Math.max(0, 100 - Math.abs(costVariancePct));
  const overallScore =
    onTimeDeliveryPct * 0.4 + qualityScore * 0.4 + costScore * 0.2;

  let rating = "A";
  if (overallScore < 60) rating = "F";
  else if (overallScore < 70) rating = "D";
  else if (overallScore < 80) rating = "C";
  else if (overallScore < 90) rating = "B";

  await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      onTimeDeliveryPct: Math.round(onTimeDeliveryPct * 10) / 10,
      qualityPpm: Math.round(qualityPpm),
      overallScore: Math.round(overallScore * 10) / 10,
      rating,
    },
  });

  const period = new Date().toISOString().slice(0, 7);
  const existing = await prisma.supplierScorecardHistory.findFirst({
    where: { supplierId, period },
  });
  if (existing) {
    await prisma.supplierScorecardHistory.update({
      where: { id: existing.id },
      data: {
        onTimeDeliveryPct: Math.round(onTimeDeliveryPct * 10) / 10,
        qualityPpm: Math.round(qualityPpm),
        costVariancePct,
        overallScore: Math.round(overallScore * 10) / 10,
        rating,
        ncrCount: ncrs.length,
        poCount: pos.length,
      },
    });
  } else {
    await prisma.supplierScorecardHistory.create({
      data: {
        supplierId,
        period,
        onTimeDeliveryPct: Math.round(onTimeDeliveryPct * 10) / 10,
        qualityPpm: Math.round(qualityPpm),
        costVariancePct,
        overallScore: Math.round(overallScore * 10) / 10,
        rating,
        ncrCount: ncrs.length,
        poCount: pos.length,
      },
    });
  }

  return { overallScore, rating, onTimeDeliveryPct, qualityPpm };
}

export async function getValueStreamMetrics() {
  const [
    openPos,
    pendingReceipts,
    openInspections,
    openMrb,
    inventoryAgg,
    activeWos,
    openShipments,
    suppliers,
  ] = await Promise.all([
    prisma.purchaseOrder.count({
      where: { status: { in: ["ISSUED", "ACKNOWLEDGED", "APPROVED"] } },
    }),
    prisma.purchaseOrder.count({
      where: { status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"] } },
    }),
    prisma.inspection.count({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    }),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.inventoryItem.aggregate({
      _sum: {
        quantityOnHand: true,
        quantityQuarantine: true,
        quantityCommitted: true,
      },
    }),
    prisma.workOrder.count({
      where: { status: { in: ["RELEASED", "IN_PROGRESS"] } },
    }),
    prisma.shipment.count({
      where: { status: { in: ["DRAFT", "PICKING", "PACKED"] } },
    }),
    prisma.supplier.findMany({
      select: {
        onTimeDeliveryPct: true,
        overallScore: true,
        rating: true,
      },
    }),
  ]);

  const wipValue = await prisma.workOrder.aggregate({
    where: { status: { in: ["RELEASED", "IN_PROGRESS", "ON_HOLD"] } },
    _sum: { actualCost: true, standardCost: true },
  });

  const avgOtd =
    suppliers.length > 0
      ? suppliers.reduce((s, x) => s + x.onTimeDeliveryPct, 0) / suppliers.length
      : 0;
  const avgScore =
    suppliers.length > 0
      ? suppliers.reduce((s, x) => s + x.overallScore, 0) / suppliers.length
      : 0;

  return {
    stages: [
      {
        key: "SUPPLIER",
        label: "Suppliers",
        metrics: [
          { label: "Avg OTD", value: Math.round(avgOtd * 10) / 10, unit: "%" },
          { label: "Avg Score", value: Math.round(avgScore * 10) / 10, unit: "" },
        ],
        status: avgOtd >= 90 ? "healthy" : avgOtd >= 75 ? "watch" : "constraint",
      },
      {
        key: "PO",
        label: "Purchase Orders",
        metrics: [
          { label: "Open POs", value: openPos, unit: "" },
          { label: "Awaiting Receipt", value: pendingReceipts, unit: "" },
        ],
        status: openPos > 20 ? "watch" : "healthy",
      },
      {
        key: "RECEIVING",
        label: "Receiving",
        metrics: [{ label: "Pending", value: pendingReceipts, unit: "" }],
        status: "healthy",
      },
      {
        key: "INSPECTION",
        label: "Incoming Inspection",
        metrics: [{ label: "Open", value: openInspections, unit: "" }],
        status: openInspections > 5 ? "watch" : "healthy",
      },
      {
        key: "MRB",
        label: "MRB / Hold",
        metrics: [
          { label: "Open Cases", value: openMrb, unit: "" },
          {
            label: "Quarantine Qty",
            value: inventoryAgg._sum.quantityQuarantine || 0,
            unit: "",
          },
        ],
        status: openMrb > 0 ? "constraint" : "healthy",
      },
      {
        key: "INVENTORY",
        label: "Inventory",
        metrics: [
          {
            label: "On Hand",
            value: Math.round(inventoryAgg._sum.quantityOnHand || 0),
            unit: "",
          },
          {
            label: "Committed",
            value: Math.round(inventoryAgg._sum.quantityCommitted || 0),
            unit: "",
          },
        ],
        status: "healthy",
      },
      {
        key: "PRODUCTION",
        label: "Production",
        metrics: [
          { label: "Active WOs", value: activeWos, unit: "" },
          {
            label: "WIP $",
            value: Math.round(wipValue._sum.actualCost || wipValue._sum.standardCost || 0),
            unit: "$",
          },
        ],
        status: activeWos > 15 ? "watch" : "healthy",
      },
      {
        key: "SHIPPING",
        label: "Shipping",
        metrics: [{ label: "In Queue", value: openShipments, unit: "" }],
        status: "healthy",
      },
    ],
  };
}
