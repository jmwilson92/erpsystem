"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  captureReceivingPhotos,
  putAwayInventory,
  recordTrace,
  refreshAllWaitingMaterial,
} from "@/lib/services/order-fulfillment";
import {
  routeReceivingLineForInspection,
  saveReceivingDocuments,
  type DocType,
} from "@/lib/services/receiving-inspection";
import { isGfpLocation } from "@/lib/utils";

/**
 * Core integrated flow:
 * PO Receipt → packing/CoC/certs → photos →
 *   Part flags GD&T / Functional → TEST-01 queue (defer putaway)
 *   No flags → putaway to selected stock area
 *   FAIL → NCR/MRB + Quarantine → Scorecard update
 */

export async function receivePurchaseOrder(params: {
  purchaseOrderId: string;
  lines: {
    poLineId: string;
    quantityReceived: number;
    lotNumber?: string;
    serialNumbers?: string[];
    /** Per-line photos from dock form */
    photos?: { url: string; caption?: string }[];
    visualResult?: "PASS" | "FAIL" | "PENDING";
    gdtResult?: "PASS" | "FAIL" | "PENDING";
    functionalResult?: "PASS" | "FAIL" | "PENDING";
    visualDocs?: { url: string; fileName?: string; caption?: string }[];
    gdtDocs?: { url: string; fileName?: string; caption?: string }[];
    functionalDocs?: { url: string; fileName?: string; caption?: string }[];
  }[];
  receivedById?: string;
  /** Dock person explicitly attested the visual/count/documentation check. */
  receivingAck?: boolean;
  packingSlip?: string;
  notes?: string;
  failInspection?: boolean; // demo hook to force inspection failure
  /** Stock area after pass (or planned putaway when routed to TEST-01). */
  putawayLocationCode?: string;
  /** Shared photos applied to every line if line-level photos omitted */
  photos?: { url: string; caption?: string }[];
  /** Receipt-level paperwork */
  packingListDocs?: { url: string; fileName?: string; caption?: string }[];
  cocDocs?: { url: string; fileName?: string; caption?: string }[];
  materialCertDocs?: { url: string; fileName?: string; caption?: string }[];
  /** DD Form 1149 — required when PO or item is government property */
  dd1149Docs?: { url: string; fileName?: string; caption?: string }[];
  travelerId?: string;
  /** Owning government contract (required when material is GFP) */
  contractNumber?: string;
  /** Per-line government property numbers keyed by poLineId */
  govPropNumbers?: Record<string, string>;
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: {
      lines: { include: { part: true } },
      supplier: true,
    },
  });
  if (!po) throw new Error("Purchase order not found");

  // Validate quantities — allow partials, never exceed open qty
  const receiveLines = params.lines.filter((l) => l.quantityReceived > 0);
  if (receiveLines.length === 0) throw new Error("Nothing to receive — enter qty > 0");

  for (const line of receiveLines) {
    const poLine = po.lines.find((pl) => pl.id === line.poLineId);
    if (!poLine) throw new Error(`Unknown PO line ${line.poLineId}`);
    const open = poLine.quantity - poLine.quantityReceived;
    if (line.quantityReceived > open + 0.0001) {
      throw new Error(
        `Cannot receive ${line.quantityReceived} on "${poLine.description}" — only ${open} open`
      );
    }
  }

  const putawayLoc = params.putawayLocationCode
    ? await prisma.location.findFirst({
        where: { code: params.putawayLocationCode },
      })
    : null;
  const travelerRow = params.travelerId
    ? await prisma.receivingTraveler.findUnique({
        where: { id: params.travelerId },
        select: {
          isGovernmentProperty: true,
          travelerType: true,
          purchaseOrderId: true,
        },
      })
    : null;

  // Gov prop ONLY when docked on a GFP receiving traveler (not PO putaway/PO flag)
  const receivingGovt =
    !!travelerRow &&
    (travelerRow.isGovernmentProperty ||
      travelerRow.travelerType === "CUSTOMER_GFP" ||
      travelerRow.travelerType === "DIRECT_GFP" ||
      !travelerRow.purchaseOrderId);

  // Will any line route to QA/TEST? (planned putaway only — stock after tests return to dock)
  const willRouteInspect = po.lines.some((pl) => {
    if (!receiveLines.find((l) => l.poLineId === pl.id)) return false;
    return (
      !!pl.part?.requiresGdtInspection || !!pl.part?.requiresFunctionalTest
    );
  });

  if (!params.failInspection && !willRouteInspect && !params.putawayLocationCode) {
    throw new Error(
      "Select a putaway / stocking location before receiving (where is this going?)"
    );
  }

  if (receivingGovt && !params.failInspection) {
    if (!params.dd1149Docs?.length) {
      throw new Error("DD Form 1149 is required on GFP receiving travelers.");
    }
    if (!params.contractNumber?.trim()) {
      throw new Error(
        "Contract number is required — which government contract owns this property?"
      );
    }
  }

  const receiptCount = await prisma.receipt.count();
  const receiptNumber = `RCV-${String(receiptCount + 1).padStart(5, "0")}`;

  // Determine if this receive is a partial against the full PO
  const wouldBeFull = po.lines.every((pl) => {
    const recv = receiveLines.find((l) => l.poLineId === pl.id);
    const add = recv?.quantityReceived || 0;
    return pl.quantityReceived + add >= pl.quantity;
  });

  const receipt = await prisma.receipt.create({
    data: {
      number: receiptNumber,
      purchaseOrderId: po.id,
      travelerId: params.travelerId,
      receivedById: params.receivedById,
      packingSlip: params.packingSlip,
      notes: params.notes,
      status: wouldBeFull ? "COMPLETE" : "PARTIAL",
      dd1149Attached: receivingGovt && (params.dd1149Docs?.length || 0) > 0,
      lines: {
        create: receiveLines.map((l) => {
          const poLine = po.lines.find((pl) => pl.id === l.poLineId);
          // Material ownership from destination / traveler context — not part master
          const ownership = receivingGovt ? "GOVERNMENT" : "COMPANY";
          return {
            poLineId: l.poLineId,
            partId: poLine?.partId,
            description: poLine?.description || "Item",
            quantityOrdered: poLine?.quantity || l.quantityReceived,
            quantityReceived: l.quantityReceived,
            lotNumber: l.lotNumber,
            serialNumbers: l.serialNumbers ? JSON.stringify(l.serialNumbers) : null,
            unitCost: poLine?.unitCost || 0,
            ownership,
          };
        }),
      },
    },
    include: { lines: true },
  });

  // Update PO line quantities
  for (const line of receiveLines) {
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
  const inspectionResults: {
    inspectionId: string;
    status: string;
    ncrId?: string;
    mrbId?: string;
    inventoryItemId?: string;
    routedToTest?: boolean;
    /** First station for this line: QA (visual/GD&T), TEST (functional only), or null (dock putaway). */
    station?: "QA" | "TEST" | null;
    workOrderId?: string | null;
  }[] = [];
  const putAwayItems: string[] = [];
  const testRouted: string[] = [];
  const routedQa: string[] = [];
  const routedTest: string[] = [];
  let attachedReceiptPaperwork = false;

  for (const line of receipt.lines) {
    if (!line.partId || !receivingLoc) continue;

    const poLine = po.lines.find((pl) => pl.id === line.poLineId);
    const part = poLine?.part;
    const needsTest =
      !!part &&
      (part.requiresGdtInspection || part.requiresFunctionalTest);

    const existing = await prisma.inventoryItem.findFirst({
      where: {
        partId: line.partId,
        locationId: receivingLoc.id,
        lotNumber: line.lotNumber || null,
      },
    });

    let invItem;
    // On pass: stock sits in RECEIVING with qty available = 0 until putaway.
    // On fail: quarantine path zeros availability.
    const fail = params.failInspection === true;

    if (existing) {
      invItem = await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantityOnHand: existing.quantityOnHand + line.quantityReceived,
          quantityAvailable: fail ? 0 : existing.quantityAvailable,
          unitCost: line.unitCost,
        },
      });
    } else {
      invItem = await prisma.inventoryItem.create({
        data: {
          partId: line.partId,
          locationId: receivingLoc.id,
          quantityOnHand: line.quantityReceived,
          quantityAvailable: 0, // available only after putaway
          lotNumber: line.lotNumber,
          unitCost: line.unitCost,
          ownership: receivingGovt ? "GOVERNMENT" : "COMPANY",
        },
      });
    }

    // Align ownership with GFP material context (area / traveler / PO — not part master)
    if (receivingGovt && invItem.ownership !== "GOVERNMENT") {
      invItem = await prisma.inventoryItem.update({
        where: { id: invItem.id },
        data: { ownership: "GOVERNMENT" },
      });
    }

    // Assign gov property number + owning contract after GFP receive
    if (receivingGovt && line.partId && !fail) {
      const existingGfp = await prisma.governmentProperty.findFirst({
        where: { inventoryItemId: invItem.id },
      });
      if (!existingGfp) {
        const assetTag = await nextGovPropNumber(
          line.poLineId
            ? params.govPropNumbers?.[line.poLineId]
            : undefined
        );
        await prisma.governmentProperty.create({
          data: {
            assetTag,
            description: line.description,
            partNumber: part?.partNumber,
            serialNumber: line.lotNumber || undefined,
            acquisitionCost: line.unitCost * line.quantityReceived,
            acquisitionDate: new Date(),
            propertyType: "GFP",
            classification: "MATERIAL",
            status: "ACTIVE",
            contractNumber: params.contractNumber!.trim(),
            location: putawayLoc?.code || receivingLoc.code,
            inventoryItemId: invItem.id,
            condition: "SERVICEABLE",
            notes: `Received ${receipt.number} / ${po.number} → ${putawayLoc?.code || "GFP"}`,
            dfarsCompliant: true,
          },
        });
      }
    }

    const lineParams = receiveLines.find((l) => l.poLineId === line.poLineId);
    const photoInputs =
      lineParams?.photos?.length
        ? lineParams.photos
        : params.photos?.length
          ? params.photos
          : undefined;

    // Capture receiving photos (dock uploads or mock paths)
    const photos = await captureReceivingPhotos({
      partId: line.partId,
      receiptId: receipt.id,
      receiptLineId: line.id,
      inventoryItemId: invItem.id,
      purchaseOrderId: po.id,
      lotNumber: line.lotNumber || undefined,
      photoInputs,
      userId: params.receivedById,
    });

    // Packing list / CoC / material certifications (once per receipt) + line test docs
    const paperDocs: {
      docType: DocType;
      url: string;
      fileName?: string;
      caption?: string;
    }[] = [];
    if (!attachedReceiptPaperwork) {
      for (const d of params.packingListDocs || []) {
        paperDocs.push({ docType: "PACKING_LIST", ...d });
      }
      for (const d of params.cocDocs || []) {
        paperDocs.push({ docType: "COC", ...d });
      }
      for (const d of params.materialCertDocs || []) {
        paperDocs.push({ docType: "MATERIAL_CERT", ...d });
      }
      for (const d of params.dd1149Docs || []) {
        paperDocs.push({ docType: "DD1149", ...d });
      }
      if (
        (params.packingListDocs?.length || 0) +
          (params.cocDocs?.length || 0) +
          (params.materialCertDocs?.length || 0) +
          (params.dd1149Docs?.length || 0) >
        0
      ) {
        attachedReceiptPaperwork = true;
      }
    }
    for (const d of lineParams?.visualDocs || []) {
      paperDocs.push({ docType: "VISUAL_DOCS", ...d });
    }
    for (const d of lineParams?.gdtDocs || []) {
      paperDocs.push({ docType: "GDT_DOCS", ...d });
    }
    for (const d of lineParams?.functionalDocs || []) {
      paperDocs.push({ docType: "FUNCTIONAL_TEST", ...d });
    }
    if (paperDocs.length) {
      await saveReceivingDocuments({
        docs: paperDocs,
        partId: line.partId,
        receiptId: receipt.id,
        receiptLineId: line.id,
        inventoryItemId: invItem.id,
        purchaseOrderId: po.id,
        lotNumber: line.lotNumber || undefined,
        userId: params.receivedById,
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
        photoUrls: JSON.stringify(photos.map((p) => p.url)),
        notes: fail
          ? "Received — failed inspection"
          : needsTest
            ? `Received — route on RCV child traveler (QA/Test; putaway after pass${
                params.putawayLocationCode
                  ? `; planned ${params.putawayLocationCode}`
                  : ""
              })`
            : `Received — putaway to ${params.putawayLocationCode || "stock"}`,
        userId: params.receivedById,
      },
    });

    await recordTrace({
      eventType: "RECEIPT",
      partId: line.partId,
      lotNumber: line.lotNumber,
      quantity: line.quantityReceived,
      toLocation: receivingLoc.code,
      purchaseOrderId: po.id,
      photoUrls: photos.map((p) => p.url),
      notes: `Receipt ${receipt.number}${wouldBeFull ? "" : " (partial)"}${
        needsTest ? " · test routing" : ""
      }`,
      userId: params.receivedById,
    });

    let ncrId: string | undefined;
    let mrbId: string | undefined;
    let primaryInspectionId = "";
    let routedToTest = false;
    let workOrderId: string | null = null;
    let lineStation: "QA" | "TEST" | null = null;

    if (fail) {
      // Hard dock fail (legacy / force fail) — quarantine path, no TEST route
      const inspCount = await prisma.inspection.count();
      const inspection = await prisma.inspection.create({
        data: {
          number: `INSP-${String(inspCount + 1).padStart(5, "0")}`,
          type: "RECEIVING",
          status: "FAILED",
          partId: line.partId,
          purchaseOrderId: po.id,
          receiptId: receipt.id,
          inventoryItemId: invItem.id,
          lotNumber: line.lotNumber,
          quantity: line.quantityReceived,
          quantityPassed: 0,
          quantityFailed: line.quantityReceived,
          inspectorId: params.receivedById,
          completedAt: new Date(),
          notes: "Dock fail — dimensional / visual non-conformance",
          results: {
            create: [
              {
                characteristic: "Visual",
                specification: "No damage, correct P/N",
                measuredValue: "Fail at dock",
                result: "FAIL",
              },
            ],
          },
        },
      });
      primaryInspectionId = inspection.id;
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
    } else if (needsTest && part) {
      const routed = await routeReceivingLineForInspection({
        partId: line.partId,
        partNumber: part.partNumber,
        quantity: line.quantityReceived,
        lotNumber: line.lotNumber,
        inventoryItemId: invItem.id,
        purchaseOrderId: po.id,
        receiptId: receipt.id,
        receiptLineId: line.id,
        plannedPutawayCode: params.putawayLocationCode,
        visualResult: lineParams?.visualResult,
        gdtResult: lineParams?.gdtResult,
        functionalResult: lineParams?.functionalResult,
        userId: params.receivedById,
      });
      routedToTest = routed.routedToTest;
      workOrderId = routed.workOrderId;
      primaryInspectionId = routed.inspectionIds[0] || "";
      lineStation = routed.station;
      testRouted.push(invItem.id);
      if (routed.station === "TEST") routedTest.push(invItem.id);
      else routedQa.push(invItem.id);
      // Attach line docs to first inspection if present
      if (routed.inspectionIds[0] && paperDocs.length) {
        await prisma.receivingDocument.updateMany({
          where: {
            receiptLineId: line.id,
            inspectionId: null,
          },
          data: { inspectionId: routed.inspectionIds[0] },
        });
      }
    } else {
      // No QA / functional — this is dock-only material. Putaway + dock ack
      // is the whole job; never leave a hanging PENDING "inspection" that
      // looks like TEST/QA work.
      const acked =
        params.receivingAck === true || !!params.putawayLocationCode;
      const docCount = paperDocs.filter((d) =>
        ["PACKING_LIST", "COC", "MATERIAL_CERT"].includes(d.docType)
      ).length;
      const inspCount = await prisma.inspection.count();
      const inspection = await prisma.inspection.create({
        data: {
          number: `INSP-${String(inspCount + 1).padStart(5, "0")}`,
          type: "RECEIVING",
          status: acked ? "PASSED" : "PENDING",
          partId: line.partId,
          purchaseOrderId: po.id,
          receiptId: receipt.id,
          inventoryItemId: invItem.id,
          lotNumber: line.lotNumber,
          quantity: line.quantityReceived,
          quantityPassed: acked ? line.quantityReceived : 0,
          quantityFailed: 0,
          inspectorId: acked ? params.receivedById : null,
          completedAt: acked ? new Date() : null,
          workCenter: "DOCK",
          plannedPutawayCode: params.putawayLocationCode,
          notes: acked
            ? `Dock only — accepted and put away${
                params.putawayLocationCode
                  ? ` to ${params.putawayLocationCode}`
                  : ""
              }`
            : "Dock acceptance NOT attested — awaiting receiver sign-off",
          results: {
            create: [
              {
                characteristic: "Visual condition",
                specification: "No damage, correct P/N, count matches",
                measuredValue: acked ? "Attested by receiver" : "Not attested",
                result: acked ? "PASS" : "NA",
              },
              {
                characteristic: "Documentation",
                specification: "Packing list / CoC / material certs",
                measuredValue: `${docCount} doc(s)`,
                result: docCount > 0 ? "PASS" : "NA",
              },
              {
                characteristic: "Photo documentation",
                specification: "Receiving photos",
                measuredValue: `${photos.length} photo(s)`,
                result: photos.length > 0 ? "PASS" : "NA",
              },
            ],
          },
        },
      });
      primaryInspectionId = inspection.id;
      if (acked) putAwayItems.push(invItem.id);

      await recordTrace({
        eventType: "INSPECTION",
        partId: line.partId,
        lotNumber: line.lotNumber,
        quantity: line.quantityReceived,
        purchaseOrderId: po.id,
        inspectionId: inspection.id,
        notes: acked
          ? `Dock acceptance ${inspection.number}: put away (no QA/Test required)`
          : `Dock acceptance ${inspection.number}: awaiting receiver sign-off`,
        userId: params.receivedById,
      });
    }

    inspectionResults.push({
      inspectionId: primaryInspectionId,
      status: fail
        ? "FAILED"
        : routedToTest
          ? "PENDING_TEST"
          : params.receivingAck === true
            ? "PASSED"
            : "PENDING",
      ncrId,
      mrbId,
      inventoryItemId: invItem.id,
      routedToTest,
      station: lineStation,
      workOrderId,
    });
  }

  await updateSupplierScorecard(po.supplierId);

  // Receiving closes the payables loop: evaluated receipt settlement
  // creates the AP voucher at PO price x received qty (3-way match)
  // and capitalizes the inventory.
  {
    const receivedForBilling = receipt.lines
      .filter((l) => l.quantityReceived > 0)
      .map((l) => {
        const poLine = po.lines.find((pl) => pl.id === l.poLineId);
        return {
          description: poLine?.description || "Received material",
          quantity: l.quantityReceived,
          unitCost: poLine?.unitCost || 0,
        };
      });
    if (receivedForBilling.length > 0 && !params.failInspection) {
      const { raiseApInvoiceForReceipt } = await import(
        "@/lib/services/billing"
      );
      await raiseApInvoiceForReceipt({
        purchaseOrderId: po.id,
        receiptNumber: receipt.number,
        received: receivedForBilling,
        userId: params.receivedById,
      });
    }
  }

  // Put away only lines that did NOT route to QA/TEST (they return to dock after pass)
  if (!params.failInspection && params.putawayLocationCode) {
    for (const inventoryItemId of putAwayItems) {
      if (testRouted.includes(inventoryItemId)) continue;
      await putAwayInventory({
        inventoryItemId,
        userId: params.receivedById,
        capturePhotos: false,
        targetLocationCode: params.putawayLocationCode,
      });
    }
  } else if (params.failInspection) {
    await refreshAllWaitingMaterial(params.receivedById);
  }

  // Child RCV travelers own IN_INSPECTION — parent is split in actionReceivePo.
  // Soft-mark source so UI updates if split is skipped for any reason.
  if (params.travelerId && testRouted.length > 0) {
    await prisma.receivingTraveler.update({
      where: { id: params.travelerId },
      data: {
        status: "IN_INSPECTION",
      },
    });
  }

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: wouldBeFull ? "RECEIVED" : "PARTIAL_RECEIPT",
    userId: params.receivedById,
    metadata: {
      receiptNumber: receipt.number,
      lines: receiveLines.length,
      inspections: inspectionResults,
      putawayLocationCode: params.putawayLocationCode,
      partial: !allReceived,
      routedToInspection: testRouted.length,
      governmentProperty: receivingGovt,
      noWorkOrder: true,
    },
  });

  return {
    receipt,
    poStatus: newStatus,
    inspections: inspectionResults,
    allReceived,
    partial: !allReceived,
    testRouted: testRouted.length,
    routedInventoryItemIds: testRouted,
    /** Inventory put away at dock (no QA/Test). */
    putAwayInventoryItemIds: putAwayItems.filter((id) => !testRouted.includes(id)),
    /** Grouped for child RCV travelers — separate QA vs functional-only Test. */
    routedGroups: [
      ...(routedQa.length
        ? [{ station: "QA" as const, inventoryItemIds: routedQa }]
        : []),
      ...(routedTest.length
        ? [{ station: "TEST" as const, inventoryItemIds: routedTest }]
        : []),
    ],
    governmentProperty: receivingGovt,
    inInspection: testRouted.length > 0,
  };
}

/**
 * Receive against a non-PO customer/GFP traveler (no purchase order).
 * Always requires DD Form 1149 for government property.
 */
async function nextGovPropNumber(preferred?: string) {
  const tag = preferred?.trim();
  if (tag) {
    const clash = await prisma.governmentProperty.findUnique({
      where: { assetTag: tag },
    });
    if (clash) {
      throw new Error(`Government property number ${tag} is already assigned`);
    }
    return tag;
  }
  const gfpCount = await prisma.governmentProperty.count();
  return `GFP-${String(gfpCount + 1).padStart(5, "0")}`;
}

export async function receiveGfpTraveler(params: {
  travelerId: string;
  lines: {
    travelerLineId: string;
    quantityReceived: number;
    lotNumber?: string;
    govPropNumber?: string;
    photos?: { url: string; caption?: string }[];
    visualResult?: "PASS" | "FAIL" | "PENDING";
    gdtResult?: "PASS" | "FAIL" | "PENDING";
    functionalResult?: "PASS" | "FAIL" | "PENDING";
    visualDocs?: { url: string; fileName?: string; caption?: string }[];
    gdtDocs?: { url: string; fileName?: string; caption?: string }[];
    functionalDocs?: { url: string; fileName?: string; caption?: string }[];
  }[];
  receivedById?: string;
  receivingAck?: boolean;
  packingSlip?: string;
  notes?: string;
  putawayLocationCode?: string;
  photos?: { url: string; caption?: string }[];
  packingListDocs?: { url: string; fileName?: string; caption?: string }[];
  cocDocs?: { url: string; fileName?: string; caption?: string }[];
  materialCertDocs?: { url: string; fileName?: string; caption?: string }[];
  dd1149Docs?: { url: string; fileName?: string; caption?: string }[];
  /** Owning government contract */
  contractNumber?: string;
}) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: params.travelerId },
    include: {
      lines: { include: { part: true } },
      customer: true,
    },
  });
  // part relation on traveler lines required for QA/Test flags
  if (!traveler) throw new Error("Receiving traveler not found");
  if (traveler.purchaseOrderId) {
    throw new Error("Use standard PO receive for purchase-order travelers");
  }
  if (["CLOSED", "COMPLETE"].includes(traveler.status) &&
      traveler.lines.every((l) => l.quantityReceived >= l.quantity)) {
    throw new Error("Traveler already complete");
  }

  const receiveLines = params.lines.filter((l) => l.quantityReceived > 0);
  if (!receiveLines.length) throw new Error("Nothing to receive");

  for (const line of receiveLines) {
    const tl = traveler.lines.find((x) => x.id === line.travelerLineId);
    if (!tl) throw new Error("Unknown traveler line");
    const open = tl.quantity - tl.quantityReceived;
    if (line.quantityReceived > open + 0.0001) {
      throw new Error(
        `Cannot receive ${line.quantityReceived} on "${tl.description}" — only ${open} open`
      );
    }
  }

  // GFP traveler only — DD1149 + contract required
  if (!params.dd1149Docs?.length) {
    throw new Error("DD Form 1149 is required on GFP receiving travelers.");
  }
  const contractNumber =
    params.contractNumber?.trim() || traveler.contractNumber?.trim();
  if (!contractNumber) {
    throw new Error(
      "Contract number is required — which government contract owns this property?"
    );
  }

  const willRouteInspect = traveler.lines.some((tl) => {
    if (!params.lines.find((l) => l.travelerLineId === tl.id && l.quantityReceived > 0))
      return false;
    return (
      !!tl.part?.requiresGdtInspection || !!tl.part?.requiresFunctionalTest
    );
  });

  if (!willRouteInspect && !params.putawayLocationCode) {
    throw new Error("Select putaway destination (GFP area for final stock).");
  }
  const putawayLoc = params.putawayLocationCode
    ? await prisma.location.findFirst({
        where: { code: params.putawayLocationCode },
      })
    : null;
  if (!willRouteInspect && !isGfpLocation(putawayLoc)) {
    throw new Error("GFP traveler final putaway must be a GFP area (e.g. GFP-01).");
  }

  const wouldBeFull = traveler.lines.every((tl) => {
    const recv = receiveLines.find((l) => l.travelerLineId === tl.id);
    const add = recv?.quantityReceived || 0;
    return tl.quantityReceived + add >= tl.quantity;
  });

  const receiptCount = await prisma.receipt.count();
  const receipt = await prisma.receipt.create({
    data: {
      number: `RCV-${String(receiptCount + 1).padStart(5, "0")}`,
      travelerId: traveler.id,
      receivedById: params.receivedById,
      packingSlip: params.packingSlip,
      notes: params.notes,
      status: wouldBeFull ? "COMPLETE" : "PARTIAL",
      dd1149Attached: (params.dd1149Docs?.length || 0) > 0,
      lines: {
        create: receiveLines.map((l) => {
          const tl = traveler.lines.find((x) => x.id === l.travelerLineId)!;
          return {
            travelerLineId: l.travelerLineId,
            partId: tl.partId,
            description: tl.description,
            quantityOrdered: tl.quantity,
            quantityReceived: l.quantityReceived,
            lotNumber: l.lotNumber,
            unitCost: tl.unitCost,
            ownership: tl.ownership || "GOVERNMENT",
          };
        }),
      },
    },
    include: { lines: true },
  });

  for (const line of receiveLines) {
    const tl = traveler.lines.find((x) => x.id === line.travelerLineId)!;
    await prisma.receivingTravelerLine.update({
      where: { id: tl.id },
      data: { quantityReceived: tl.quantityReceived + line.quantityReceived },
    });
  }

  const receivingLoc =
    (await prisma.location.findFirst({ where: { type: "RECEIVING" } })) ||
    (await prisma.location.findFirst());
  if (!receivingLoc) throw new Error("No receiving location configured");

  // Paperwork once
  const paperDocs: {
    docType: DocType;
    url: string;
    fileName?: string;
    caption?: string;
  }[] = [];
  for (const d of params.packingListDocs || []) {
    paperDocs.push({ docType: "PACKING_LIST", ...d });
  }
  for (const d of params.cocDocs || []) {
    paperDocs.push({ docType: "COC", ...d });
  }
  for (const d of params.materialCertDocs || []) {
    paperDocs.push({ docType: "MATERIAL_CERT", ...d });
  }
  for (const d of params.dd1149Docs || []) {
    paperDocs.push({ docType: "DD1149", ...d });
  }

  const putAwayItems: string[] = [];
  const testRouted: string[] = [];
  const routedQa: string[] = [];
  const routedTest: string[] = [];

  for (const line of receipt.lines) {
    if (!line.partId) {
      // Still allow non-catalog GFP description-only with mock inventory skip
      continue;
    }
    const tl = traveler.lines.find((x) => x.id === line.travelerLineId);
    const part = tl?.part;

    const invItem = await prisma.inventoryItem.create({
      data: {
        partId: line.partId,
        locationId: receivingLoc.id,
        quantityOnHand: line.quantityReceived,
        quantityAvailable: 0,
        lotNumber: line.lotNumber,
        unitCost: line.unitCost,
        ownership: "GOVERNMENT",
      },
    });

    if (paperDocs.length) {
      await saveReceivingDocuments({
        docs: paperDocs,
        partId: line.partId,
        receiptId: receipt.id,
        receiptLineId: line.id,
        inventoryItemId: invItem.id,
        lotNumber: line.lotNumber || undefined,
        userId: params.receivedById,
      });
    }

    const lineParams = receiveLines.find(
      (l) => l.travelerLineId === line.travelerLineId
    );
    const photoInputs =
      lineParams?.photos?.length
        ? lineParams.photos
        : params.photos?.length
          ? params.photos
          : undefined;

    await captureReceivingPhotos({
      partId: line.partId,
      receiptId: receipt.id,
      receiptLineId: line.id,
      inventoryItemId: invItem.id,
      lotNumber: line.lotNumber || undefined,
      photoInputs,
      userId: params.receivedById,
    });

    const assetTag = await nextGovPropNumber(lineParams?.govPropNumber);
    await prisma.governmentProperty.create({
      data: {
        assetTag,
        description: line.description,
        partNumber: part?.partNumber,
        serialNumber: line.lotNumber || undefined,
        acquisitionCost: line.unitCost * line.quantityReceived,
        acquisitionDate: new Date(),
        propertyType: "GFP",
        classification: "MATERIAL",
        status: "ACTIVE",
        contractNumber,
        custodialCode: traveler.customer?.code,
        location: putawayLoc?.code || receivingLoc.code,
        inventoryItemId: invItem.id,
        condition: "SERVICEABLE",
        notes: `GFP traveler ${traveler.number} · receipt ${receipt.number}`,
        dfarsCompliant: true,
      },
    });

    // Persist contract on traveler if it was entered at receive
    if (params.contractNumber?.trim() && !traveler.contractNumber) {
      await prisma.receivingTraveler.update({
        where: { id: traveler.id },
        data: { contractNumber: params.contractNumber.trim() },
      });
    }

    await prisma.materialTransaction.create({
      data: {
        type: "RECEIPT",
        partId: line.partId,
        inventoryItemId: invItem.id,
        quantity: line.quantityReceived,
        unitCost: line.unitCost,
        toLocation: receivingLoc.code,
        lotNumber: line.lotNumber,
        reference: receipt.number,
        notes: `GFP customer receive · ${traveler.number}`,
        userId: params.receivedById,
      },
    });

    const needsTest =
      !!part &&
      (part.requiresGdtInspection || part.requiresFunctionalTest);

    if (needsTest && part) {
      const routed = await routeReceivingLineForInspection({
        partId: line.partId,
        partNumber: part.partNumber,
        quantity: line.quantityReceived,
        lotNumber: line.lotNumber,
        inventoryItemId: invItem.id,
        purchaseOrderId: null,
        receiptId: receipt.id,
        receiptLineId: line.id,
        plannedPutawayCode: params.putawayLocationCode,
        visualResult: lineParams?.visualResult,
        gdtResult: lineParams?.gdtResult,
        functionalResult: lineParams?.functionalResult,
        userId: params.receivedById,
      });
      if (routed.deferPutaway) {
        testRouted.push(invItem.id);
        if (routed.station === "TEST") routedTest.push(invItem.id);
        else routedQa.push(invItem.id);
      } else putAwayItems.push(invItem.id);
    } else {
      // Dock-only GFP — putaway + ack is the whole job (not TEST/QA)
      const acked =
        params.receivingAck === true || !!params.putawayLocationCode;
      if (acked) putAwayItems.push(invItem.id);
      const inspCount = await prisma.inspection.count();
      await prisma.inspection.create({
        data: {
          number: `INSP-${String(inspCount + 1).padStart(5, "0")}`,
          type: "RECEIVING",
          status: acked ? "PASSED" : "PENDING",
          partId: line.partId,
          receiptId: receipt.id,
          inventoryItemId: invItem.id,
          lotNumber: line.lotNumber,
          quantity: line.quantityReceived,
          quantityPassed: acked ? line.quantityReceived : 0,
          inspectorId: acked ? params.receivedById : null,
          completedAt: acked ? new Date() : null,
          workCenter: "DOCK",
          plannedPutawayCode: params.putawayLocationCode,
          notes: acked
            ? "GFP dock only — accepted and put away (no QA/Test)"
            : "GFP dock — awaiting receiver sign-off",
          results: {
            create: [
              {
                characteristic: "Documentation (DD1149)",
                specification: "DD1149 required for GFP",
                measuredValue: acked ? "Verified by receiver" : "Not attested",
                result: acked ? "PASS" : "NA",
              },
            ],
          },
        },
      });
    }
  }

  for (const inventoryItemId of putAwayItems) {
    if (testRouted.includes(inventoryItemId)) continue;
    if (!params.putawayLocationCode) continue;
    await putAwayInventory({
      inventoryItemId,
      userId: params.receivedById,
      capturePhotos: false,
      targetLocationCode: params.putawayLocationCode,
    });
  }

  if (testRouted.length > 0) {
    await prisma.receivingTraveler.update({
      where: { id: traveler.id },
      data: { status: "IN_INSPECTION" },
    });
  } else if (wouldBeFull) {
    await prisma.receivingTraveler.update({
      where: { id: traveler.id },
      data: { status: "COMPLETE" },
    });
  } else {
    await prisma.receivingTraveler.update({
      where: { id: traveler.id },
      data: { status: "PARTIAL" },
    });
  }

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: wouldBeFull ? "GFP_RECEIVED" : "GFP_PARTIAL_RECEIPT",
    userId: params.receivedById,
    metadata: {
      receiptNumber: receipt.number,
      lines: receiveLines.length,
      dd1149: true,
      inInspection: testRouted.length > 0,
      noWorkOrder: true,
    },
  });

  return {
    receipt,
    allReceived: wouldBeFull,
    partial: !wouldBeFull,
    inInspection: testRouted.length > 0,
    routedInventoryItemIds: testRouted,
    putAwayInventoryItemIds: putAwayItems.filter((id) => !testRouted.includes(id)),
    routedGroups: [
      ...(routedQa.length
        ? [{ station: "QA" as const, inventoryItemIds: routedQa }]
        : []),
      ...(routedTest.length
        ? [{ station: "TEST" as const, inventoryItemIds: routedTest }]
        : []),
    ],
  };
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

/**
 * Formally close a dispositioned MRB case. A case stays in the Open
 * queue after disposition until someone deliberately closes it out
 * here — that's the difference between "resolved" and "done".
 */
export async function closeMrbCase(params: {
  mrbCaseId: string;
  closedById?: string;
}) {
  const mrb = await prisma.mrbCase.findUnique({
    where: { id: params.mrbCaseId },
  });
  if (!mrb) throw new Error("MRB case not found");
  if (mrb.status !== "DISPOSITIONED") {
    throw new Error(
      `Only a dispositioned case can be closed (this one is ${mrb.status}).`
    );
  }
  const updated = await prisma.mrbCase.update({
    where: { id: params.mrbCaseId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await logAudit({
    entityType: "MrbCase",
    entityId: mrb.id,
    action: "MRB_CLOSED",
    userId: params.closedById,
    metadata: { number: mrb.number },
  });
  return updated;
}

export async function dispositionMrb(params: {
  mrbCaseId: string;
  disposition: "USE_AS_IS" | "REWORK" | "SCRAP" | "RETURN_TO_SUPPLIER" | "REPAIR";
  quantity: number;
  justification: string;
  decidedById?: string;
  createCar?: boolean;
  /** SCRAP only: raise a replacement purchase request for the scrapped qty. */
  createReplacementPr?: boolean;
}) {
  const mrb = await prisma.mrbCase.findUnique({
    where: { id: params.mrbCaseId },
    include: {
      ncr: { include: { part: true, supplier: true } },
      inventoryHolds: true,
    },
  });
  if (!mrb) throw new Error("MRB case not found");

  const carNumber = params.createCar
    ? `CAR-${String((await prisma.mrbDisposition.count()) + 1).padStart(5, "0")}`
    : null;

  const carTitle = carNumber
    ? `CAR for ${mrb.ncr.number} — ${params.disposition.replace(/_/g, " ")}`
    : null;

  // REWORK / REPAIR each spawn a typed work order tied to the MRB case.
  let reworkWorkOrderId: string | null = null;
  let repairWorkOrderId: string | null = null;
  if (
    (params.disposition === "REWORK" || params.disposition === "REPAIR") &&
    mrb.ncr.partId
  ) {
    const { createWorkOrder } = await import("@/lib/services/work-orders");
    const { getDefaultWorkCenter } = await import("@/lib/services/workcenters");
    const station = await getDefaultWorkCenter("MANUFACTURING");
    const label = params.disposition === "REWORK" ? "rework" : "repair";
    const wo = await createWorkOrder({
      type: params.disposition,
      partId: mrb.ncr.partId,
      quantity: params.quantity,
      workCenter: station?.code || "ASM-01",
      department: "MANUFACTURING",
      description: `MRB ${label} — ${mrb.number} / ${mrb.ncr.number}`,
      travelerNotes: params.justification,
      createdById: params.decidedById,
      priority: "HIGH",
    });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { mrbCaseId: mrb.id },
    });
    if (params.disposition === "REWORK") reworkWorkOrderId = wo.id;
    else repairWorkOrderId = wo.id;
  }

  // RETURN_TO_SUPPLIER opens a return shipment with a packing list so the
  // material can be shipped back through the normal pack/ship flow.
  let returnShipmentId: string | null = null;
  if (params.disposition === "RETURN_TO_SUPPLIER") {
    const count = await prisma.shipment.count();
    const shipment = await prisma.shipment.create({
      data: {
        number: `SHP-${String(count + 1).padStart(5, "0")}`,
        mrbCaseId: mrb.id,
        status: "PICKING",
        shipToAddress: mrb.ncr.supplier
          ? `${mrb.ncr.supplier.name} (RMA — return of nonconforming material)`
          : "Supplier (RMA — return of nonconforming material)",
        notes: `Return to supplier per ${mrb.number} / ${mrb.ncr.number}. ${params.justification}`,
        lines: {
          create: [
            {
              partId: mrb.ncr.partId,
              description: `${mrb.ncr.part?.partNumber || "Material"} — nonconforming return (${mrb.number})`,
              quantity: params.quantity,
              lotNumber: mrb.inventoryHolds[0]?.lotNumber || null,
            },
          ],
        },
      },
    });
    returnShipmentId = shipment.id;
  }

  // SCRAP can raise a replacement PR so the shortage is covered.
  let replacementPrId: string | null = null;
  if (params.disposition === "SCRAP" && params.createReplacementPr) {
    const prCount = await prisma.purchaseRequest.count();
    const estUnit =
      mrb.ncr.part?.standardCost || 0;
    const pr = await prisma.purchaseRequest.create({
      data: {
        number: `PR-${String(prCount + 1).padStart(5, "0")}`,
        status: "SUBMITTED",
        requestedById: params.decidedById,
        department: "QUALITY",
        justification: `Replacement for material scrapped under ${mrb.number} / ${mrb.ncr.number}. ${params.justification}`,
        totalEstimate: estUnit * params.quantity,
        supplierId: mrb.ncr.supplierId,
        triggerSource: "MRB_SCRAP",
        mrbCaseId: mrb.id,
        lines: {
          create: [
            {
              partId: mrb.ncr.partId,
              description: `${mrb.ncr.part?.partNumber || "Material"} — replacement for scrap (${mrb.number})`,
              quantity: params.quantity,
              estimatedUnitCost: estUnit,
            },
          ],
        },
      },
    });
    replacementPrId = pr.id;
  }

  const disposition = await prisma.mrbDisposition.create({
    data: {
      mrbCaseId: mrb.id,
      disposition: params.disposition,
      quantity: params.quantity,
      justification: params.justification,
      decidedById: params.decidedById,
      carNumber,
      carStatus: carNumber ? "OPEN" : null,
      carTitle,
      carNotes: carNumber
        ? `Opened from MRB ${mrb.number}. Disposition: ${params.disposition}. ${params.justification}`
        : null,
      carDueDate: carNumber
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : null,
      reworkWorkOrderId,
      repairWorkOrderId,
      returnShipmentId,
      replacementPrId,
    },
  });

  if (carNumber) {
    await logCarActivity({
      dispositionId: disposition.id,
      carNumber,
      action: "CREATED",
      summary: `CAR ${carNumber} opened from MRB ${mrb.number} (${params.disposition.replace(/_/g, " ")})`,
      changes: {
        status: { from: null, to: "OPEN" },
        mrbNumber: mrb.number,
        ncrNumber: mrb.ncr.number,
        disposition: params.disposition,
        justification: params.justification,
      },
      userId: params.decidedById,
    });
  }

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
    } else if (params.disposition === "USE_AS_IS") {
      // Release in place: only relocate if the material sits in a
      // quarantine cage — otherwise it stays wherever it lived before.
      const currentLoc = await prisma.location.findUnique({
        where: { id: item.locationId },
      });
      const storageLoc =
        currentLoc?.type === "QUARANTINE"
          ? await prisma.location.findFirst({ where: { type: "STORAGE" } })
          : null;
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
    // REWORK / REPAIR leave material in quarantine — the spawned WO
    // consumes it and returns conforming stock on completion.
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
      reworkWorkOrderId,
      repairWorkOrderId,
      returnShipmentId,
      replacementPrId,
    },
  });

  return disposition;
}

export async function logCarActivity(params: {
  dispositionId: string;
  carNumber: string;
  action: string;
  summary: string;
  changes?: Record<string, unknown> | null;
  userId?: string | null;
}) {
  try {
    await prisma.carActivityLog.create({
      data: {
        dispositionId: params.dispositionId,
        carNumber: params.carNumber,
        action: params.action,
        summary: params.summary,
        changes: params.changes ? JSON.stringify(params.changes) : null,
        userId: params.userId || null,
      },
    });
  } catch (e) {
    console.error("CAR activity log failed:", e);
  }
}

export async function updateCar(params: {
  dispositionId: string;
  carStatus?: string;
  carResponse?: string;
  carNotes?: string;
  /** Vendor email / acknowledgment files */
  carAttachments?: { url: string; fileName?: string; caption?: string }[];
  userId?: string;
}) {
  const d = await prisma.mrbDisposition.findUnique({
    where: { id: params.dispositionId },
    include: { mrbCase: { include: { ncr: true } } },
  });
  if (!d) throw new Error("Disposition not found");
  if (!d.carNumber) throw new Error("No CAR on this disposition");

  // Terminal status is VERIFIED only (maps to closed). CLOSED not chosen by user.
  let status = params.carStatus || d.carStatus || "OPEN";
  if (status === "CLOSED") status = "VERIFIED";
  const allowed = [
    "OPEN",
    "IN_PROGRESS",
    "RESPONSE_RECEIVED",
    "VERIFIED",
  ];
  if (!allowed.includes(status)) {
    throw new Error(`Invalid CAR status ${status}`);
  }
  const verified = status === "VERIFIED";
  const storedStatus = verified ? "CLOSED" : status;
  const priorStatus = d.carStatus || "OPEN";

  let carAttachments = d.carAttachments;
  const newAttachmentMeta: { fileName?: string; caption?: string }[] = [];
  if (params.carAttachments?.length) {
    const existing: { url: string; fileName?: string; caption?: string }[] =
      carAttachments ? JSON.parse(carAttachments) : [];
    newAttachmentMeta.push(
      ...params.carAttachments.map((a) => ({
        fileName: a.fileName,
        caption: a.caption,
      }))
    );
    carAttachments = JSON.stringify(
      [...existing, ...params.carAttachments].slice(0, 24)
    );
  }

  const fieldChanges: Record<string, { from: unknown; to: unknown }> = {};
  if (storedStatus !== priorStatus) {
    fieldChanges.status = { from: priorStatus, to: storedStatus };
  }
  if (
    params.carResponse !== undefined &&
    (params.carResponse || "") !== (d.carResponse || "")
  ) {
    fieldChanges.response = {
      from: d.carResponse || "",
      to: params.carResponse,
    };
  }
  if (
    params.carNotes !== undefined &&
    (params.carNotes || "") !== (d.carNotes || "")
  ) {
    fieldChanges.notes = { from: d.carNotes || "", to: params.carNotes };
  }
  if (newAttachmentMeta.length > 0) {
    fieldChanges.attachments = {
      from: null,
      to: newAttachmentMeta,
    };
  }

  const updated = await prisma.mrbDisposition.update({
    where: { id: d.id },
    data: {
      carStatus: storedStatus,
      ...(params.carResponse !== undefined
        ? { carResponse: params.carResponse }
        : {}),
      ...(params.carNotes !== undefined ? { carNotes: params.carNotes } : {}),
      ...(carAttachments !== d.carAttachments ? { carAttachments } : {}),
      carClosedAt: verified ? new Date() : null,
    },
  });

  if (verified) {
    await prisma.mrbCase.update({
      where: { id: d.mrbCaseId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await prisma.nonConformance.update({
      where: { id: d.mrbCase.ncrId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }

  // Build human-readable summary of what changed
  const summaryParts: string[] = [];
  if (fieldChanges.status) {
    summaryParts.push(
      `Status ${String(fieldChanges.status.from)} → ${String(fieldChanges.status.to)}`
    );
  }
  if (fieldChanges.response) summaryParts.push("Supplier response updated");
  if (fieldChanges.notes) summaryParts.push("Internal notes updated");
  if (fieldChanges.attachments) {
    summaryParts.push(
      `${newAttachmentMeta.length} attachment(s) added`
    );
  }
  if (verified) summaryParts.push("CAR verified and closed");

  const action = verified
    ? "VERIFIED_CLOSED"
    : fieldChanges.status && Object.keys(fieldChanges).length === 1
      ? "STATUS_CHANGE"
      : fieldChanges.attachments && Object.keys(fieldChanges).length === 1
        ? "ATTACHMENT_ADDED"
        : fieldChanges.response && Object.keys(fieldChanges).length === 1
          ? "RESPONSE_UPDATED"
          : fieldChanges.notes && Object.keys(fieldChanges).length === 1
            ? "NOTES_UPDATED"
            : "UPDATED";

  await logCarActivity({
    dispositionId: d.id,
    carNumber: d.carNumber,
    action,
    summary:
      summaryParts.length > 0
        ? summaryParts.join(" · ")
        : `CAR ${d.carNumber} updated (no field changes)`,
    changes: Object.keys(fieldChanges).length ? fieldChanges : null,
    userId: params.userId,
  });

  await logAudit({
    entityType: "MrbDisposition",
    entityId: d.id,
    action: verified ? "CAR_VERIFIED_CLOSED" : "CAR_UPDATED",
    userId: params.userId,
    changes: fieldChanges,
    metadata: { carNumber: d.carNumber, carStatus: storedStatus },
  });

  return updated;
}

export async function listOpenCars() {
  return prisma.mrbDisposition.findMany({
    where: {
      carNumber: { not: null },
      carStatus: { notIn: ["CLOSED", "VERIFIED"] },
    },
    include: {
      mrbCase: {
        include: {
          ncr: { include: { part: true, supplier: true } },
        },
      },
      decidedBy: { select: { name: true } },
    },
    orderBy: { decidedAt: "desc" },
  });
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
