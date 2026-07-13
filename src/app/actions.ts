"use server";

import { revalidatePath } from "next/cache";
import {
  receivePurchaseOrder,
  receiveGfpTraveler,
  dispositionMrb,
  updateSupplierScorecard,
} from "@/lib/services/supply-chain";
import {
  createReceivingTravelerForPo,
  createCustomerGfpTraveler,
  syncReceivingTravelerStatus,
  closePurchaseOrderFromReceiving,
  closeGfpTraveler,
} from "@/lib/services/receiving";
import {
  decidePrApproval,
  saveApprovalPolicy,
  ensureDefaultPrApprovalPolicy,
} from "@/lib/services/pr-approval";
import {
  saveWorkCenter,
  reassignWorkOrderStation,
  reassignStepStation,
} from "@/lib/services/workcenters";
import { isWorkArea, type WorkArea } from "@/lib/work-areas";
import {
  createWorkOrder,
  updateWorkOrderStatus,
  signOffStep,
} from "@/lib/services/work-orders";
import {
  createSalesOrder,
  createQuote,
  convertQuoteToSalesOrder,
  planSalesOrderFulfillment,
  planWorkOrderMaterials,
  createKitOrder,
  completeKitOrder,
  startProductionFromKit,
  completeWorkOrderToStock,
  putAwayInventory,
  putAwayAllReceiving,
  shipSalesOrder,
  ensureShipmentForSalesOrder,
} from "@/lib/services/order-fulfillment";
import { certifyBom } from "@/lib/services/bom";
import { processAiQuery } from "@/lib/services/ai";
import { createCustomer, updateCustomer } from "@/lib/services/customers";
import {
  createPart,
  updatePart,
  upsertPartVendor,
  isSupplierApprovedForPo,
} from "@/lib/services/items";
import { saveUomUnit, saveUomConversion } from "@/lib/services/uom";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

function revalidateFulfillmentPaths(extra: string[] = []) {
  for (const p of [
    "/sales",
    "/shipping",
    "/work-orders",
    "/floor",
    "/purchasing",
    "/inventory",
    "/quality",
    "/kitting",
    "/value-stream",
    "/test-center",
    "/receiving",
    ...extra,
  ]) {
    revalidatePath(p);
  }
}

function parseDocPrefix(formData: FormData, prefix: string) {
  const docs: { url: string; fileName?: string; caption?: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = (formData.get(`${prefix}_${i}`) as string) || "";
    if (!url) continue;
    const fileName =
      ((formData.get(`${prefix}_name_${i}`) as string) || "").trim() ||
      undefined;
    const caption =
      ((formData.get(`${prefix}_caption_${i}`) as string) || "").trim() ||
      undefined;
    docs.push({ url, fileName, caption });
  }
  return docs;
}

export async function actionReceivePo(formData: FormData): Promise<void> {
  const purchaseOrderId = formData.get("purchaseOrderId") as string;
  const travelerId = (formData.get("travelerId") as string) || undefined;
  const failInspection = formData.get("failInspection") === "true";
  const putawayLocationCode =
    ((formData.get("putawayLocationCode") as string) || "").trim() || undefined;
  const packingSlip =
    ((formData.get("packingSlip") as string) || "").trim() || undefined;
  const notes = ((formData.get("notes") as string) || "").trim() || undefined;
  const receivingAck =
    formData.get("receivingAck") === "true" ||
    formData.get("receivingAck") === "on";
  const user = await getCurrentUser();

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!po) throw new Error("PO not found");

  // Per-line qty: qty_<poLineId>, optional lot_<poLineId>
  const lines: {
    poLineId: string;
    quantityReceived: number;
    lotNumber?: string;
    photos?: { url: string; caption?: string }[];
    visualResult?: "PASS" | "FAIL" | "PENDING";
    gdtResult?: "PASS" | "FAIL" | "PENDING";
    functionalResult?: "PASS" | "FAIL" | "PENDING";
    visualDocs?: { url: string; fileName?: string; caption?: string }[];
    gdtDocs?: { url: string; fileName?: string; caption?: string }[];
    functionalDocs?: { url: string; fileName?: string; caption?: string }[];
  }[] = [];

  for (const poLine of po.lines) {
    const open = poLine.quantity - poLine.quantityReceived;
    if (open <= 0) continue;
    const raw = formData.get(`qty_${poLine.id}`);
    // If no per-line fields, fall back to full remaining (legacy one-click)
    const qty =
      raw === null || raw === undefined || raw === ""
        ? open
        : Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const lot =
      ((formData.get(`lot_${poLine.id}`) as string) || "").trim() ||
      `LOT-RCV-${Date.now().toString(36).toUpperCase()}`;

    // Photos: photo_<lineId>_<i> data URLs + caption_<lineId>_<i>
    const photos: { url: string; caption?: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const url = (formData.get(`photo_${poLine.id}_${i}`) as string) || "";
      if (!url) continue;
      const caption =
        ((formData.get(`caption_${poLine.id}_${i}`) as string) || "").trim() ||
        undefined;
      photos.push({ url, caption });
    }

    // Pending tests are set only at QA/Test — dock cannot pass/fail them
    lines.push({
      poLineId: poLine.id,
      quantityReceived: Math.min(qty, open),
      lotNumber: lot,
      photos: photos.length ? photos : undefined,
      visualResult: "PENDING",
      gdtResult: "PENDING",
      functionalResult: "PENDING",
    });
  }

  // Shared traveler-level photos (apply to all lines if no line photos)
  const sharedPhotos: { url: string; caption?: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = (formData.get(`photo_shared_${i}`) as string) || "";
    if (!url) continue;
    const caption =
      ((formData.get(`caption_shared_${i}`) as string) || "").trim() ||
      undefined;
    sharedPhotos.push({ url, caption });
  }

  if (lines.length === 0 && !formData.get("isGfpTraveler")) {
    // may be GFP traveler using travelerLine ids
  }

  const isGfpTraveler = formData.get("isGfpTraveler") === "true";
  const dd1149Docs = parseDocPrefix(formData, "dd1149_doc");

  if (isGfpTraveler) {
    if (!travelerId) throw new Error("Traveler required");
    const gfpLines: {
      travelerLineId: string;
      quantityReceived: number;
      lotNumber?: string;
      govPropNumber?: string;
      visualResult?: "PASS" | "FAIL" | "PENDING";
      gdtResult?: "PASS" | "FAIL" | "PENDING";
      functionalResult?: "PASS" | "FAIL" | "PENDING";
      visualDocs?: { url: string; fileName?: string; caption?: string }[];
      gdtDocs?: { url: string; fileName?: string; caption?: string }[];
      functionalDocs?: { url: string; fileName?: string; caption?: string }[];
    }[] = [];

    // traveler lines use qty_tline_<id>
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("qty_tline_")) continue;
      const travelerLineId = key.replace("qty_tline_", "");
      const qty = Number(value);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const lot =
        ((formData.get(`lot_tline_${travelerLineId}`) as string) || "").trim() ||
        `LOT-GFP-${Date.now().toString(36).toUpperCase()}`;
      const govPropNumber =
        ((formData.get(`govProp_${travelerLineId}`) as string) || "").trim() ||
        undefined;
      // Pending tests are set only at QA/Test — dock cannot pass/fail them
      gfpLines.push({
        travelerLineId,
        quantityReceived: qty,
        lotNumber: lot,
        govPropNumber,
        visualResult: "PENDING",
        gdtResult: "PENDING",
        functionalResult: "PENDING",
      });
    }
    if (!gfpLines.length) throw new Error("Nothing left to receive");

    const contractNumber =
      ((formData.get("contractNumber") as string) || "").trim() || undefined;

    const result = await receiveGfpTraveler({
      travelerId,
      lines: gfpLines,
      receivedById: user?.id,
      receivingAck,
      putawayLocationCode: putawayLocationCode,
      packingSlip,
      notes,
      photos: sharedPhotos.length ? sharedPhotos : undefined,
      packingListDocs: parseDocPrefix(formData, "packing_doc"),
      cocDocs: parseDocPrefix(formData, "coc_doc"),
      materialCertDocs: parseDocPrefix(formData, "cert_doc"),
      dd1149Docs,
      contractNumber,
    });

    if (!result.inInspection) {
      await syncReceivingTravelerStatus(null, {
        sourceTravelerId: travelerId,
        userId: user?.id,
        createChildIfPartial: result.partial,
      });
    }

    revalidateFulfillmentPaths([
      "/receiving",
      `/receiving/${travelerId}`,
      "/inventory",
      "/government-property",
      "/quality",
      "/floor",
      "/test-center",
    ]);
    return;
  }

  if (lines.length === 0) throw new Error("Nothing left to receive");

  const contractNumber =
    ((formData.get("contractNumber") as string) || "").trim() || undefined;
  const govPropNumbers: Record<string, string> = {};
  for (const line of lines) {
    const tag =
      ((formData.get(`govProp_${line.poLineId}`) as string) || "").trim();
    if (tag) govPropNumbers[line.poLineId] = tag;
  }

  const result = await receivePurchaseOrder({
    purchaseOrderId,
    travelerId,
    lines,
    receivedById: user?.id,
    receivingAck,
    failInspection,
    putawayLocationCode: failInspection ? undefined : putawayLocationCode,
    packingSlip,
    notes,
    photos: sharedPhotos.length ? sharedPhotos : undefined,
    packingListDocs: parseDocPrefix(formData, "packing_doc"),
    cocDocs: parseDocPrefix(formData, "coc_doc"),
    materialCertDocs: parseDocPrefix(formData, "cert_doc"),
    dd1149Docs,
    contractNumber,
    govPropNumbers:
      Object.keys(govPropNumbers).length > 0 ? govPropNumbers : undefined,
  });

  // Keep traveler open (IN_INSPECTION) when routed — don't mark complete
  if (!result.inInspection) {
    await syncReceivingTravelerStatus(purchaseOrderId, {
      sourceTravelerId: travelerId,
      userId: user?.id,
      createChildIfPartial: result.partial,
    });
  }

  revalidateFulfillmentPaths([
    "/purchasing",
    `/purchasing/po/${purchaseOrderId}`,
    "/receiving",
    travelerId ? `/receiving/${travelerId}` : "/receiving",
    "/mrb",
    "/suppliers",
    "/inventory",
    "/quality",
    "/floor",
    "/work-orders",
    "/government-property",
    "/test-center",
  ]);
}

export async function actionCompleteReceivingPutaway(
  formData: FormData
): Promise<void> {
  const { completeReceivingAfterInspection } = await import(
    "@/lib/services/receiving-inspection"
  );
  const travelerId = formData.get("travelerId") as string;
  const putawayLocationCode = (
    (formData.get("putawayLocationCode") as string) || ""
  ).trim();
  if (!putawayLocationCode) throw new Error("Select putaway location");
  const user = await getCurrentUser();
  await completeReceivingAfterInspection({
    travelerId,
    putawayLocationCode,
    userId: user?.id,
  });
  revalidateFulfillmentPaths([
    `/receiving/${travelerId}`,
    "/receiving",
    "/inventory",
    "/quality",
    "/test-center",
    "/government-property",
  ]);
}

export async function actionCreateGfpTraveler(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const customerId =
    ((formData.get("customerId") as string) || "").trim() || undefined;
  const contractNumber =
    ((formData.get("contractNumber") as string) || "").trim() || undefined;
  const clin = ((formData.get("clin") as string) || "").trim() || undefined;
  const notes = ((formData.get("notes") as string) || "").trim() || undefined;
  const shipFromName =
    ((formData.get("shipFromName") as string) || "").trim() || undefined;
  const shipFromAddress =
    ((formData.get("shipFromAddress") as string) || "").trim() || undefined;
  const expectedRaw = (formData.get("expectedDate") as string) || "";
  const expectedDate = expectedRaw ? new Date(expectedRaw) : undefined;

  const lines: {
    partId?: string;
    description: string;
    quantity: number;
    uom?: string;
    unitCost?: number;
  }[] = [];

  for (let i = 0; i < 40; i++) {
    const description = ((formData.get(`line_desc_${i}`) as string) || "").trim();
    if (!description) continue;
    const qty = Number(formData.get(`line_qty_${i}`) || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const partId =
      ((formData.get(`line_part_${i}`) as string) || "").trim() || undefined;
    const uom = ((formData.get(`line_uom_${i}`) as string) || "EA").trim();
    const unitCost = Number(formData.get(`line_cost_${i}`) || 0);
    lines.push({
      partId,
      description,
      quantity: qty,
      uom,
      unitCost: Number.isFinite(unitCost) ? unitCost : 0,
    });
  }

  const traveler = await createCustomerGfpTraveler({
    customerId,
    contractNumber,
    clin,
    notes,
    shipFromName,
    shipFromAddress,
    expectedDate,
    lines,
    userId: user?.id,
  });

  revalidatePath("/receiving");
  revalidatePath("/government-property");
  redirect(`/receiving/${traveler.id}`);
}

export async function actionCloseGfpTraveler(formData: FormData): Promise<void> {
  const travelerId = formData.get("travelerId") as string;
  const user = await getCurrentUser();
  await closeGfpTraveler({ travelerId, userId: user?.id });
  revalidatePath("/receiving");
  revalidatePath(`/receiving/${travelerId}`);
  revalidatePath("/government-property");
}

/** Close PO from the purchasing PO module (not receiving dock). */
export async function actionClosePurchaseOrder(formData: FormData): Promise<void> {
  const purchaseOrderId = formData.get("purchaseOrderId") as string;
  const user = await getCurrentUser("PURCHASING");
  await closePurchaseOrderFromReceiving({
    purchaseOrderId,
    userId: user?.id,
  });
  revalidateFulfillmentPaths([
    "/purchasing",
    `/purchasing/po/${purchaseOrderId}`,
    "/receiving",
  ]);
  redirect(`/purchasing/po/${purchaseOrderId}`);
}

/** @deprecated use actionClosePurchaseOrder from PO module */
export async function actionClosePoFromReceiving(formData: FormData): Promise<void> {
  return actionClosePurchaseOrder(formData);
}

export async function actionCreateItemBom(formData: FormData): Promise<void> {
  const { createOrLinkBom } = await import("@/lib/services/bom");
  const partId = formStr(formData, "partId");
  const user = await getCurrentUser();
  const bom = await createOrLinkBom({
    partId,
    revision: formStr(formData, "revision") || "A",
    description: formStr(formData, "description") || undefined,
    asPrototype: formBool(formData, "asPrototype"),
    copyFromBomId: formOptId(formData, "copyFromBomId") || undefined,
    userId: user?.id,
  });
  revalidatePath("/items");
  revalidatePath(`/items/${partId}`);
  revalidatePath("/bom");
  revalidatePath(`/bom/${bom.id}`);
  redirect(`/items/${partId}?tab=bom`);
}

export async function actionAddBomLine(formData: FormData): Promise<void> {
  const { addBomLine } = await import("@/lib/services/bom");
  const bomHeaderId = formStr(formData, "bomHeaderId");
  const partId = formStr(formData, "partId");
  const user = await getCurrentUser();
  await addBomLine({
    bomHeaderId,
    componentPartId: formStr(formData, "componentPartId"),
    quantity: formNum(formData, "quantity", 1),
    findNumber: formStr(formData, "findNumber") || undefined,
    notes: formStr(formData, "notes") || undefined,
    userId: user?.id,
  });
  revalidatePath(`/items/${partId}`);
  revalidatePath(`/bom/${bomHeaderId}`);
  revalidatePath("/bom");
  redirect(`/items/${partId}?tab=bom`);
}

export async function actionRemoveBomLine(formData: FormData): Promise<void> {
  const { removeBomLine } = await import("@/lib/services/bom");
  const bomLineId = formStr(formData, "bomLineId");
  const partId = formStr(formData, "partId");
  const bomHeaderId = formStr(formData, "bomHeaderId");
  const user = await getCurrentUser();
  await removeBomLine({ bomLineId, userId: user?.id });
  revalidatePath(`/items/${partId}`);
  revalidatePath(`/bom/${bomHeaderId}`);
  redirect(`/items/${partId}?tab=bom`);
}

export async function actionCloseMrbCase(formData: FormData): Promise<void> {
  const mrbCaseId = formData.get("mrbCaseId") as string;
  const user = await getCurrentUser();
  const { closeMrbCase } = await import("@/lib/services/supply-chain");
  await closeMrbCase({ mrbCaseId, closedById: user?.id });
  revalidatePath("/mrb");
}

export async function actionDispositionMrb(formData: FormData) {
  const mrbCaseId = formData.get("mrbCaseId") as string;
  const disposition = formData.get("disposition") as
    | "USE_AS_IS"
    | "REWORK"
    | "SCRAP"
    | "RETURN_TO_SUPPLIER"
    | "REPAIR";
  const justification = (formData.get("justification") as string) || "";
  const quantity = Number(formData.get("quantity") || 1);
  const createCar = formData.get("createCar") === "true";
  const user = await getCurrentUser();

  const result = await dispositionMrb({
    mrbCaseId,
    disposition,
    quantity,
    justification,
    decidedById: user?.id,
    createCar,
  });

  revalidatePath("/mrb");
  revalidatePath("/quality");
  revalidatePath("/inventory");
  revalidatePath("/suppliers");
  revalidatePath("/work-orders");
  revalidatePath("/floor");
  if (result.carNumber) {
    redirect(`/mrb?view=cars&filter=open&car=${result.carNumber}`);
  }
  redirect("/mrb?view=mrb&filter=open");
}

export async function actionUpdateCar(formData: FormData): Promise<void> {
  const { updateCar } = await import("@/lib/services/supply-chain");
  const dispositionId = formData.get("dispositionId") as string;
  const user = await getCurrentUser("QUALITY");
  const attachments: { url: string; fileName?: string; caption?: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = (formData.get(`car_doc_${i}`) as string) || "";
    if (!url) continue;
    attachments.push({
      url,
      fileName:
        ((formData.get(`car_doc_name_${i}`) as string) || "").trim() ||
        undefined,
      caption:
        ((formData.get(`car_doc_caption_${i}`) as string) || "").trim() ||
        undefined,
    });
  }
  await updateCar({
    dispositionId,
    carStatus: ((formData.get("carStatus") as string) || "").trim() || undefined,
    carResponse: ((formData.get("carResponse") as string) || "").trim() || undefined,
    carNotes: ((formData.get("carNotes") as string) || "").trim() || undefined,
    carAttachments: attachments.length ? attachments : undefined,
    userId: user?.id,
  });
  // Revalidate only — no redirect (client form catches redirect as "NEXT_REDIRECT")
  revalidatePath("/mrb");
  revalidatePath("/quality");
  revalidatePath("/suppliers");
}

export async function actionSignOffStep(formData: FormData) {
  const workOrderId = formData.get("workOrderId") as string;
  const stepId = formData.get("stepId") as string;
  const result = (formData.get("result") as string) || "PASS";
  const measuredValue = (formData.get("measuredValue") as string) || undefined;
  const measureUom = (formData.get("measureUom") as string) || undefined;
  const notes = (formData.get("notes") as string) || undefined;
  const pinCode = (formData.get("pinCode") as string) || undefined;
  const user = await getCurrentUser("OPERATOR");

  if (!user) throw new Error("No user");

  await signOffStep({
    workOrderId,
    stepId,
    userId: user.id,
    result,
    measuredValue,
    measureUom,
    notes,
    pinCode,
  });

  revalidatePath(`/work-orders/${workOrderId}`);
  revalidatePath("/floor");
  revalidatePath("/work-orders");
  revalidatePath("/test-center");
  revalidatePath("/quality");
  revalidatePath("/inventory");
}

export async function actionUpdateWoStatus(formData: FormData) {
  const workOrderId = formData.get("workOrderId") as string;
  const toStatus = formData.get("toStatus") as string;
  const user = await getCurrentUser();

  // Route COMPLETED through stock + shipping handoff
  if (toStatus === "COMPLETED") {
    await completeWorkOrderToStock({ workOrderId, userId: user?.id });
  } else {
    await updateWorkOrderStatus({
      workOrderId,
      toStatus,
      userId: user?.id,
    });
  }

  revalidateFulfillmentPaths([`/work-orders/${workOrderId}`]);
}

export async function actionSaveWorkCenter(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = ((formData.get("id") as string) || "").trim() || undefined;
  const code = ((formData.get("code") as string) || "").trim();
  const name = ((formData.get("name") as string) || "").trim();
  const areaRaw = ((formData.get("area") as string) || "MANUFACTURING").trim();
  const returnPath =
    ((formData.get("returnPath") as string) || "").trim() || "/workcenters";
  if (!isWorkArea(areaRaw)) throw new Error("Invalid area");
  await saveWorkCenter({
    id,
    code,
    name,
    area: areaRaw as WorkArea,
    department: ((formData.get("department") as string) || "").trim() || undefined,
    capacityHoursPerDay: Number(formData.get("capacityHoursPerDay") || 16),
    efficiency: Number(formData.get("efficiency") || 0.85),
    isActive:
      formData.get("isActive") === "true" ||
      formData.get("isActive") === "on" ||
      !formData.has("isActive"),
    isDefault:
      formData.get("isDefault") === "true" || formData.get("isDefault") === "on",
    sortOrder: Number(formData.get("sortOrder") || 0),
    userId: user?.id,
  });
  revalidatePath("/workcenters");
  revalidatePath("/floor");
  revalidatePath("/test-center");
  revalidatePath("/quality");
  revalidatePath("/qa");
  revalidatePath("/work-orders");
  revalidatePath(returnPath);
  redirect(returnPath.includes("?") ? returnPath : `${returnPath}?tab=stations`);
}

export async function actionScanWorkOrderToStation(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  let workOrderId = ((formData.get("workOrderId") as string) || "").trim();
  const workOrderNumber = (
    (formData.get("workOrderNumber") as string) || ""
  )
    .trim()
    .toUpperCase();
  const workCenterCode = (
    (formData.get("workCenterCode") as string) || ""
  ).trim();
  const returnPath =
    ((formData.get("returnPath") as string) || "").trim() || "/floor";

  if (!workOrderId && workOrderNumber) {
    const wo = await prisma.workOrder.findFirst({
      where: { number: workOrderNumber },
    });
    if (!wo) throw new Error(`Work order ${workOrderNumber} not found`);
    workOrderId = wo.id;
  }
  if (!workOrderId) throw new Error("Select or enter a work order");
  if (!workCenterCode) throw new Error("Select a station");

  await reassignWorkOrderStation({
    workOrderId,
    workCenterCode,
    userId: user?.id,
    force: true,
  });

  // Scanning in starts work if still released/planned
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (wo && ["PLANNED", "RELEASED", "KITTED"].includes(wo.status)) {
    await updateWorkOrderStatus({
      workOrderId,
      toStatus: "IN_PROGRESS",
      userId: user?.id,
      notes: `Scanned into ${workCenterCode}`,
    });
  }

  revalidatePath("/floor");
  revalidatePath("/test-center");
  revalidatePath("/qa");
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${workOrderId}`);
  revalidatePath(returnPath);
  redirect(
    returnPath.includes("?")
      ? returnPath
      : `${returnPath}?tab=stations&scanned=${encodeURIComponent(workCenterCode)}`
  );
}

export async function actionReassignWoStation(formData: FormData): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const workCenterCode = ((formData.get("workCenterCode") as string) || "").trim();
  const force =
    formData.get("force") === "true" || formData.get("force") === "on";
  const user = await getCurrentUser();
  await reassignWorkOrderStation({
    workOrderId,
    workCenterCode,
    userId: user?.id,
    force,
  });
  revalidateFulfillmentPaths([
    `/work-orders/${workOrderId}`,
    "/work-orders",
    "/floor",
    "/test-center",
    "/quality",
  ]);
}

export async function actionReassignStepStation(
  formData: FormData
): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const stepId = formData.get("stepId") as string;
  const workCenterCode = ((formData.get("workCenterCode") as string) || "").trim();
  const force =
    formData.get("force") === "true" || formData.get("force") === "on";
  const user = await getCurrentUser();
  await reassignStepStation({
    workOrderId,
    stepId,
    workCenterCode,
    userId: user?.id,
    force,
  });
  revalidateFulfillmentPaths([
    `/work-orders/${workOrderId}`,
    "/floor",
    "/test-center",
    "/quality",
  ]);
}

export async function actionUpdateWiStepRouting(
  formData: FormData
): Promise<void> {
  const stepId = formData.get("stepId") as string;
  const wiId = formData.get("workInstructionId") as string;
  const requiredArea = ((formData.get("requiredArea") as string) || "").trim();
  const workCenter = ((formData.get("workCenter") as string) || "").trim();
  const routeLock =
    formData.get("routeLock") === "true" || formData.get("routeLock") === "on";
  const user = await getCurrentUser();

  const wi = await prisma.workInstruction.findUnique({ where: { id: wiId } });
  if (!wi) throw new Error("WI not found");
  if (wi.isLocked || wi.status === "RELEASED" || wi.status === "OBSOLETE") {
    throw new Error("Released WIs are locked — create a new revision to change");
  }

  await prisma.workInstructionStep.update({
    where: { id: stepId },
    data: {
      requiredArea: requiredArea || null,
      workCenter: workCenter || null,
      routeLock,
    },
  });
  await logAudit({
    entityType: "WorkInstructionStep",
    entityId: stepId,
    action: "ROUTING_UPDATED",
    userId: user?.id,
    metadata: { requiredArea, workCenter, routeLock },
  });
  revalidatePath(`/work-instructions/${wiId}`);
  revalidatePath("/work-instructions");
}

export async function actionCertifyBom(formData: FormData) {
  const bomHeaderId = formData.get("bomHeaderId") as string;
  const user = await getCurrentUser("CM");

  await certifyBom({ bomHeaderId, userId: user?.id });

  revalidatePath("/bom");
  revalidatePath(`/bom/${bomHeaderId}`);
}

export async function actionCreateWoFromBom(formData: FormData): Promise<void> {
  const bomHeaderId = formData.get("bomHeaderId") as string;
  const quantity = Number(formData.get("quantity") || 1);
  const type = (formData.get("type") as string) || "PRODUCTION";
  const projectId = ((formData.get("projectId") as string) || "").trim() || undefined;
  const status = ((formData.get("status") as string) || "PLANNED").trim();
  const user = await getCurrentUser();

  const wo = await createWorkOrder({
    bomHeaderId,
    quantity,
    type,
    sourceType: "BOM",
    // Only attach project when user explicitly selected one
    projectId,
    department:
      ((formData.get("department") as string) || "").trim() || undefined,
    createdById: user?.id,
    workCenter: "ASM-01",
    status,
  });

  revalidatePath("/work-orders");
  revalidatePath("/floor");
  revalidatePath("/bom");
  redirect(`/work-orders/${wo.id}`);
}

export async function actionCreateForecast(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createForecast } = await import("@/lib/services/planning");
  const name = ((formData.get("name") as string) || "").trim();
  const notes = ((formData.get("notes") as string) || "").trim() || null;
  const periodStartRaw = ((formData.get("periodStart") as string) || "").trim();
  const periodEndRaw = ((formData.get("periodEnd") as string) || "").trim();

  const lines: {
    partId: string;
    quantity: number;
    dueDate?: Date | null;
  }[] = [];
  for (let i = 0; i < 40; i++) {
    const partId = ((formData.get(`partId_${i}`) as string) || "").trim();
    if (!partId) continue;
    const quantity = Number(formData.get(`qty_${i}`) || 0);
    if (!(quantity > 0)) continue;
    const dueRaw = ((formData.get(`due_${i}`) as string) || "").trim();
    lines.push({
      partId,
      quantity,
      dueDate: dueRaw ? new Date(dueRaw) : null,
    });
  }

  const forecast = await createForecast({
    name,
    notes,
    periodStart: periodStartRaw ? new Date(periodStartRaw) : null,
    periodEnd: periodEndRaw ? new Date(periodEndRaw) : null,
    lines,
    userId: user?.id,
  });

  revalidatePath("/planning");
  redirect(`/planning/forecasts/${forecast.id}`);
}

export async function actionGenerateMrsFromForecast(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const forecastId = formData.get("forecastId") as string;
  const { generateMaterialRequisitionFromForecast } = await import(
    "@/lib/services/planning"
  );
  const mrs = await generateMaterialRequisitionFromForecast({
    forecastId,
    userId: user?.id,
  });
  revalidatePath("/planning");
  revalidatePath(`/planning/forecasts/${forecastId}`);
  redirect(`/planning/mrs/${mrs.id}`);
}

export async function actionReleaseMaterialRequisition(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const materialRequisitionId = formData.get("materialRequisitionId") as string;
  const { releaseMaterialRequisition } = await import(
    "@/lib/services/planning"
  );
  await releaseMaterialRequisition({
    materialRequisitionId,
    userId: user?.id,
  });
  revalidatePath("/planning");
  revalidatePath(`/planning/mrs/${materialRequisitionId}`);
  revalidatePath("/work-orders");
  revalidatePath("/floor");
  redirect(`/planning/mrs/${materialRequisitionId}`);
}

export async function actionCreateTaskWo(formData: FormData): Promise<void> {
  const description = formData.get("description") as string;
  const status = ((formData.get("status") as string) || "BACKLOG").trim();
  const user = await getCurrentUser();

  const wi = await prisma.workInstruction.findFirst({
    where: { documentNumber: "WI-5S-DAILY", status: "RELEASED" },
  });

  const wo = await createWorkOrder({
    type: "TASK_ONLY",
    description: description || "Task-only work order",
    department:
      ((formData.get("department") as string) || "").trim() || undefined,
    createdById: user?.id,
    workCenter: "ASM-01",
    workInstructionIds: wi ? [wi.id] : [],
    status,
  });

  revalidatePath("/work-orders");
  revalidatePath("/floor");
  redirect(`/work-orders/${wo.id}`);
}

export async function actionCreateProductionWo(formData: FormData): Promise<void> {
  return actionCreateWoFromBom(formData);
}

export async function actionApprovePr(formData: FormData) {
  const id = formData.get("id") as string;
  const decision =
    ((formData.get("decision") as string) || "APPROVED") === "REJECTED"
      ? "REJECTED"
      : "APPROVED";
  const comments =
    ((formData.get("comments") as string) || "").trim() || undefined;
  // Prefer the demo user's actual role so multi-step policies can be exercised
  // by switching DEMO_USER_ROLE. ADMIN can approve any step.
  const user = await getCurrentUser();
  await ensureDefaultPrApprovalPolicy();
  await decidePrApproval({
    purchaseRequestId: id,
    decision,
    comments,
    userId: user?.id,
    userRole: user?.role,
  });
  revalidatePath("/purchasing");
  revalidatePath("/purchasing/approvals");
}

export async function actionSaveApprovalPolicy(formData: FormData): Promise<void> {
  const user = await getCurrentUser("ADMIN");
  const id = ((formData.get("id") as string) || "").trim() || undefined;
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) throw new Error("Policy name required");
  const description =
    ((formData.get("description") as string) || "").trim() || undefined;
  const isDefault =
    formData.get("isDefault") === "true" || formData.get("isDefault") === "on";
  // Checkbox: present = active
  const isActive =
    formData.get("isActive") === "true" || formData.get("isActive") === "on";

  const steps: {
    stepOrder: number;
    name: string;
    minAmount: number;
    approverRole?: string | null;
    approverUserId?: string | null;
  }[] = [];

  for (let i = 0; i < 20; i++) {
    const stepName = ((formData.get(`step_name_${i}`) as string) || "").trim();
    if (!stepName) continue;
    const stepOrder = Number(formData.get(`step_order_${i}`) || i + 1);
    const minAmount = Number(formData.get(`step_min_${i}`) || 0);
    const approverRole =
      ((formData.get(`step_role_${i}`) as string) || "").trim() || null;
    const approverUserId =
      ((formData.get(`step_user_${i}`) as string) || "").trim() || null;
    steps.push({
      stepOrder: Number.isFinite(stepOrder) ? stepOrder : i + 1,
      name: stepName,
      minAmount: Number.isFinite(minAmount) ? minAmount : 0,
      approverRole,
      approverUserId,
    });
  }

  if (steps.length === 0) throw new Error("Add at least one approval step");

  await saveApprovalPolicy({
    id,
    name,
    description,
    isDefault,
    isActive: isActive !== false,
    steps,
    userId: user?.id,
  });

  revalidatePath("/purchasing");
  revalidatePath("/purchasing/approvals");
  redirect("/purchasing/approvals");
}

export async function actionConvertPrToPo(formData: FormData): Promise<void> {
  const id = ((formData.get("id") as string) || "").trim();
  if (!id) throw new Error("Purchase request id required");

  const user = await getCurrentUser("PURCHASING");
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: {
      lines: true,
      supplier: true,
      project: { select: { id: true, projectManagerId: true } },
      workOrder: {
        include: {
          project: { select: { id: true, projectManagerId: true } },
          wbsElement: true,
        },
      },
    },
  });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status === "CONVERTED") {
    const existing = await prisma.purchaseOrder.findFirst({
      where: { purchaseRequestId: pr.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      revalidatePath("/purchasing");
      redirect(`/purchasing/po/${existing.id}`);
    }
    throw new Error("PR already converted but PO not found");
  }
  if (pr.status !== "APPROVED") {
    throw new Error(`PR must be approved (current status: ${pr.status})`);
  }
  if (!pr.supplierId || !pr.supplier) throw new Error("PR needs a supplier");
  if (!isSupplierApprovedForPo(pr.supplier)) {
    throw new Error(
      `Supplier ${pr.supplier.code} is not on the Approved Supplier List (ASL). ` +
        "Only ASL vendors (isApprovedVendor + APPROVED/CONDITIONAL) can be used on POs."
    );
  }
  if (!pr.lines.length) {
    throw new Error("PR has no lines — add line items before converting to PO");
  }

  const isGovernmentProperty =
    formData.get("isGovernmentProperty") === "true" ||
    formData.get("isGovernmentProperty") === "on" ||
    /government property|gfp|gfe/i.test(pr.justification || "");

  // Stable unique PO number (avoid race on count)
  const count = await prisma.purchaseOrder.count();
  let number = `PO-${String(count + 1).padStart(5, "0")}`;
  const clash = await prisma.purchaseOrder.findUnique({ where: { number } });
  if (clash) {
    number = `PO-${String(count + 1).padStart(5, "0")}-${Date.now().toString(36).slice(-4)}`;
  }

  const projectId =
    pr.projectId || pr.workOrder?.projectId || pr.project?.id || undefined;
  const wbsElementId = pr.workOrder?.wbsElementId || undefined;

  let po;
  try {
    po = await prisma.purchaseOrder.create({
      data: {
        number,
        status: "ISSUED",
        supplierId: pr.supplierId,
        purchaseRequestId: pr.id,
        totalAmount: pr.totalEstimate,
        buyerId: user?.id,
        promisedDate: pr.neededBy || undefined,
        projectId,
        wbsElementId,
        shipToAddress:
          "Forge Dynamics LLC\nReceiving Dock\n1200 Precision Way\nHuntsville, AL 35806",
        notes: [
          pr.justification || "",
          isGovernmentProperty
            ? "PO procures government property — DD1149 + putaway to GFP area at receive"
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        isGovernmentProperty,
        lines: {
          create: pr.lines.map((l, i) => ({
            partId: l.partId || undefined,
            description: l.description || "Line item",
            quantity: l.quantity || 1,
            unitCost: l.estimatedUnitCost || 0,
            uom: l.uom || "EA",
            lineNumber: i + 1,
            promisedDate: pr.neededBy || undefined,
          })),
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create PO";
    throw new Error(`Convert to PO failed: ${msg}`);
  }

  await prisma.purchaseRequest.update({
    where: { id },
    data: { status: "CONVERTED" },
  });

  if (pr.supplier.isTrialVendor) {
    await prisma.supplier.update({
      where: { id: pr.supplierId },
      data: { trialOrdersUsed: { increment: 1 } },
    });
  }

  try {
    await createReceivingTravelerForPo({
      purchaseOrderId: po.id,
      userId: user?.id,
    });
  } catch (e) {
    // PO still created — do not fail conversion if traveler fails
    console.error("Receiving traveler creation failed", e);
  }

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "CREATED_FROM_PR",
    userId: user?.id,
    metadata: { prNumber: pr.number },
  });

  revalidatePath("/purchasing");
  revalidatePath("/receiving");
  revalidatePath("/suppliers");
  revalidatePath(`/purchasing/po/${po.id}`);
  redirect(`/purchasing/po/${po.id}`);
}

export async function actionRefreshScorecard(formData: FormData) {
  const supplierId = formData.get("supplierId") as string;
  await updateSupplierScorecard(supplierId);
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath("/suppliers");
}

export async function actionAiChat(query: string) {
  return processAiQuery(query);
}

export async function actionAdvanceWiStatus(formData: FormData) {
  const id = formData.get("id") as string;
  const toStatus = formData.get("toStatus") as string;
  const user = await getCurrentUser();

  // RELEASE only via CM board — not direct advance from WI
  if (toStatus === "RELEASED") {
    throw new Error(
      "Release only from CM after board approval. Use Submit to CM."
    );
  }
  if (toStatus === "CM_REVIEW") {
    const { submitWiToCm } = await import("@/lib/services/work-instructions");
    await submitWiToCm({ workInstructionId: id, userId: user?.id });
    revalidatePath("/work-instructions");
    revalidatePath(`/work-instructions/${id}`);
    revalidatePath("/cm");
    redirect("/cm");
  }

  const wi = await prisma.workInstruction.findUnique({ where: { id } });
  if (!wi) throw new Error("WI not found");
  if (wi.isLocked) throw new Error("Locked released WI — create a new revision");

  await prisma.workInstruction.update({
    where: { id },
    data: { status: toStatus },
  });
  await logAudit({
    entityType: "WorkInstruction",
    entityId: id,
    action: "STATUS_CHANGE",
    userId: user?.id,
    changes: { to: toStatus },
  });
  revalidatePath("/work-instructions");
  revalidatePath(`/work-instructions/${id}`);
}

export async function actionSubmitWiToCm(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const notes = ((formData.get("notes") as string) || "").trim() || undefined;
  const user = await getCurrentUser("ENGINEERING");
  const { submitWiToCm } = await import("@/lib/services/work-instructions");
  await submitWiToCm({
    workInstructionId: id,
    userId: user?.id,
    notes,
  });
  revalidatePath("/work-instructions");
  revalidatePath(`/work-instructions/${id}`);
  revalidatePath("/cm");
  redirect("/cm");
}

export async function actionCreateWiRevision(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const user = await getCurrentUser("ENGINEERING");
  const { createWiRevisionFromReleased } = await import(
    "@/lib/services/work-instructions"
  );
  const rev = await createWiRevisionFromReleased({
    workInstructionId: id,
    userId: user?.id,
  });
  revalidatePath("/work-instructions");
  redirect(`/work-instructions/${rev.id}`);
}

export async function actionCreateWorkInstruction(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("ENGINEERING");
  const { createWorkInstruction } = await import(
    "@/lib/services/work-instructions"
  );
  // Parse steps from form: step_title_0, step_instructions_0, ...
  const steps: {
    title: string;
    instructions: string;
    stepType?: string;
    passFailRequired?: boolean;
    isTestStep?: boolean;
    measureUom?: string;
    expectedValue?: string;
    cureTimeMinutes?: number;
    requiredArea?: string;
    workCenter?: string;
    attachmentUrls?: string[];
  }[] = [];
  for (let i = 0; i < 40; i++) {
    const title = ((formData.get(`step_title_${i}`) as string) || "").trim();
    if (!title) continue;
    const instructions =
      ((formData.get(`step_instructions_${i}`) as string) || "").trim() ||
      title;
    const stepType =
      ((formData.get(`step_type_${i}`) as string) || "BUILD").trim().toUpperCase();
    const photos: string[] = [];
    for (let p = 0; p < 8; p++) {
      const u = ((formData.get(`step_photo_${i}_${p}`) as string) || "").trim();
      if (u) photos.push(u);
    }
    steps.push({
      title,
      instructions,
      stepType,
      passFailRequired:
        formData.get(`step_passfail_${i}`) === "on" ||
        formData.get(`step_passfail_${i}`) === "true" ||
        stepType === "QA" ||
        stepType === "TEST",
      isTestStep: stepType === "TEST",
      measureUom:
        ((formData.get(`step_uom_${i}`) as string) || "").trim() || undefined,
      expectedValue:
        ((formData.get(`step_expected_${i}`) as string) || "").trim() ||
        undefined,
      cureTimeMinutes: (() => {
        const n = Number(formData.get(`step_cure_${i}`) || 0);
        return n > 0 ? n : undefined;
      })(),
      requiredArea:
        ((formData.get(`step_area_${i}`) as string) || "").trim() || undefined,
      workCenter:
        ((formData.get(`step_wc_${i}`) as string) || "").trim() || undefined,
      attachmentUrls: photos,
    });
  }

  // Required tools: tool_name_0, tool_partId_0, tool_qty_0
  const requiredTools: {
    name: string;
    partId?: string | null;
    qty?: number;
  }[] = [];
  for (let i = 0; i < 20; i++) {
    const name = ((formData.get(`tool_name_${i}`) as string) || "").trim();
    if (!name) continue;
    const partId =
      ((formData.get(`tool_partId_${i}`) as string) || "").trim() || null;
    const qty = Number(formData.get(`tool_qty_${i}`) || 1);
    requiredTools.push({
      name,
      partId,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    });
  }

  const wi = await createWorkInstruction({
    documentNumber: ((formData.get("documentNumber") as string) || "").trim(),
    revision: ((formData.get("revision") as string) || "A").trim(),
    title: ((formData.get("title") as string) || "").trim(),
    partId: ((formData.get("partId") as string) || "").trim() || null,
    bomHeaderId: ((formData.get("bomHeaderId") as string) || "").trim() || null,
    workCenter: ((formData.get("workCenter") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
    hazmatRequired:
      ((formData.get("hazmatRequired") as string) || "").trim() || null,
    drawingNumber:
      ((formData.get("drawingNumber") as string) || "").trim() || null,
    drawingReferences:
      ((formData.get("drawingReferences") as string) || "").trim() || null,
    requiredTools,
    steps,
    userId: user?.id,
  });
  revalidatePath("/work-instructions");
  revalidatePath("/purchasing");
  // Surface tool PR if one was auto-created
  const toolPr = (wi as { toolPr?: { prNumber: string } | null }).toolPr;
  if (toolPr?.prNumber) {
    redirect(
      `/work-instructions/${wi.id}?toolPr=${encodeURIComponent(toolPr.prNumber)}`
    );
  }
  redirect(`/work-instructions/${wi.id}`);
}

export async function actionAddWiStep(formData: FormData): Promise<void> {
  const wiId = formData.get("workInstructionId") as string;
  const user = await getCurrentUser("ENGINEERING");
  const { addWorkInstructionStep } = await import(
    "@/lib/services/work-instructions"
  );
  const photos: string[] = [];
  for (let i = 0; i < 8; i++) {
    const u = (formData.get(`photo_${i}`) as string) || "";
    if (u) photos.push(u);
  }
  const media: string[] = [];
  for (let i = 0; i < 8; i++) {
    const u = (formData.get(`media_${i}`) as string) || "";
    if (u) media.push(u);
  }
  const stepType =
    ((formData.get("stepType") as string) || "BUILD").trim().toUpperCase();
  await addWorkInstructionStep(
    wiId,
    {
      title: ((formData.get("title") as string) || "").trim(),
      instructions: ((formData.get("instructions") as string) || "").trim(),
      stepType,
      passFailRequired:
        formData.get("passFailRequired") === "on" ||
        formData.get("passFailRequired") === "true" ||
        stepType === "QA" ||
        stepType === "TEST",
      isTestStep:
        stepType === "TEST" ||
        formData.get("isTestStep") === "on" ||
        formData.get("isTestStep") === "true",
      measureUom:
        ((formData.get("measureUom") as string) || "").trim() || undefined,
      measureUomUnitId:
        ((formData.get("measureUomUnitId") as string) || "").trim() ||
        undefined,
      expectedValue:
        ((formData.get("expectedValue") as string) || "").trim() || undefined,
      cureTimeMinutes: (() => {
        const n = Number(formData.get("cureTimeMinutes") || 0);
        return n > 0 ? n : undefined;
      })(),
      requiredArea:
        ((formData.get("requiredArea") as string) || "").trim() || undefined,
      workCenter:
        ((formData.get("workCenter") as string) || "").trim() || undefined,
      routeLock:
        formData.get("routeLock") === "on" ||
        formData.get("routeLock") === "true",
      attachmentUrls: photos,
      mediaUrls: media,
    },
    user?.id
  );
  revalidatePath(`/work-instructions/${wiId}`);
  redirect(`/work-instructions/${wiId}`);
}

export async function actionLinkWiToBom(formData: FormData): Promise<void> {
  const wiId = formData.get("workInstructionId") as string;
  const bomHeaderId = formData.get("bomHeaderId") as string;
  const user = await getCurrentUser("CM");
  const { linkWiToBom } = await import("@/lib/services/work-instructions");
  await linkWiToBom({
    workInstructionId: wiId,
    bomHeaderId,
    userId: user?.id,
  });
  revalidatePath(`/work-instructions/${wiId}`);
  revalidatePath("/bom");
  redirect(`/work-instructions/${wiId}`);
}

function cmReturnTo(formData: FormData, fallback = "/cm?tab=submissions") {
  const raw = ((formData.get("returnTo") as string) || "").trim();
  // Only allow local CM paths
  if (raw.startsWith("/cm")) return raw;
  return fallback;
}

export async function actionVoteCm(formData: FormData) {
  const memberId = formData.get("memberId") as string;
  const vote = formData.get("vote") as string;
  const comments = (formData.get("comments") as string) || undefined;
  // Approvers may vote; CM can also vote if on board. Same controls for every seat.
  const user = await getCurrentUser();

  await prisma.cmBoardMember.update({
    where: { id: memberId },
    data: { vote, comments, votedAt: new Date() },
  });

  const member = await prisma.cmBoardMember.findUnique({
    where: { id: memberId },
    include: {
      changeRequest: {
        include: { boardMembers: true, workInstruction: true },
      },
    },
  });

  if (member) {
    const cr = member.changeRequest;
    // Document ECRs: only APPROVER seats count (need both)
    // Non-doc boards: all members vote except pure CHAIR (optional facilitator)
    const isDocEcr = Boolean(cr.documentNumber);
    const voters = isDocEcr
      ? cr.boardMembers.filter((v) =>
          ["APPROVER", "ENGINEERING", "QUALITY"].includes(v.role)
        )
      : cr.boardMembers.filter((v) => v.role !== "CHAIR");
    // If filtering left nobody (legacy CHAIR-only), fall back to everyone
    const effectiveVoters = voters.length > 0 ? voters : cr.boardMembers;
    const allVoted =
      effectiveVoters.length > 0 && effectiveVoters.every((v) => v.vote);
    if (allVoted) {
      const approved = effectiveVoters.filter(
        (v) => v.vote === "APPROVE"
      ).length;
      const rejected = effectiveVoters.filter(
        (v) => v.vote === "REJECT"
      ).length;
      // Document ECRs require both approvers to APPROVE
      const status = isDocEcr
        ? approved === effectiveVoters.length && rejected === 0
          ? "APPROVED"
          : "REJECTED"
        : approved > rejected
          ? "APPROVED"
          : "REJECTED";
      await prisma.changeRequest.update({
        where: { id: member.changeRequestId },
        data: {
          status,
          decidedAt: new Date(),
          decisionNotes: `Board vote: ${approved} approve, ${rejected} reject`,
        },
      });

      // Auto-release WI when CM approves WORK_INSTRUCTION CR (not document ECR)
      if (
        status === "APPROVED" &&
        !isDocEcr &&
        member.changeRequest.workInstructionId &&
        member.changeRequest.type === "WORK_INSTRUCTION"
      ) {
        const { releaseWorkInstructionFromCm } = await import(
          "@/lib/services/work-instructions"
        );
        await releaseWorkInstructionFromCm({
          workInstructionId: member.changeRequest.workInstructionId,
          bomHeaderId: member.changeRequest.bomHeaderId,
          userId: user?.id,
          decisionNotes: `Released by CM board (${approved}/${effectiveVoters.length})`,
        });
        revalidatePath(
          `/work-instructions/${member.changeRequest.workInstructionId}`
        );
        revalidatePath("/work-instructions");
      }
    }
  }

  revalidatePath("/cm");
  if (member?.changeRequestId) {
    revalidatePath(`/cm/ecr/${member.changeRequestId}`);
  }
  redirect(cmReturnTo(formData, member?.changeRequestId ? `/cm/ecr/${member.changeRequestId}` : "/cm?tab=submissions"));
}

export async function actionCreateDocumentEcr(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { createDocumentEcr } = await import("@/lib/services/cm-library");
  const isCompanyInternal =
    formData.get("isCompanyInternal") === "on" ||
    formData.get("isCompanyInternal") === "true";

  // File uploads from client (data URLs) — att_0, att_name_0, att_caption_0 …
  const attachments: {
    url: string;
    fileName: string;
    caption?: string | null;
    isPrimary?: boolean;
  }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = ((formData.get(`att_${i}`) as string) || "").trim();
    if (!url) break;
    const fileName =
      ((formData.get(`att_name_${i}`) as string) || "").trim() || `file-${i + 1}`;
    const caption =
      ((formData.get(`att_caption_${i}`) as string) || "").trim() || null;
    attachments.push({
      url,
      fileName,
      caption,
      isPrimary: i === 0,
    });
  }

  const documentFileUrl =
    ((formData.get("documentFileUrl") as string) || "").trim() ||
    attachments[0]?.url ||
    null;
  const documentFileName =
    ((formData.get("documentFileName") as string) || "").trim() ||
    attachments[0]?.fileName ||
    null;

  await createDocumentEcr({
    title: ((formData.get("title") as string) || "").trim() || undefined,
    description:
      ((formData.get("description") as string) || "").trim() || undefined,
    productFolderId:
      ((formData.get("productFolderId") as string) || "").trim() || null,
    productName: ((formData.get("productName") as string) || "").trim() || null,
    isCompanyInternal,
    sourceDocumentId:
      ((formData.get("sourceDocumentId") as string) || "").trim() || null,
    documentNumber:
      ((formData.get("documentNumber") as string) || "").trim() || null,
    documentTitle:
      ((formData.get("documentTitle") as string) || "").trim() || null,
    documentRevision:
      ((formData.get("documentRevision") as string) || "").trim() || null,
    documentDocType:
      ((formData.get("documentDocType") as string) || "").trim() || null,
    documentFileUrl,
    documentFileName,
    documentDescription:
      ((formData.get("documentDescription") as string) || "").trim() || null,
    attachments,
    includesBom:
      formData.get("includesBom") === "on" ||
      formData.get("includesBom") === "true",
    bomPartId: ((formData.get("bomPartId") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    userId: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=submissions");
}

export async function actionAddEcrAttachments(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { addEcrAttachments } = await import("@/lib/services/cm-library");
  const changeRequestId = formData.get("changeRequestId") as string;
  const setAsPrimary =
    formData.get("setAsPrimary") === "on" ||
    formData.get("setAsPrimary") === "true";
  const files: { url: string; fileName: string; caption?: string | null }[] =
    [];
  for (let i = 0; i < 12; i++) {
    const url = ((formData.get(`att_${i}`) as string) || "").trim();
    if (!url) break;
    files.push({
      url,
      fileName:
        ((formData.get(`att_name_${i}`) as string) || "").trim() ||
        `file-${i + 1}`,
      caption:
        ((formData.get(`att_caption_${i}`) as string) || "").trim() || null,
    });
  }
  await addEcrAttachments({
    changeRequestId,
    files,
    setAsPrimary,
    userId: user?.id,
  });
  revalidatePath("/cm");
  revalidatePath(`/cm/ecr/${changeRequestId}`);
  redirect(cmReturnTo(formData, `/cm/ecr/${changeRequestId}`));
}

export async function actionSetEcrPrimaryAttachment(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { setEcrPrimaryAttachment } = await import("@/lib/services/cm-library");
  const changeRequestId = formData.get("changeRequestId") as string;
  await setEcrPrimaryAttachment({
    changeRequestId,
    attachmentId: formData.get("attachmentId") as string,
    userId: user?.id,
  });
  revalidatePath("/cm");
  revalidatePath(`/cm/ecr/${changeRequestId}`);
  redirect(cmReturnTo(formData, `/cm/ecr/${changeRequestId}`));
}

export async function actionAddEcrComment(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { addChangeRequestComment } = await import("@/lib/services/cm-library");
  const changeRequestId = formData.get("changeRequestId") as string;
  await addChangeRequestComment({
    changeRequestId,
    body: ((formData.get("body") as string) || "").trim(),
    userId: user?.id,
    authorName: user?.name || null,
  });
  revalidatePath("/cm");
  revalidatePath(`/cm/ecr/${changeRequestId}`);
  redirect(cmReturnTo(formData, `/cm/ecr/${changeRequestId}`));
}

export async function actionAssignEcrApprovers(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("CM");
  const { assignEcrApprovers } = await import("@/lib/services/cm-library");
  const changeRequestId = formData.get("changeRequestId") as string;
  await assignEcrApprovers({
    changeRequestId,
    approverUserId1: formData.get("approverUserId1") as string,
    approverUserId2: formData.get("approverUserId2") as string,
    userId: user?.id,
  });
  revalidatePath("/cm");
  revalidatePath(`/cm/ecr/${changeRequestId}`);
  redirect(cmReturnTo(formData, `/cm/ecr/${changeRequestId}`));
}

export async function actionReleaseDocumentEcr(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("CM");
  const { releaseDocumentEcr } = await import("@/lib/services/cm-library");
  const result = await releaseDocumentEcr({
    changeRequestId: formData.get("changeRequestId") as string,
    releaseFolderId: formData.get("releaseFolderId") as string,
    userId: user?.id,
  });
  revalidatePath("/cm");
  revalidatePath(
    `/cm?tab=library&folder=${result.document.folderId || result.changeRequest.releaseFolderId}`
  );
  redirect(
    `/cm?tab=library&folder=${result.document.folderId || ""}`
  );
}

export async function actionMoveCmSubmission(formData: FormData): Promise<void> {
  const changeRequestId = formData.get("changeRequestId") as string;
  let column = ((formData.get("column") as string) || "SUBMITTED").toUpperCase();
  const user = await getCurrentUser("CM");
  const cr = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    select: { documentNumber: true },
  });
  // Document ECRs never sit in In work
  if (cr?.documentNumber && column === "IN_WORK") {
    column = "SUBMITTED";
  }
  const { moveChangeRequestColumn } = await import("@/lib/services/cm-library");
  await moveChangeRequestColumn({
    changeRequestId,
    column: column as
      | "IN_WORK"
      | "SUBMITTED"
      | "IN_REVIEW"
      | "APPROVED"
      | "RELEASED",
    userId: user?.id,
  });
  revalidatePath("/cm");
  revalidatePath(`/cm/ecr/${changeRequestId}`);
  redirect(cmReturnTo(formData, `/cm/ecr/${changeRequestId}`));
}

/** Drag-and-drop board move — no redirect; client refreshes. */
export async function actionMoveCmBoardCard(params: {
  changeRequestId: string;
  column: string;
  isDocumentEcr?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await getCurrentUser("CM");
    const column = params.column.toUpperCase() as
      | "IN_WORK"
      | "SUBMITTED"
      | "IN_REVIEW"
      | "APPROVED"
      | "RELEASED";
    const allowed = [
      "IN_WORK",
      "SUBMITTED",
      "IN_REVIEW",
      "APPROVED",
      "RELEASED",
    ] as const;
    if (!allowed.includes(column)) {
      return { ok: false, error: "Invalid column" };
    }
    // Document ECRs must use formal release (folder pick) — not drag into Released
    if (params.isDocumentEcr && column === "RELEASED") {
      return {
        ok: false,
        error:
          "Document ECRs must use CM release (pick library folder) from Approved — cannot drop into Released",
      };
    }
    if (params.isDocumentEcr && column === "IN_WORK") {
      return {
        ok: false,
        error:
          "Document ECRs land in Submitted when filed — not In work",
      };
    }
    const { moveChangeRequestColumn } = await import("@/lib/services/cm-library");
    await moveChangeRequestColumn({
      changeRequestId: params.changeRequestId,
      column,
      userId: user?.id,
    });
    revalidatePath("/cm");
    revalidatePath(`/cm/ecr/${params.changeRequestId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Move failed",
    };
  }
}

export async function actionCreateCmFolder(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const { createCmFolder } = await import("@/lib/services/cm-library");
  const parentId =
    ((formData.get("parentId") as string) || "").trim() || null;
  const kindRaw = ((formData.get("kind") as string) || "PRODUCT").toUpperCase();
  const folder = await createCmFolder({
    name: ((formData.get("name") as string) || "").trim(),
    parentId,
    kind: kindRaw === "ADMIN" ? "ADMIN" : "PRODUCT",
    productTag: ((formData.get("productTag") as string) || "").trim() || null,
    description: ((formData.get("description") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/cm");
  redirect(`/cm?tab=library&folder=${folder.id}`);
}

export async function actionDeleteCmFolder(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const id = formData.get("id") as string;
  const { deleteCmFolder } = await import("@/lib/services/cm-library");
  const folder = await prisma.cmFolder.findUnique({ where: { id } });
  await deleteCmFolder({ id, userId: user?.id });
  revalidatePath("/cm");
  redirect(
    folder?.parentId
      ? `/cm?tab=library&folder=${folder.parentId}`
      : "/cm?tab=library"
  );
}

// Documents (drawings, company policies, etc.) enter the CM library only via
// actionReleaseDocumentEcr after a document ECR is approved on CM submissions.
// There is no manual "add document" action for library folders.

export async function actionMoveCmDocument(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const { moveCmDocument } = await import("@/lib/services/cm-library");
  const id = formData.get("id") as string;
  const folderId =
    ((formData.get("folderId") as string) || "").trim() || null;
  await moveCmDocument({ id, folderId, userId: user?.id });
  revalidatePath("/cm");
  redirect(
    folderId ? `/cm?tab=library&folder=${folderId}` : "/cm?tab=library"
  );
}

export async function actionDeleteCmDocument(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const id = formData.get("id") as string;
  const folderId =
    ((formData.get("folderId") as string) || "").trim() || null;
  const { deleteCmDocument } = await import("@/lib/services/cm-library");
  await deleteCmDocument({ id, userId: user?.id });
  revalidatePath("/cm");
  redirect(
    folderId ? `/cm?tab=library&folder=${folderId}` : "/cm?tab=library"
  );
}

// ─── Order fulfillment flow ─────────────────────────────────────

function parseSalesDocumentForm(formData: FormData) {
  const customerId = formData.get("customerId") as string;
  const requiredDateStr = formData.get("requiredDate") as string;
  const shipDateStr = (formData.get("shipDate") as string) || "";
  const allowEarlyShip =
    formData.get("allowEarlyShip") === "true" || formData.get("allowEarlyShip") === "on";
  const customerPo = (formData.get("customerPo") as string) || undefined;
  const paymentTerms = (formData.get("paymentTerms") as string) || "NET30";
  const isFob = formData.get("isFob") === "true" || formData.get("isFob") === "on";
  const fobPoint = (formData.get("fobPoint") as string) || undefined;
  const billToName = (formData.get("billToName") as string) || undefined;
  const billToAddress = (formData.get("billToAddress") as string) || undefined;
  const shipToName = (formData.get("shipToName") as string) || undefined;
  const shipToAddress = (formData.get("shipToAddress") as string) || undefined;
  const contactName = (formData.get("contactName") as string) || undefined;
  const contactEmail = (formData.get("contactEmail") as string) || undefined;
  const notes = (formData.get("notes") as string) || undefined;
  const validUntilStr = (formData.get("validUntil") as string) || "";

  // Multi-line: parallel partId[], quantity[], unitPrice[] fields
  const partIds = formData.getAll("partId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const unitPrices = formData.getAll("unitPrice").map(String);

  const lines = partIds
    .map((partId, i) => {
      const qty = Number(quantities[i] || 0);
      const priceRaw = unitPrices[i];
      const unitPrice =
        priceRaw !== undefined && priceRaw !== "" ? Number(priceRaw) : undefined;
      return {
        partId: partId.trim(),
        quantity: qty,
        unitPrice: Number.isFinite(unitPrice as number) ? unitPrice : undefined,
      };
    })
    .filter((l) => l.partId && l.quantity > 0);

  if (!customerId || !requiredDateStr) {
    throw new Error("Customer and due date are required");
  }
  if (lines.length === 0) {
    throw new Error("Add at least one line with a part and quantity");
  }

  return {
    customerId,
    requiredDate: new Date(requiredDateStr),
    shipDate: shipDateStr ? new Date(shipDateStr) : undefined,
    allowEarlyShip,
    shipNotBefore: shipDateStr && !allowEarlyShip ? new Date(shipDateStr) : undefined,
    customerPo,
    paymentTerms,
    isFob,
    fobPoint,
    billToName,
    billToAddress,
    shipToName,
    shipToAddress,
    contactName,
    contactEmail,
    notes,
    validUntil: validUntilStr ? new Date(validUntilStr) : undefined,
    lines,
  };
}

export async function actionCreateSalesOrder(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const parsed = parseSalesDocumentForm(formData);
  const autoPlan =
    formData.get("autoPlan") === "true" || formData.get("autoPlan") === "on";

  const so = await createSalesOrder({
    ...parsed,
    department:
      ((formData.get("department") as string) || "").trim() || undefined,
    createdById: user?.id,
  });

  const bypassStockCheck =
    formData.get("bypassStockCheck") === "true" ||
    formData.get("bypassStockCheck") === "on";

  // Never fail the whole create if planning hits a soft block (no BOM, etc.)
  if (autoPlan) {
    try {
      await planSalesOrderFulfillment({
        salesOrderId: so.id,
        userId: user?.id,
        bypassStockCheck,
        bypassMaterialStockCheck: bypassStockCheck,
      });
    } catch (err) {
      console.error("Plan fulfillment after SO create:", err);
      await prisma.salesOrder
        .update({
          where: { id: so.id },
          data: {
            notes: [
              so.notes || "",
              `Planning note: ${err instanceof Error ? err.message : "plan failed"}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        })
        .catch(() => null);
    }
  }

  revalidateFulfillmentPaths([`/sales/${so.id}`]);
  redirect(`/sales/${so.id}`);
}

export async function actionCreateQuote(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const parsed = parseSalesDocumentForm(formData);
  const sendNow =
    formData.get("sendNow") === "true" || formData.get("sendNow") === "on";

  const quote = await createQuote({
    ...parsed,
    createdById: user?.id,
  });

  if (sendNow) {
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: "SENT" },
    });
  }

  revalidatePath("/sales");
  revalidatePath("/sales/quotes");
  redirect(`/sales/quotes/${quote.id}`);
}

export async function actionAcceptQuote(formData: FormData): Promise<void> {
  const quoteId = formData.get("quoteId") as string;
  const user = await getCurrentUser();
  const autoPlan =
    formData.get("autoPlan") === "true" || formData.get("autoPlan") === "on";
  const bypassStockCheck =
    formData.get("bypassStockCheck") === "true" ||
    formData.get("bypassStockCheck") === "on";

  // Mark accepted then convert
  await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "ACCEPTED" },
  });

  const so = await convertQuoteToSalesOrder({
    quoteId,
    userId: user?.id,
    autoPlan: false, // plan below with bypass flag
  });

  if (autoPlan) {
    try {
      await planSalesOrderFulfillment({
        salesOrderId: so.id,
        userId: user?.id,
        bypassStockCheck,
        bypassMaterialStockCheck: bypassStockCheck,
      });
    } catch (err) {
      console.error("Plan after quote accept:", err);
    }
  }

  revalidateFulfillmentPaths([`/sales/${so.id}`, `/sales/quotes/${quoteId}`]);
  redirect(`/sales/${so.id}`);
}

export async function actionSendQuote(formData: FormData): Promise<void> {
  const quoteId = formData.get("quoteId") as string;
  await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "SENT" },
  });
  revalidatePath(`/sales/quotes/${quoteId}`);
  revalidatePath("/sales/quotes");
}

export async function actionPlanSalesOrder(formData: FormData): Promise<void> {
  const salesOrderId = formData.get("salesOrderId") as string;
  const bypassStockCheck =
    formData.get("bypassStockCheck") === "true" ||
    formData.get("bypassStockCheck") === "on";
  const user = await getCurrentUser();
  await planSalesOrderFulfillment({
    salesOrderId,
    userId: user?.id,
    bypassStockCheck,
    bypassMaterialStockCheck: bypassStockCheck,
  });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`]);
}

// ─── Customers ──────────────────────────────────────────────────

function parseCustomerForm(formData: FormData) {
  const name = (formData.get("name") as string) || "";
  if (!name.trim()) throw new Error("Customer name is required");
  return {
    code: ((formData.get("code") as string) || "").trim() || undefined,
    name: name.trim(),
    contactName: ((formData.get("contactName") as string) || "").trim() || undefined,
    contactEmail: ((formData.get("contactEmail") as string) || "").trim() || undefined,
    contactPhone: ((formData.get("contactPhone") as string) || "").trim() || undefined,
    billToAddress: ((formData.get("billToAddress") as string) || "").trim() || undefined,
    shipToAddress: ((formData.get("shipToAddress") as string) || "").trim() || undefined,
    paymentTerms: ((formData.get("paymentTerms") as string) || "NET30").trim(),
    creditLimit: formData.get("creditLimit")
      ? Number(formData.get("creditLimit"))
      : 0,
    // Checkbox: present = active; hidden "true" on create also counts
    isActive:
      formData.get("isActive") === "true" || formData.get("isActive") === "on",
  };
}

function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  // Only allow internal relative paths
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function actionCreateCustomer(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const data = parseCustomerForm(formData);
  const returnTo = safeReturnTo(formData.get("returnTo") as string | null);

  const customer = await createCustomer({
    ...data,
    userId: user?.id,
  });

  revalidatePath("/customers");
  revalidatePath("/sales");
  revalidatePath("/sales/new");
  revalidatePath("/sales/quotes/new");

  if (returnTo) {
    const sep = returnTo.includes("?") ? "&" : "?";
    redirect(`${returnTo}${sep}customerId=${customer.id}`);
  }
  redirect(`/customers/${customer.id}`);
}

export async function actionUpdateCustomer(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = formData.get("id") as string;
  if (!id) throw new Error("Customer id required");
  const data = parseCustomerForm(formData);

  await updateCustomer(id, {
    ...data,
    userId: user?.id,
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/sales");
  redirect(`/customers/${id}`);
}

export async function actionPlanWoMaterials(formData: FormData): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const bypassStockCheck =
    formData.get("bypassStockCheck") === "true" ||
    formData.get("bypassStockCheck") === "on";
  const user = await getCurrentUser();
  await planWorkOrderMaterials({
    workOrderId,
    userId: user?.id,
    bypassStockCheck,
  });
  revalidateFulfillmentPaths([`/work-orders/${workOrderId}`]);
}

export async function actionPutAwayItemWithLocation(
  formData: FormData
): Promise<void> {
  const inventoryItemId = formData.get("inventoryItemId") as string;
  const targetLocationCode =
    ((formData.get("targetLocationCode") as string) || "").trim() || undefined;
  const user = await getCurrentUser();
  await putAwayInventory({
    inventoryItemId,
    userId: user?.id,
    targetLocationCode,
  });
  revalidateFulfillmentPaths(["/inventory", "/purchasing", "/quality", "/receiving"]);
}

export async function actionUpdatePartInspectionFlags(
  formData: FormData
): Promise<void> {
  const { updatePartInspectionFlags } = await import(
    "@/lib/services/receiving-inspection"
  );
  const partId = formData.get("partId") as string;
  const user = await getCurrentUser();
  await updatePartInspectionFlags({
    partId,
    requiresGdtInspection:
      formData.get("requiresGdtInspection") === "true" ||
      formData.get("requiresGdtInspection") === "on",
    requiresFunctionalTest:
      formData.get("requiresFunctionalTest") === "true" ||
      formData.get("requiresFunctionalTest") === "on",
    userId: user?.id,
  });
  revalidatePath("/bom");
  revalidatePath("/items");
  revalidatePath(`/items/${partId}`);
  revalidatePath(`/parts/${partId}`);
  revalidatePath("/receiving");
  revalidatePath("/quality");
}

function formStr(formData: FormData, key: string) {
  return ((formData.get(key) as string) || "").trim();
}
function formNum(formData: FormData, key: string, fallback = 0) {
  const n = parseFloat(formStr(formData, key));
  return Number.isFinite(n) ? n : fallback;
}
function formOptId(formData: FormData, key: string) {
  const v = formStr(formData, key);
  return v || null;
}
function formBool(formData: FormData, key: string) {
  const v = formData.get(key);
  return v === "true" || v === "on";
}

export async function actionCreateItem(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const part = await createPart({
    partNumber: formStr(formData, "partNumber"),
    description: formStr(formData, "description"),
    revision: formStr(formData, "revision") || "A",
    uomUnitId: formOptId(formData, "uomUnitId"),
    sourcingMethod:
      formStr(formData, "sourcingMethod") === "PURCHASE" ? "PURCHASE" : "BUILD",
    itemStructure: formStr(formData, "itemStructure") || "N_A",
    standardCost: formNum(formData, "standardCost"),
    lastBuyCost: formNum(formData, "lastBuyCost"),
    averageCost: formNum(formData, "averageCost"),
    leadTimeDays: Math.round(formNum(formData, "leadTimeDays")),
    isSerialized: formBool(formData, "isSerialized"),
    isLotControlled: formBool(formData, "isLotControlled"),
    isActive: formData.has("isActive") ? formBool(formData, "isActive") : true,
    drawingNumber: formOptId(formData, "drawingNumber"),
    inventoryAccountId: formOptId(formData, "inventoryAccountId"),
    expenseAccountId: formOptId(formData, "expenseAccountId"),
    cogsAccountId: formOptId(formData, "cogsAccountId"),
    requiresGdtInspection: formBool(formData, "requiresGdtInspection"),
    requiresFunctionalTest: formBool(formData, "requiresFunctionalTest"),
    notes: formOptId(formData, "notes"),
    userId: user?.id,
  });
  revalidatePath("/items");
  revalidatePath("/bom");
  redirect(`/items/${part.id}`);
}

export async function actionUpdateItem(formData: FormData): Promise<void> {
  const id = formStr(formData, "id");
  const returnTab = formStr(formData, "returnTab") || "general";
  const user = await getCurrentUser();

  const data: Parameters<typeof updatePart>[1] = { userId: user?.id };

  if (formData.has("partNumber"))
    data.partNumber = formStr(formData, "partNumber");
  if (formData.has("description"))
    data.description = formStr(formData, "description");
  if (formData.has("revision")) data.revision = formStr(formData, "revision");
  if (formData.has("uomUnitId"))
    data.uomUnitId = formOptId(formData, "uomUnitId");
  if (formData.has("sourcingMethod")) {
    data.sourcingMethod =
      formStr(formData, "sourcingMethod") === "PURCHASE" ? "PURCHASE" : "BUILD";
  }
  if (formData.has("itemStructure"))
    data.itemStructure = formStr(formData, "itemStructure") || "N_A";
  if (formData.has("standardCost"))
    data.standardCost = formNum(formData, "standardCost");
  if (formData.has("lastBuyCost"))
    data.lastBuyCost = formNum(formData, "lastBuyCost");
  if (formData.has("averageCost"))
    data.averageCost = formNum(formData, "averageCost");
  if (formData.has("leadTimeDays"))
    data.leadTimeDays = Math.round(formNum(formData, "leadTimeDays"));
  if (formData.has("drawingNumber"))
    data.drawingNumber = formOptId(formData, "drawingNumber");
  if (formData.has("notes")) data.notes = formOptId(formData, "notes");
  if (formData.has("inventoryAccountId"))
    data.inventoryAccountId = formOptId(formData, "inventoryAccountId");
  if (formData.has("expenseAccountId"))
    data.expenseAccountId = formOptId(formData, "expenseAccountId");
  if (formData.has("cogsAccountId"))
    data.cogsAccountId = formOptId(formData, "cogsAccountId");

  // Checkboxes only present when checked — use presence of sibling fields on tab
  if (returnTab === "general") {
    data.isSerialized = formBool(formData, "isSerialized");
    data.isLotControlled = formBool(formData, "isLotControlled");
    data.isActive = formBool(formData, "isActive");
  }

  if (returnTab === "inventory") {
    data.isKanban = formBool(formData, "isKanban");
    data.isCritical = formBool(formData, "isCritical");
    data.minStock = formNum(formData, "minStock");
    data.maxStock = formNum(formData, "maxStock");
    data.reorderPoint = formNum(formData, "reorderPoint");
    data.safetyStock = formNum(formData, "safetyStock");
    data.abcClass = formOptId(formData, "abcClass");
    const shelf = formStr(formData, "shelfLifeDays");
    data.shelfLifeDays = shelf ? Math.round(formNum(formData, "shelfLifeDays")) : null;
  }

  await updatePart(id, data);
  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  revalidatePath("/bom");
  redirect(`/items/${id}?tab=${returnTab}`);
}

export async function actionUpsertPartVendor(formData: FormData): Promise<void> {
  const partId = formStr(formData, "partId");
  const supplierId = formStr(formData, "supplierId");
  const user = await getCurrentUser();

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new Error("Supplier not found");
  if (!isSupplierApprovedForPo(supplier)) {
    throw new Error(
      "Only Approved Supplier List (ASL) vendors can be assigned on item cards"
    );
  }

  await upsertPartVendor({
    id: formOptId(formData, "id") || undefined,
    partId,
    supplierId,
    vendorPartNumber: formStr(formData, "vendorPartNumber") || undefined,
    vendorDescription: formStr(formData, "vendorDescription") || undefined,
    vendorSku: formStr(formData, "vendorSku") || undefined,
    manufacturer: formStr(formData, "manufacturer") || undefined,
    manufacturerPn: formStr(formData, "manufacturerPn") || undefined,
    unitCost: formNum(formData, "unitCost"),
    minOrderQty: formNum(formData, "minOrderQty", 1),
    leadTimeDays: Math.round(formNum(formData, "leadTimeDays")),
    isPreferred: formBool(formData, "isPreferred"),
    notes: formStr(formData, "notes") || undefined,
    userId: user?.id,
  });

  revalidatePath(`/items/${partId}`);
  revalidatePath("/items");
  redirect(`/items/${partId}?tab=vendors`);
}

export async function actionSaveUomUnit(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  await saveUomUnit({
    id: formOptId(formData, "id") || undefined,
    code: formStr(formData, "code"),
    name: formStr(formData, "name"),
    category: formStr(formData, "category") || "COUNT",
    isActive: formData.has("isActive")
      ? formBool(formData, "isActive")
      : true,
    sortOrder: Math.round(formNum(formData, "sortOrder")),
    userId: user?.id,
  });
  revalidatePath("/uom");
  revalidatePath("/items");
  revalidatePath("/work-instructions");
  const returnPath = formStr(formData, "returnPath");
  redirect(returnPath || "/uom");
}

export async function actionSaveUomConversion(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  await saveUomConversion({
    fromUomId: formStr(formData, "fromUomId"),
    toUomId: formStr(formData, "toUomId"),
    factor: formNum(formData, "factor"),
    notes: formStr(formData, "notes") || undefined,
    userId: user?.id,
  });
  revalidatePath("/uom");
  redirect("/uom");
}

export async function actionToggleSupplierAsl(formData: FormData): Promise<void> {
  const supplierId = formStr(formData, "supplierId");
  const approve = formBool(formData, "approve");
  const forceTrial = formBool(formData, "forceTrial");
  const user = await getCurrentUser("PURCHASING");

  const { setSupplierAsl } = await import("@/lib/services/asl");
  await setSupplierAsl({
    supplierId,
    approve,
    forceTrial,
    userId: user?.id,
  });

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath("/items");
  revalidatePath("/purchasing");
}

export async function actionUpdateAslPolicy(formData: FormData): Promise<void> {
  const user = await getCurrentUser("PURCHASING");
  const { updateAslPolicy } = await import("@/lib/services/asl");
  await updateAslPolicy({
    requireIso9001: formBool(formData, "requireIso9001"),
    requireAs9100d: formBool(formData, "requireAs9100d"),
    allowTrialOrders: formBool(formData, "allowTrialOrders"),
    defaultTrialLimit: Math.max(1, Math.round(formNum(formData, "defaultTrialLimit", 1))),
    notes: formStr(formData, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/suppliers");
  redirect("/suppliers");
}

export async function actionUpsertSupplierCert(formData: FormData): Promise<void> {
  const user = await getCurrentUser("PURCHASING");
  const supplierId = formStr(formData, "supplierId");
  const { upsertSupplierCertification } = await import("@/lib/services/asl");

  const issuedAtRaw = formStr(formData, "issuedAt");
  const expiresAtRaw = formStr(formData, "expiresAt");

  await upsertSupplierCertification({
    id: formOptId(formData, "id") || undefined,
    supplierId,
    certType: formStr(formData, "certType") || "OTHER",
    certNumber: formStr(formData, "certNumber") || null,
    issuedBy: formStr(formData, "issuedBy") || null,
    issuedAt: issuedAtRaw ? new Date(issuedAtRaw) : null,
    expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
    documentUrl: formStr(formData, "documentUrl") || null,
    documentName: formStr(formData, "documentName") || null,
    notes: formStr(formData, "notes") || null,
    userId: user?.id,
  });

  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath("/suppliers");
  redirect(`/suppliers/${supplierId}?tab=certs`);
}

export async function actionDeleteSupplierCert(formData: FormData): Promise<void> {
  const user = await getCurrentUser("PURCHASING");
  const id = formStr(formData, "id");
  const supplierId = formStr(formData, "supplierId");
  const { deleteSupplierCertification } = await import("@/lib/services/asl");
  await deleteSupplierCertification({ id, userId: user?.id });
  revalidatePath(`/suppliers/${supplierId}`);
  redirect(`/suppliers/${supplierId}?tab=certs`);
}

export async function actionUpdateDepositStatus(formData: FormData): Promise<void> {
  const salesOrderId = formStr(formData, "salesOrderId");
  const depositStatus = formStr(formData, "depositStatus") || "PENDING";
  const user = await getCurrentUser();

  const so = await prisma.salesOrder.update({
    where: { id: salesOrderId },
    data: {
      depositStatus,
      creditHold: depositStatus === "RECEIVED" || depositStatus === "WAIVED" ? false : true,
    },
  });

  await logAudit({
    entityType: "SalesOrder",
    entityId: so.id,
    action: "DEPOSIT_STATUS",
    userId: user?.id,
    metadata: { depositStatus },
  });

  revalidatePath(`/sales/${salesOrderId}`);
  revalidatePath("/sales");
  revalidatePath("/shipping");
  revalidatePath(`/customers/${so.customerId}`);
}

export async function actionCompleteReceivingInspection(
  formData: FormData
): Promise<void> {
  const { completeReceivingInspection } = await import(
    "@/lib/services/receiving-inspection"
  );
  const inspectionId = formData.get("inspectionId") as string;
  const result =
    ((formData.get("result") as string) || "").toUpperCase() === "FAIL"
      ? "FAIL"
      : "PASS";
  const notes = ((formData.get("notes") as string) || "").trim() || undefined;
  const measuredValue =
    ((formData.get("measuredValue") as string) || "").trim() || undefined;
  const user = await getCurrentUser("QUALITY");

  const documents: { url: string; fileName?: string; caption?: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = (formData.get(`doc_${i}`) as string) || "";
    if (!url) continue;
    documents.push({
      url,
      fileName: ((formData.get(`doc_name_${i}`) as string) || "").trim() || undefined,
      caption:
        ((formData.get(`doc_caption_${i}`) as string) || "").trim() || undefined,
    });
  }

  await completeReceivingInspection({
    inspectionId,
    result,
    notes,
    measuredValue,
    documents: documents.length ? documents : undefined,
    userId: user?.id,
  });

  revalidateFulfillmentPaths([
    "/quality",
    "/floor",
    "/work-orders",
    "/inventory",
    "/receiving",
    "/mrb",
    "/test-center",
  ]);
}

export async function actionCreateKit(formData: FormData): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const user = await getCurrentUser("PRODUCTION");
  const kit = await createKitOrder({ workOrderId, userId: user?.id });
  revalidateFulfillmentPaths([
    `/work-orders/${workOrderId}`,
    `/kitting/${kit.id}`,
  ]);
}

export async function actionCompleteKit(formData: FormData): Promise<void> {
  const kitOrderId = formData.get("kitOrderId") as string;
  const user = await getCurrentUser("PRODUCTION");
  const linePicks: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pick_")) continue;
    const lineId = key.replace("pick_", "");
    const invId = String(value || "").trim();
    if (lineId && invId) linePicks[lineId] = invId;
  }
  const kit = await completeKitOrder({
    kitOrderId,
    userId: user?.id,
    linePicks: Object.keys(linePicks).length ? linePicks : undefined,
  });
  revalidateFulfillmentPaths([
    `/work-orders/${kit?.workOrderId}`,
    `/kitting/${kitOrderId}`,
    "/kitting",
  ]);
}

export async function actionStartProduction(formData: FormData): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const user = await getCurrentUser("PRODUCTION");
  await startProductionFromKit({ workOrderId, userId: user?.id });
  revalidateFulfillmentPaths([`/work-orders/${workOrderId}`]);
}

export async function actionCompleteWoToStock(formData: FormData): Promise<void> {
  const workOrderId = formData.get("workOrderId") as string;
  const user = await getCurrentUser();
  const result = await completeWorkOrderToStock({
    workOrderId,
    userId: user?.id,
  });
  revalidateFulfillmentPaths([
    `/work-orders/${workOrderId}`,
    "/shipping",
    "/sales",
  ]);
  void result;
}

export async function actionPutAwayItem(formData: FormData): Promise<void> {
  const inventoryItemId = formData.get("inventoryItemId") as string;
  const user = await getCurrentUser();
  await putAwayInventory({ inventoryItemId, userId: user?.id });
  revalidateFulfillmentPaths(["/inventory", "/purchasing", "/quality"]);
}

export async function actionPutAwayAllReceiving(): Promise<void> {
  const user = await getCurrentUser();
  await putAwayAllReceiving(user?.id);
  revalidateFulfillmentPaths(["/inventory", "/purchasing", "/work-orders"]);
}

export async function actionShipSalesOrder(formData: FormData): Promise<void> {
  const salesOrderId = formData.get("salesOrderId") as string;
  const shipmentId = ((formData.get("shipmentId") as string) || "").trim() || undefined;
  const force = formData.get("force") === "true";
  const carrier = (formData.get("carrier") as string) || undefined;
  const trackingNumber = (formData.get("trackingNumber") as string) || undefined;
  const user = await getCurrentUser();
  await shipSalesOrder({
    salesOrderId,
    shipmentId,
    carrier,
    trackingNumber,
    userId: user?.id,
    force,
  });
  revalidateFulfillmentPaths([
    `/sales/${salesOrderId}`,
    "/shipping",
    "/purchasing",
    "/inventory",
  ]);
}

/** Manually scan kanban mins and open PRs for anything at/below min (not already on order). */
export async function actionRunKanbanReplenishment(): Promise<void> {
  const user = await getCurrentUser();
  const { ensureKanbanReplenishmentPrs } = await import(
    "@/lib/services/kanban-replenishment"
  );
  await ensureKanbanReplenishmentPrs({ userId: user?.id });
  revalidatePath("/purchasing");
  revalidatePath("/inventory");
  revalidatePath("/items");
  redirect("/purchasing");
}

export async function actionQueueShipment(formData: FormData): Promise<void> {
  const salesOrderId = formData.get("salesOrderId") as string;
  const user = await getCurrentUser();
  const result = await ensureShipmentForSalesOrder({
    salesOrderId,
    userId: user?.id,
  });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`, "/shipping"]);
  // Always land on the shipment detail so "Queue packing list" is not a no-op
  if (result.shipment?.id) {
    redirect(`/shipping/${result.shipment.id}`);
  }
  redirect(`/shipping?error=${encodeURIComponent(result.reason || "Could not queue shipment")}`);
}

export async function actionVerifyPackingList(formData: FormData): Promise<void> {
  const { verifyShipmentPackingList } = await import(
    "@/lib/services/order-fulfillment"
  );
  const shipmentId = formData.get("shipmentId") as string;
  const user = await getCurrentUser();
  await verifyShipmentPackingList({ shipmentId, userId: user?.id });
  revalidatePath("/shipping");
  revalidatePath("/sales");
}

export async function actionPackShipment(formData: FormData): Promise<void> {
  const { packShipment } = await import("@/lib/services/order-fulfillment");
  const shipmentId = formData.get("shipmentId") as string;
  const user = await getCurrentUser();
  const packPhotos: { url: string; fileName?: string; caption?: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const url = (formData.get(`pack_photo_${i}`) as string) || "";
    if (!url) continue;
    packPhotos.push({
      url,
      fileName:
        ((formData.get(`pack_photo_name_${i}`) as string) || "").trim() ||
        undefined,
      caption:
        ((formData.get(`pack_photo_caption_${i}`) as string) || "").trim() ||
        undefined,
    });
  }
  await packShipment({
    shipmentId,
    packPhotos,
    userId: user?.id,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
  });
  revalidatePath("/shipping");
  revalidatePath("/sales");
}

// ─── CM number control (request → assign → master list) ─────────

export async function actionRequestCmNumber(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createNumberRequest } = await import("@/lib/services/cm-numbers");
  await createNumberRequest({
    category: ((formData.get("category") as string) || "").trim(),
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    preferredNumber:
      ((formData.get("preferredNumber") as string) || "").trim() || null,
    productName: ((formData.get("productName") as string) || "").trim() || null,
    productFolderId:
      ((formData.get("productFolderId") as string) || "").trim() || null,
    schemeId: ((formData.get("schemeId") as string) || "").trim() || null,
    requestedById: user?.id,
    requestedByName: user?.name || null,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=requests");
}

export async function actionAssignCmNumber(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const { assignNumberToRequest } = await import("@/lib/services/cm-numbers");
  await assignNumberToRequest({
    requestId: formData.get("requestId") as string,
    overrideNumber:
      ((formData.get("overrideNumber") as string) || "").trim() || null,
    cmNotes: ((formData.get("cmNotes") as string) || "").trim() || null,
    assignedById: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=requests");
}

export async function actionRejectCmNumberRequest(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("CM");
  const { rejectNumberRequest } = await import("@/lib/services/cm-numbers");
  await rejectNumberRequest({
    requestId: formData.get("requestId") as string,
    reason: ((formData.get("reason") as string) || "").trim(),
    assignedById: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=requests");
}

export async function actionCancelCmNumberRequest(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { cancelNumberRequest } = await import("@/lib/services/cm-numbers");
  await cancelNumberRequest({
    requestId: formData.get("requestId") as string,
    userId: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=requests");
}

export async function actionRegisterCmNumber(formData: FormData): Promise<void> {
  const user = await getCurrentUser("CM");
  const { registerNumberManually } = await import("@/lib/services/cm-numbers");
  await registerNumberManually({
    number: ((formData.get("number") as string) || "").trim(),
    category: ((formData.get("category") as string) || "").trim(),
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    productName: ((formData.get("productName") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "ACTIVE").trim(),
    assignedById: user?.id,
    schemeId: ((formData.get("schemeId") as string) || "").trim() || null,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=master");
}

export async function actionUpdateCmNumberScheme(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("CM");
  const { updateNumberScheme } = await import("@/lib/services/cm-numbers");
  const padRaw = ((formData.get("padLength") as string) || "").trim();
  const nextRaw = ((formData.get("nextSequence") as string) || "").trim();
  await updateNumberScheme({
    id: formData.get("id") as string,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    description:
      ((formData.get("description") as string) || "").trim() || null,
    prefix: ((formData.get("prefix") as string) || "").trim() || undefined,
    separator:
      formData.get("separator") !== null
        ? String(formData.get("separator"))
        : undefined,
    padLength: padRaw ? Number(padRaw) : undefined,
    suffix: ((formData.get("suffix") as string) || "").trim() || null,
    nextSequence: nextRaw ? Number(nextRaw) : undefined,
    // Checkbox present → active; absent → inactive (form always includes the field intent)
    isActive:
      formData.get("isActiveOn") === "on" ||
      formData.get("isActiveOn") === "true",
    userId: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=schemes");
}

export async function actionUpdateRegistryStatus(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("CM");
  const { updateRegistryStatus } = await import("@/lib/services/cm-numbers");
  await updateRegistryStatus({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim(),
    notes: ((formData.get("notes") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/cm");
  redirect("/cm?tab=numbers&panel=master");
}

// ─── Products (PLM) ─────────────────────────────────────────────

export async function actionCreateProduct(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const {
    createProduct,
    productFieldsFromForm,
  } = await import("@/lib/services/products");
  const fields = productFieldsFromForm(formData);
  const product = await createProduct({
    ...fields,
    createCmFolder:
      formData.get("createCmFolder") === "on" ||
      formData.get("createCmFolder") === "true",
    userId: user?.id,
  });
  revalidatePath("/products");
  revalidatePath("/cm");
  redirect(`/products/${product.id}`);
}

export async function actionUpdateProduct(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const {
    updateProduct,
    productFieldsFromForm,
  } = await import("@/lib/services/products");
  const id = formData.get("id") as string;
  const fields = productFieldsFromForm(formData);
  await updateProduct({
    id,
    ...fields,
    userId: user?.id,
  });
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function actionAdvanceProductLifecycle(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { advanceProductLifecycle } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await advanceProductLifecycle({
    productId,
    toPhase: ((formData.get("toPhase") as string) || "").trim(),
    notes: ((formData.get("notes") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=lifecycle`);
}

export async function actionAddProductPart(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { addProductPart } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await addProductPart({
    productId,
    partId: formData.get("partId") as string,
    role: ((formData.get("role") as string) || "RELATED").trim(),
    notes: ((formData.get("notes") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=structure`);
}

export async function actionRemoveProductPart(
  formData: FormData
): Promise<void> {
  const { removeProductPart } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductPart({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=structure`);
}

export async function actionAddProductDocument(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { addProductDocument } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await addProductDocument({
    productId,
    title: ((formData.get("title") as string) || "").trim(),
    docType: ((formData.get("docType") as string) || "OTHER").trim(),
    number: ((formData.get("number") as string) || "").trim() || null,
    revision: ((formData.get("revision") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "").trim() || null,
    url: ((formData.get("url") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=documents`);
}

export async function actionRemoveProductDocument(
  formData: FormData
): Promise<void> {
  const { removeProductDocument } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductDocument({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=documents`);
}

export async function actionAddProductRequirement(
  formData: FormData
): Promise<void> {
  const { addProductRequirement } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await addProductRequirement({
    productId,
    number: ((formData.get("number") as string) || "").trim() || null,
    title: ((formData.get("title") as string) || "").trim(),
    description:
      ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "FUNCTIONAL").trim(),
    status: ((formData.get("status") as string) || "DRAFT").trim(),
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    source: ((formData.get("source") as string) || "").trim() || null,
    verificationMethod:
      ((formData.get("verificationMethod") as string) || "").trim() || null,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=requirements`);
}

export async function actionUpdateProductRequirement(
  formData: FormData
): Promise<void> {
  const { updateProductRequirement } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await updateProductRequirement({
    id: formData.get("id") as string,
    title: ((formData.get("title") as string) || "").trim() || undefined,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    priority: ((formData.get("priority") as string) || "").trim() || undefined,
    category: ((formData.get("category") as string) || "").trim() || undefined,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=requirements`);
}

export async function actionRemoveProductRequirement(
  formData: FormData
): Promise<void> {
  const { removeProductRequirement } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductRequirement({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=requirements`);
}

export async function actionAddProductVariant(
  formData: FormData
): Promise<void> {
  const { addProductVariant } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await addProductVariant({
    productId,
    code: ((formData.get("code") as string) || "").trim(),
    name: ((formData.get("name") as string) || "").trim(),
    description:
      ((formData.get("description") as string) || "").trim() || null,
    isDefault:
      formData.get("isDefault") === "on" ||
      formData.get("isDefault") === "true",
    topLevelPartId:
      ((formData.get("topLevelPartId") as string) || "").trim() || null,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=variants`);
}

export async function actionRemoveProductVariant(
  formData: FormData
): Promise<void> {
  const { removeProductVariant } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductVariant({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=variants`);
}

export async function actionAddProductMilestone(
  formData: FormData
): Promise<void> {
  const { addProductMilestone } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  const targetRaw = ((formData.get("targetDate") as string) || "").trim();
  await addProductMilestone({
    productId,
    name: ((formData.get("name") as string) || "").trim(),
    kind: ((formData.get("kind") as string) || "GATE").trim(),
    targetDate: targetRaw ? new Date(targetRaw) : null,
    status: ((formData.get("status") as string) || "PLANNED").trim(),
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=lifecycle`);
}

export async function actionUpdateProductMilestone(
  formData: FormData
): Promise<void> {
  const { updateProductMilestone } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  const targetRaw = ((formData.get("targetDate") as string) || "").trim();
  const actualRaw = ((formData.get("actualDate") as string) || "").trim();
  await updateProductMilestone({
    id: formData.get("id") as string,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    targetDate: targetRaw ? new Date(targetRaw) : undefined,
    actualDate: actualRaw ? new Date(actualRaw) : undefined,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=lifecycle`);
}

export async function actionRemoveProductMilestone(
  formData: FormData
): Promise<void> {
  const { removeProductMilestone } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductMilestone({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=lifecycle`);
}

export async function actionAddProductMember(formData: FormData): Promise<void> {
  const { addProductMember } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await addProductMember({
    productId,
    userId: formData.get("userId") as string,
    role: ((formData.get("role") as string) || "OTHER").trim(),
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=team`);
}

export async function actionRemoveProductMember(
  formData: FormData
): Promise<void> {
  const { removeProductMember } = await import("@/lib/services/products");
  const productId = formData.get("productId") as string;
  await removeProductMember({ id: formData.get("id") as string });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?tab=team`);
}

// ─── PMO (Program / Project Management) ─────────────────────────

function optDate(formData: FormData, key: string): Date | null {
  const raw = ((formData.get(key) as string) || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function optNum(formData: FormData, key: string): number | undefined {
  const raw = ((formData.get(key) as string) || "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function actionCreateProgram(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createProgram } = await import("@/lib/services/pmo");
  const program = await createProgram({
    code: ((formData.get("code") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    portfolio: ((formData.get("portfolio") as string) || "").trim() || null,
    ownerId: ((formData.get("ownerId") as string) || "").trim() || null,
    budgetCost: optNum(formData, "budgetCost"),
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    notes: ((formData.get("notes") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/pmo");
  redirect(`/pmo/programs/${program.id}`);
}

export async function actionCreatePmoProject(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createProject } = await import("@/lib/services/pmo");
  const project = await createProject({
    number: ((formData.get("number") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    programId: ((formData.get("programId") as string) || "").trim() || null,
    productId: ((formData.get("productId") as string) || "").trim() || null,
    methodology: ((formData.get("methodology") as string) || "HYBRID").trim(),
    phase: ((formData.get("phase") as string) || "INITIATION").trim(),
    status: ((formData.get("status") as string) || "PLANNING").trim(),
    customerName: ((formData.get("customerName") as string) || "").trim() || null,
    contractValue: optNum(formData, "contractValue"),
    budgetCost: optNum(formData, "budgetCost"),
    developmentBudget: optNum(formData, "developmentBudget"),
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    sponsorId: ((formData.get("sponsorId") as string) || "").trim() || null,
    projectManagerId:
      ((formData.get("projectManagerId") as string) || "").trim() || null,
    businessCase: ((formData.get("businessCase") as string) || "").trim() || null,
    objectives: ((formData.get("objectives") as string) || "").trim() || null,
    scopeIn: ((formData.get("scopeIn") as string) || "").trim() || null,
    scopeOut: ((formData.get("scopeOut") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/pmo");
  revalidatePath("/products");
  redirect(`/pmo/projects/${project.id}`);
}

export async function actionUpdateProjectCharter(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { updateProjectCharter } = await import("@/lib/services/pmo");
  const id = formData.get("id") as string;
  await updateProjectCharter({
    id,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    description: ((formData.get("description") as string) || "").trim() || null,
    businessCase: ((formData.get("businessCase") as string) || "").trim() || null,
    objectives: ((formData.get("objectives") as string) || "").trim() || null,
    scopeIn: ((formData.get("scopeIn") as string) || "").trim() || null,
    scopeOut: ((formData.get("scopeOut") as string) || "").trim() || null,
    successCriteria:
      ((formData.get("successCriteria") as string) || "").trim() || null,
    assumptions: ((formData.get("assumptions") as string) || "").trim() || null,
    constraints: ((formData.get("constraints") as string) || "").trim() || null,
    deliverables: ((formData.get("deliverables") as string) || "").trim() || null,
    stakeholdersSummary:
      ((formData.get("stakeholdersSummary") as string) || "").trim() || null,
    sponsorId: ((formData.get("sponsorId") as string) || "").trim() || null,
    projectManagerId:
      ((formData.get("projectManagerId") as string) || "").trim() || null,
    methodology: ((formData.get("methodology") as string) || "").trim() || undefined,
    phase: ((formData.get("phase") as string) || "").trim() || undefined,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    charterStatus:
      ((formData.get("charterStatus") as string) || "").trim() || undefined,
    contractValue: optNum(formData, "contractValue"),
    budgetCost: optNum(formData, "budgetCost"),
    developmentBudget: optNum(formData, "developmentBudget"),
    customerName:
      ((formData.get("customerName") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    productId: ((formData.get("productId") as string) || "").trim() || null,
    programId: ((formData.get("programId") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/pmo");
  revalidatePath(`/pmo/projects/${id}`);
  redirect(`/pmo/projects/${id}?tab=charter`);
}

export async function actionAddProjectRisk(formData: FormData): Promise<void> {
  const { addProjectRisk } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addProjectRisk({
    projectId,
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "").trim() || null,
    probability: ((formData.get("probability") as string) || "MEDIUM").trim(),
    impact: ((formData.get("impact") as string) || "MEDIUM").trim(),
    mitigation: ((formData.get("mitigation") as string) || "").trim() || null,
    contingency: ((formData.get("contingency") as string) || "").trim() || null,
    residualRisk:
      ((formData.get("residualRisk") as string) || "").trim() || null,
    targetDate: optDate(formData, "targetDate"),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=risks`);
}

export async function actionUpdateProjectRisk(
  formData: FormData
): Promise<void> {
  const { updateProjectRisk } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await updateProjectRisk({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    mitigation: ((formData.get("mitigation") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=risks`);
}

export async function actionAddProjectIssue(formData: FormData): Promise<void> {
  const { addProjectIssue } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addProjectIssue({
    projectId,
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=issues`);
}

export async function actionUpdateProjectIssue(
  formData: FormData
): Promise<void> {
  const { updateProjectIssue } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await updateProjectIssue({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    resolution: ((formData.get("resolution") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=issues`);
}

export async function actionUpsertRaci(formData: FormData): Promise<void> {
  const { upsertRaciEntry } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await upsertRaciEntry({
    id: ((formData.get("id") as string) || "").trim() || undefined,
    projectId,
    activity: ((formData.get("activity") as string) || "").trim(),
    responsible: ((formData.get("responsible") as string) || "").trim() || null,
    accountable: ((formData.get("accountable") as string) || "").trim() || null,
    consulted: ((formData.get("consulted") as string) || "").trim() || null,
    informed: ((formData.get("informed") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=raci`);
}

export async function actionDeleteRaci(formData: FormData): Promise<void> {
  const { deleteRaciEntry } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await deleteRaciEntry(formData.get("id") as string);
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=raci`);
}

export async function actionAddCommunication(
  formData: FormData
): Promise<void> {
  const { addCommunication } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addCommunication({
    projectId,
    audience: ((formData.get("audience") as string) || "").trim(),
    purpose: ((formData.get("purpose") as string) || "").trim() || null,
    frequency: ((formData.get("frequency") as string) || "").trim() || null,
    channel: ((formData.get("channel") as string) || "").trim() || null,
    ownerName: ((formData.get("ownerName") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=comms`);
}

export async function actionDeleteCommunication(
  formData: FormData
): Promise<void> {
  const { deleteCommunication } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await deleteCommunication(formData.get("id") as string);
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=comms`);
}

export async function actionAddPmoTask(formData: FormData): Promise<void> {
  const { addProjectTask } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addProjectTask({
    projectId,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "TODO").trim(),
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    kind: ((formData.get("kind") as string) || "TASK").trim(),
    storyPoints: optNum(formData, "storyPoints") ?? null,
    sprintLabel: ((formData.get("sprintLabel") as string) || "").trim() || null,
    piIncrementId:
      ((formData.get("piIncrementId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    estimatedHours: optNum(formData, "estimatedHours") ?? null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=schedule`);
}

export async function actionUpdatePmoTask(formData: FormData): Promise<void> {
  const { updateProjectTask } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await updateProjectTask({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    percentComplete: optNum(formData, "percentComplete"),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=schedule`);
}

export async function actionAddPmoMilestone(formData: FormData): Promise<void> {
  const { addProjectMilestone } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addProjectMilestone({
    projectId,
    name: ((formData.get("name") as string) || "").trim(),
    kind: ((formData.get("kind") as string) || "GATE").trim(),
    dueDate: optDate(formData, "dueDate"),
    description: ((formData.get("description") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=schedule`);
}

export async function actionUpdatePmoMilestone(
  formData: FormData
): Promise<void> {
  const { updateProjectMilestone } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await updateProjectMilestone({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=schedule`);
}

export async function actionSaveWikiPage(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { saveWikiPage } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  const page = await saveWikiPage({
    id: ((formData.get("id") as string) || "").trim() || undefined,
    projectId,
    slug: ((formData.get("slug") as string) || "").trim() || undefined,
    title: ((formData.get("title") as string) || "").trim(),
    body: ((formData.get("body") as string) || "") || "",
    userId: user?.id,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=wiki&page=${page.slug}`);
}

export async function actionCreatePi(formData: FormData): Promise<void> {
  const { createPiIncrement } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await createPiIncrement({
    projectId,
    name: ((formData.get("name") as string) || "").trim(),
    goals: ((formData.get("goals") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    capacityPoints: optNum(formData, "capacityPoints") ?? null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=pi`);
}

export async function actionAddPiFeature(formData: FormData): Promise<void> {
  const { addPiFeature } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addPiFeature({
    piId: formData.get("piId") as string,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    storyPoints: optNum(formData, "storyPoints") ?? null,
    ownerName: ((formData.get("ownerName") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=pi`);
}

export async function actionAddCostEntry(formData: FormData): Promise<void> {
  const { addCostEntry } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addCostEntry({
    projectId,
    productId: ((formData.get("productId") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "LABOR").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    amount: optNum(formData, "amount") ?? 0,
    hours: optNum(formData, "hours") ?? null,
    entryDate: optDate(formData, "entryDate"),
    source: "MANUAL",
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/products");
  redirect(`/pmo/projects/${projectId}?tab=cost`);
}

export async function actionAddProjectRequirement(
  formData: FormData
): Promise<void> {
  const { addProjectRequirement } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await addProjectRequirement({
    projectId,
    number: ((formData.get("number") as string) || "").trim() || null,
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "FUNCTIONAL").trim(),
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    source: ((formData.get("source") as string) || "").trim() || null,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  redirect(`/pmo/projects/${projectId}?tab=requirements`);
}

export async function actionSyncReqsToProduct(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { syncRequirementsToProduct } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await syncRequirementsToProduct({ projectId, userId: user?.id });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/products");
  redirect(`/pmo/projects/${projectId}?tab=requirements`);
}

export async function actionSyncMilestonesToProduct(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { syncMilestonesToProduct } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await syncMilestonesToProduct({ projectId, userId: user?.id });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/products");
  redirect(`/pmo/projects/${projectId}?tab=schedule`);
}

export async function actionLinkProductToProject(
  formData: FormData
): Promise<void> {
  const { linkProductToProject } = await import("@/lib/services/pmo");
  const projectId = formData.get("projectId") as string;
  await linkProductToProject({
    projectId,
    productId: formData.get("productId") as string,
    role: ((formData.get("role") as string) || "PRIMARY").trim(),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/products");
  redirect(`/pmo/projects/${projectId}?tab=product`);
}

// ─── Engineering work: WBS, Campaigns, Sagas, Tasks, Scan ──────

export async function actionCreateWbs(formData: FormData): Promise<void> {
  const { createWbsElement } = await import("@/lib/services/engineering-work");
  const projectId = formData.get("projectId") as string;
  const parentId = ((formData.get("parentId") as string) || "").trim() || null;
  await createWbsElement({
    projectId,
    parentId,
    code: ((formData.get("code") as string) || "").trim(),
    name: ((formData.get("name") as string) || "").trim(),
    kind: ((formData.get("kind") as string) || "WORK_PACKAGE").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    deliverables: ((formData.get("deliverables") as string) || "").trim() || null,
    budgetCost: optNum(formData, "budgetCost"),
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  const returnTo = ((formData.get("returnTo") as string) || "").trim();
  redirect(returnTo || `/pmo/projects/${projectId}?tab=wbs`);
}

export async function actionUpdateWbs(formData: FormData): Promise<void> {
  const { updateWbsElement } = await import("@/lib/services/engineering-work");
  const id = formData.get("id") as string;
  const projectId = formData.get("projectId") as string;
  await updateWbsElement({
    id,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    code: ((formData.get("code") as string) || "").trim() || undefined,
    kind: ((formData.get("kind") as string) || "").trim() || undefined,
    description: ((formData.get("description") as string) || "").trim() || null,
    deliverables: ((formData.get("deliverables") as string) || "").trim() || null,
    acceptanceCriteria:
      ((formData.get("acceptanceCriteria") as string) || "").trim() || null,
    assumptions: ((formData.get("assumptions") as string) || "").trim() || null,
    constraints: ((formData.get("constraints") as string) || "").trim() || null,
    resources: ((formData.get("resources") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    budgetCost: optNum(formData, "budgetCost"),
    actualCost: optNum(formData, "actualCost"),
    percentComplete: optNum(formData, "percentComplete"),
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath(`/pmo/wbs/${id}`);
  redirect(`/pmo/wbs/${id}`);
}

export async function actionCreateCampaign(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createCampaign } = await import("@/lib/services/engineering-work");
  const projectId = formData.get("projectId") as string;
  await createCampaign({
    projectId,
    wbsElementId: ((formData.get("wbsElementId") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    definitionOfDone:
      ((formData.get("definitionOfDone") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    ownerId: ((formData.get("ownerId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    dueDate: optDate(formData, "dueDate"),
    estimatedHours: optNum(formData, "estimatedHours"),
    storyPoints: optNum(formData, "storyPoints"),
    userId: user?.id,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/engineering");
  redirect(`/pmo/projects/${projectId}?tab=campaigns`);
}

export async function actionUpdateCampaign(formData: FormData): Promise<void> {
  const { updateCampaign } = await import("@/lib/services/engineering-work");
  const projectId = formData.get("projectId") as string;
  await updateCampaign({
    id: formData.get("id") as string,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    definitionOfDone:
      ((formData.get("definitionOfDone") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "").trim() || undefined,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/engineering");
  redirect(`/pmo/projects/${projectId}?tab=campaigns`);
}

export async function actionCreateSaga(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createSaga } = await import("@/lib/services/engineering-work");
  const projectId = formData.get("projectId") as string;
  const dependsOnTaskIds = formData
    .getAll("dependsOnTaskIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const dependsOnSagaIds = formData
    .getAll("dependsOnSagaIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  await createSaga({
    projectId,
    campaignId: formData.get("campaignId") as string,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    discipline: ((formData.get("discipline") as string) || "SYSTEMS").trim(),
    definitionOfDone:
      ((formData.get("definitionOfDone") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    ownerId: ((formData.get("ownerId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    dueDate: optDate(formData, "dueDate"),
    estimatedHours: optNum(formData, "estimatedHours"),
    storyPoints: optNum(formData, "storyPoints"),
    dependsOnTaskIds,
    dependsOnSagaIds,
    userId: user?.id,
  });
  revalidatePath(`/pmo/projects/${projectId}`);
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "").trim();
  redirect(ret || `/pmo/projects/${projectId}?tab=campaigns`);
}

export async function actionUpdateSaga(formData: FormData): Promise<void> {
  const { updateSaga } = await import("@/lib/services/engineering-work");
  await updateSaga({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    definitionOfDone:
      ((formData.get("definitionOfDone") as string) || "").trim() || null,
    discipline: ((formData.get("discipline") as string) || "").trim() || undefined,
    priority: ((formData.get("priority") as string) || "").trim() || undefined,
  });
  revalidatePath("/engineering");
  revalidatePath("/pmo");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionCreateEngTask(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { createEngTask } = await import("@/lib/services/engineering-work");
  const projectId =
    ((formData.get("projectId") as string) || "").trim() || null;
  const productId =
    ((formData.get("productId") as string) || "").trim() || null;
  const dependsOnTaskIds = formData
    .getAll("dependsOnTaskIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const dependsOnSagaIds = formData
    .getAll("dependsOnSagaIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  await createEngTask({
    projectId,
    productId,
    sagaId: ((formData.get("sagaId") as string) || "").trim() || null,
    campaignId: ((formData.get("campaignId") as string) || "").trim() || null,
    parentId: ((formData.get("parentId") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    kind: ((formData.get("kind") as string) || "TASK").trim(),
    discipline: ((formData.get("discipline") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    assigneeId: ((formData.get("assigneeId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    dueDate: optDate(formData, "dueDate"),
    estimatedHours: optNum(formData, "estimatedHours"),
    storyPoints: optNum(formData, "storyPoints") ?? null,
    dependsOnTaskIds,
    dependsOnSagaIds,
    userId: user?.id,
  });
  revalidatePath("/engineering");
  if (projectId) revalidatePath(`/pmo/projects/${projectId}`);
  if (productId) revalidatePath(`/products/${productId}`);
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionUpdateEngTask(formData: FormData): Promise<void> {
  // revalidate task detail below after update
  const { updateEngTask } = await import("@/lib/services/engineering-work");
  const sprintRaw = ((formData.get("engSprintId") as string) || "").trim();
  await updateEngTask({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    priority: ((formData.get("priority") as string) || "").trim() || undefined,
    assigneeId: ((formData.get("assigneeId") as string) || "").trim() || null,
    percentComplete: optNum(formData, "percentComplete"),
    engSprintId:
      formData.has("engSprintId") ? sprintRaw || null : undefined,
  });
  revalidatePath("/engineering");
  const tid = formData.get("id") as string;
  if (tid) revalidatePath(`/engineering/tasks/${tid}`);
  revalidatePath("/pmo");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionScanIn(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required to scan in");
  const { scanIntoTask } = await import("@/lib/services/engineering-work");
  const engTaskId = formData.get("engTaskId") as string;
  await scanIntoTask({
    engTaskId,
    userId: user.id,
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath("/engineering");
  revalidatePath("/pmo");
  if (engTaskId) revalidatePath(`/engineering/tasks/${engTaskId}`);
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionScanOut(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required to scan out");
  const { scanOutOfTask } = await import("@/lib/services/engineering-work");
  await scanOutOfTask({
    engTaskId: ((formData.get("engTaskId") as string) || "").trim() || undefined,
    scanId: ((formData.get("scanId") as string) || "").trim() || undefined,
    userId: user.id,
    notes: ((formData.get("notes") as string) || "").trim() || null,
  });
  revalidatePath("/engineering");
  revalidatePath("/pmo");
  revalidatePath("/products");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionBreakDownTask(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { breakDownTask } = await import("@/lib/services/engineering-work");
  await breakDownTask({
    parentTaskId: formData.get("parentTaskId") as string,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    assigneeId: ((formData.get("assigneeId") as string) || "").trim() || null,
    estimatedHours: optNum(formData, "estimatedHours"),
    storyPoints: optNum(formData, "storyPoints") ?? null,
    dueDate: optDate(formData, "dueDate"),
    userId: user?.id,
  });
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionAddEngDependency(
  formData: FormData
): Promise<void> {
  const { addEngDependency } = await import("@/lib/services/engineering-work");
  const type = ((formData.get("type") as string) || "FINISH_TO_START").trim();
  const notes = ((formData.get("notes") as string) || "").trim() || null;
  const targetTaskId =
    ((formData.get("targetTaskId") as string) || "").trim() || null;
  const targetSagaId =
    ((formData.get("targetSagaId") as string) || "").trim() || null;
  // Typeahead multi-select (dependsOn*) OR single source fields
  const depTaskIds = formData
    .getAll("dependsOnTaskIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const depSagaIds = formData
    .getAll("dependsOnSagaIds")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const singleSourceTask =
    ((formData.get("sourceTaskId") as string) || "").trim() || null;
  const singleSourceSaga =
    ((formData.get("sourceSagaId") as string) || "").trim() || null;
  if (singleSourceTask) depTaskIds.push(singleSourceTask);
  if (singleSourceSaga) depSagaIds.push(singleSourceSaga);

  for (const sourceTaskId of depTaskIds) {
    await addEngDependency({
      type,
      notes,
      sourceTaskId,
      targetTaskId,
      targetSagaId,
    });
  }
  for (const sourceSagaId of depSagaIds) {
    await addEngDependency({
      type,
      notes,
      sourceSagaId,
      targetTaskId,
      targetSagaId,
    });
  }
  revalidatePath("/engineering");
  if (targetTaskId) revalidatePath(`/engineering/tasks/${targetTaskId}`);
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionRemoveEngDependency(
  formData: FormData
): Promise<void> {
  const { removeEngDependency } = await import(
    "@/lib/services/engineering-work"
  );
  await removeEngDependency(formData.get("id") as string);
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionCreateEngSprint(
  formData: FormData
): Promise<void> {
  const { createEngSprint } = await import("@/lib/services/engineering-work");
  await createEngSprint({
    name: ((formData.get("name") as string) || "").trim(),
    goal: ((formData.get("goal") as string) || "").trim() || null,
    discipline: ((formData.get("discipline") as string) || "").trim() || null,
    projectId: ((formData.get("projectId") as string) || "").trim() || null,
    quarterId: ((formData.get("quarterId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
    createdByPmo: true,
  });
  revalidatePath("/engineering");
  revalidatePath("/pmo");
  revalidatePath("/pmo/pi");
  const ret = ((formData.get("returnTo") as string) || "/pmo/pi").trim();
  redirect(ret);
}

export async function actionCreatePlanningQuarter(
  formData: FormData
): Promise<void> {
  const { createPlanningQuarter } = await import("@/lib/services/pmo");
  const year = Number(formData.get("year"));
  const quarter = Number(formData.get("quarter"));
  await createPlanningQuarter({
    year,
    quarter,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    startDate: optDate(formData, "startDate") || new Date(),
    endDate: optDate(formData, "endDate") || new Date(),
    goals: ((formData.get("goals") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "PLANNED").trim(),
  });
  revalidatePath("/pmo");
  revalidatePath("/pmo/pi");
  redirect("/pmo/pi");
}

export async function actionUpdatePlanningQuarter(
  formData: FormData
): Promise<void> {
  const { updatePlanningQuarter } = await import("@/lib/services/pmo");
  await updatePlanningQuarter({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    goals: ((formData.get("goals") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim() || undefined,
  });
  revalidatePath("/pmo/pi");
  redirect("/pmo/pi");
}

export async function actionCreatePmoSprint(
  formData: FormData
): Promise<void> {
  const { createPmoSprint } = await import("@/lib/services/pmo");
  await createPmoSprint({
    quarterId: formData.get("quarterId") as string,
    name: ((formData.get("name") as string) || "").trim(),
    goal: ((formData.get("goal") as string) || "").trim() || null,
    discipline: ((formData.get("discipline") as string) || "").trim() || null,
    projectId: ((formData.get("projectId") as string) || "").trim() || null,
    startDate: optDate(formData, "startDate"),
    endDate: optDate(formData, "endDate"),
  });
  revalidatePath("/pmo/pi");
  revalidatePath("/engineering");
  redirect("/pmo/pi");
}

export async function actionUpsertBusinessPriority(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { upsertBusinessPriority } = await import(
    "@/lib/services/leadership"
  );
  const id = ((formData.get("id") as string) || "").trim() || undefined;
  await upsertBusinessPriority({
    id,
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "STRATEGIC").trim(),
    priority: optNum(formData, "priority") ?? 1,
    ownerRole: ((formData.get("ownerRole") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "DRAFT").trim(),
    effectiveFrom: optDate(formData, "effectiveFrom"),
    effectiveTo: optDate(formData, "effectiveTo"),
    userId: user?.id,
  });
  revalidatePath("/leadership");
  redirect("/leadership");
}

export async function actionSetPriorityStatus(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { setPriorityStatus } = await import("@/lib/services/leadership");
  await setPriorityStatus({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "PUBLISHED").trim(),
    userId: user?.id,
  });
  revalidatePath("/leadership");
  redirect("/leadership");
}

export async function actionAssignUserGroup(
  formData: FormData
): Promise<void> {
  const { assignUserToGroup } = await import("@/lib/services/permissions");
  await assignUserToGroup({
    userId: formData.get("userId") as string,
    groupId: formData.get("groupId") as string,
  });
  revalidatePath("/admin/permissions");
  redirect("/admin/permissions");
}

export async function actionRemoveUserGroup(
  formData: FormData
): Promise<void> {
  const { removeUserFromGroup } = await import("@/lib/services/permissions");
  await removeUserFromGroup({
    userId: formData.get("userId") as string,
    groupId: formData.get("groupId") as string,
  });
  revalidatePath("/admin/permissions");
  redirect("/admin/permissions");
}

export async function actionGrantUserPermission(
  formData: FormData
): Promise<void> {
  const { grantUserPermission } = await import("@/lib/services/permissions");
  const allowedRaw = ((formData.get("allowed") as string) || "true").trim();
  await grantUserPermission({
    userId: formData.get("userId") as string,
    permissionCode: formData.get("permissionCode") as string,
    allowed: allowedRaw !== "false",
  });
  revalidatePath("/admin/permissions");
  redirect("/admin/permissions");
}

export async function actionPostJournal(formData: FormData): Promise<void> {
  const user = await getCurrentUser("ACCOUNTING");
  const { postJournal } = await import("@/lib/services/gaap");
  const description = ((formData.get("description") as string) || "").trim();
  const debitAccountId = ((formData.get("debitAccountId") as string) || "").trim();
  const creditAccountId = ((formData.get("creditAccountId") as string) || "").trim();
  const amount = optNum(formData, "amount") || 0;
  if (!description || !debitAccountId || !creditAccountId || amount <= 0) {
    throw new Error("Description, accounts, and positive amount required");
  }
  const attachments: { url: string; fileName?: string; caption?: string; docType?: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const url = ((formData.get(`receipt_url_${i}`) as string) || "").trim();
    if (!url) continue;
    attachments.push({
      url,
      fileName: ((formData.get(`receipt_name_${i}`) as string) || "").trim() || undefined,
      caption: ((formData.get(`receipt_caption_${i}`) as string) || "").trim() || undefined,
      docType: "RECEIPT",
    });
  }
  // Single-field convenience
  const singleUrl = ((formData.get("receiptUrl") as string) || "").trim();
  if (singleUrl) {
    attachments.push({
      url: singleUrl,
      fileName: ((formData.get("receiptFileName") as string) || "").trim() || "receipt",
      docType: "RECEIPT",
    });
  }
  const postNow = (formData.get("postNow") as string) === "true";
  await postJournal({
    description,
    source: "MANUAL",
    status: postNow ? "POSTED" : "PENDING_APPROVAL",
    projectId: ((formData.get("projectId") as string) || "").trim() || undefined,
    chargeCode: ((formData.get("chargeCode") as string) || "").trim() || undefined,
    createdById: user?.id,
    attachments,
    lines: [
      {
        accountId: debitAccountId,
        debit: amount,
        chargeCode: ((formData.get("chargeCode") as string) || "").trim() || undefined,
      },
      {
        accountId: creditAccountId,
        credit: amount,
        chargeCode: ((formData.get("chargeCode") as string) || "").trim() || undefined,
      },
    ],
  });
  revalidatePath("/accounting");
  redirect(postNow ? "/accounting?tab=je" : "/accounting?tab=je&pending=1");
}

export async function actionUpdateEngSprint(
  formData: FormData
): Promise<void> {
  const { updateEngSprint } = await import("@/lib/services/engineering-work");
  await updateEngSprint({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    name: ((formData.get("name") as string) || "").trim() || undefined,
    goal: ((formData.get("goal") as string) || "").trim() || null,
  });
  revalidatePath("/engineering");
  revalidatePath("/pmo/pi");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionAssignTaskSprint(
  formData: FormData
): Promise<void> {
  const { assignTaskToSprint } = await import(
    "@/lib/services/engineering-work"
  );
  const sprintRaw = ((formData.get("engSprintId") as string) || "").trim();
  await assignTaskToSprint({
    engTaskId: formData.get("engTaskId") as string,
    engSprintId: sprintRaw || null,
  });
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionAssignSagaSprint(
  formData: FormData
): Promise<void> {
  const { assignSagaToSprint } = await import(
    "@/lib/services/engineering-work"
  );
  const sprintRaw = ((formData.get("engSprintId") as string) || "").trim();
  await assignSagaToSprint({
    sagaId: formData.get("sagaId") as string,
    engSprintId: sprintRaw || null,
  });
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "/engineering").trim();
  redirect(ret);
}

export async function actionCreateProductionEngIssue(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { createProductionEngIssue } = await import(
    "@/lib/services/engineering-work"
  );
  await createProductionEngIssue({
    title: ((formData.get("title") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    category: ((formData.get("category") as string) || "PROCESS").trim(),
    priority: ((formData.get("priority") as string) || "NORMAL").trim(),
    reportedById: user?.id,
    reportedByName: user?.name || null,
    workOrderId: ((formData.get("workOrderId") as string) || "").trim() || null,
    partId: ((formData.get("partId") as string) || "").trim() || null,
    productId: ((formData.get("productId") as string) || "").trim() || null,
    projectId: ((formData.get("projectId") as string) || "").trim() || null,
    sourceArea: ((formData.get("sourceArea") as string) || "").trim() || null,
    workCenter: ((formData.get("workCenter") as string) || "").trim() || null,
  });
  revalidatePath("/engineering");
  revalidatePath("/engineering/mfg_eng");
  revalidatePath("/floor");
  revalidatePath("/work-orders");
  const ret =
    ((formData.get("returnTo") as string) || "/engineering/mfg_eng?tab=prod").trim();
  redirect(ret);
}

export async function actionAcceptProductionIssue(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { acceptProductionIssueAsTask } = await import(
    "@/lib/services/engineering-work"
  );
  await acceptProductionIssueAsTask({
    issueId: formData.get("issueId") as string,
    assigneeId: ((formData.get("assigneeId") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/engineering");
  revalidatePath("/engineering/mfg_eng");
  const ret =
    ((formData.get("returnTo") as string) || "/engineering/mfg_eng?tab=board").trim();
  redirect(ret);
}

export async function actionUpdateProductionEngIssue(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { updateProductionEngIssue } = await import(
    "@/lib/services/engineering-work"
  );
  await updateProductionEngIssue({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim() || undefined,
    resolution: ((formData.get("resolution") as string) || "").trim() || null,
    changeRequestId:
      ((formData.get("changeRequestId") as string) || "").trim() || null,
    priority: ((formData.get("priority") as string) || "").trim() || undefined,
    userId: user?.id,
  });
  revalidatePath("/engineering");
  revalidatePath("/engineering/mfg_eng");
  revalidatePath("/floor");
  revalidatePath("/work-orders");
  const ret =
    ((formData.get("returnTo") as string) || "/engineering/mfg_eng?tab=prod").trim();
  redirect(ret);
}

export async function actionMoveEngWork(params: {
  kind: "task" | "saga";
  id: string;
  status: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (params.kind === "task") {
      const { updateEngTask } = await import("@/lib/services/engineering-work");
      await updateEngTask({ id: params.id, status: params.status });
    } else {
      const { updateSaga } = await import("@/lib/services/engineering-work");
      await updateSaga({ id: params.id, status: params.status });
    }
    revalidatePath("/engineering");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Move failed",
    };
  }
}

export async function actionCreateSwimLane(formData: FormData): Promise<void> {
  const { createSwimLane } = await import("@/lib/services/engineering-work");
  await createSwimLane({
    code: ((formData.get("code") as string) || "").trim(),
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
  });
  revalidatePath("/engineering");
  redirect("/engineering");
}

export async function actionRemoveSwimLane(formData: FormData): Promise<void> {
  const { removeSwimLane } = await import("@/lib/services/engineering-work");
  await removeSwimLane({
    id: ((formData.get("id") as string) || "").trim() || undefined,
    code: ((formData.get("code") as string) || "").trim() || undefined,
  });
  revalidatePath("/engineering");
  redirect("/engineering");
}

export async function actionMarkEngAlertRead(formData: FormData): Promise<void> {
  const { markAlertRead } = await import("@/lib/services/engineering-work");
  await markAlertRead(formData.get("id") as string);
  revalidatePath("/pmo");
  revalidatePath("/pmo/alerts");
  revalidatePath("/engineering");
  const ret = ((formData.get("returnTo") as string) || "/pmo/alerts").trim();
  redirect(ret);
}

// ─── GFP / Government Property ─────────────────────────────────

export async function actionAttachGfpDocument(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { attachGfpDocument } = await import("@/lib/services/gfp");
  const url = ((formData.get("url") as string) || "").trim();
  if (!url) throw new Error("Document URL / data required");
  await attachGfpDocument({
    propertyId: ((formData.get("propertyId") as string) || "").trim() || undefined,
    contractNumber:
      ((formData.get("contractNumber") as string) || "").trim() || undefined,
    docType: ((formData.get("docType") as string) || "DD1149").trim(),
    url,
    fileName: ((formData.get("fileName") as string) || "").trim() || undefined,
    caption: ((formData.get("caption") as string) || "").trim() || undefined,
    formNumber: ((formData.get("formNumber") as string) || "").trim() || undefined,
    formDate: (() => {
      const d = ((formData.get("formDate") as string) || "").trim();
      return d ? new Date(d) : null;
    })(),
    uploadedById: user?.id,
  });
  revalidatePath("/government-property");
}

export async function actionSetGfpAuditInterval(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { setGfpAuditInterval } = await import("@/lib/services/gfp");
  await setGfpAuditInterval({
    propertyId: formData.get("propertyId") as string,
    auditIntervalDays: Number(formData.get("auditIntervalDays") || 90),
    userId: user?.id,
  });
  revalidatePath("/government-property");
}

export async function actionCompleteGfpAudit(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const { completeGfpAudit } = await import("@/lib/services/gfp");
  await completeGfpAudit({
    auditId: ((formData.get("auditId") as string) || "").trim() || undefined,
    propertyId: formData.get("propertyId") as string,
    result: (formData.get("result") as "PASS" | "FAIL" | "N_A") || "PASS",
    findings: ((formData.get("findings") as string) || "").trim() || undefined,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
    auditedById: user?.id,
  });
  revalidatePath("/government-property");
}

export async function actionCheckoutGfp(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("No user");
  const { checkoutGfp } = await import("@/lib/services/gfp");
  const expectedReturn = ((formData.get("expectedReturn") as string) || "").trim();
  await checkoutGfp({
    propertyId: formData.get("propertyId") as string,
    checkedOutById:
      ((formData.get("checkedOutById") as string) || "").trim() || user.id,
    purpose: ((formData.get("purpose") as string) || "").trim() || undefined,
    expectedReturn: expectedReturn ? new Date(expectedReturn) : null,
  });
  revalidatePath("/government-property");
}

export async function actionCheckinGfp(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("No user");
  const { checkinGfp } = await import("@/lib/services/gfp");
  const dispositionRaw = ((formData.get("disposition") as string) || "CHECKIN").trim();
  const disposition =
    dispositionRaw === "RETURN_TO_GOV" || dispositionRaw === "TRANSFER_COMPANY"
      ? dispositionRaw
      : "CHECKIN";
  await checkinGfp({
    propertyId: formData.get("propertyId") as string,
    checkedInById: user.id,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
    disposition,
  });
  revalidatePath("/government-property");
  revalidatePath("/inventory");
}

export async function actionRequestGfpConsumption(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { requestGfpConsumption } = await import("@/lib/services/gfp");
  await requestGfpConsumption({
    propertyId: formData.get("propertyId") as string,
    workOrderId:
      ((formData.get("workOrderId") as string) || "").trim() || undefined,
    quantity: Number(formData.get("quantity") || 1),
    reason: ((formData.get("reason") as string) || "").trim() || undefined,
    requestedById: user?.id,
  });
  revalidatePath("/government-property");
  revalidatePath("/work-orders");
}

export async function actionDecideGfpConsumption(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser("PM");
  if (!user) throw new Error("No user");
  const { decideGfpConsumption } = await import("@/lib/services/gfp");
  await decideGfpConsumption({
    consumptionId: formData.get("consumptionId") as string,
    approve: formData.get("approve") === "true",
    approvedById: user.id,
    approvalNotes:
      ((formData.get("approvalNotes") as string) || "").trim() || undefined,
    pinCode: ((formData.get("pinCode") as string) || "").trim() || undefined,
  });
  revalidatePath("/government-property");
  revalidatePath("/work-orders");
}

// ─── Virtual assets ────────────────────────────────────────────

export async function actionCreateVirtualAsset(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { createVirtualAsset } = await import(
    "@/lib/services/virtual-assets"
  );
  await createVirtualAsset({
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || undefined,
    assetType: ((formData.get("assetType") as string) || "LICENSE").trim(),
    usageType: ((formData.get("usageType") as string) || "INTERNAL").trim(),
    vendor: ((formData.get("vendor") as string) || "").trim() || undefined,
    licenseKey: ((formData.get("licenseKey") as string) || "").trim() || undefined,
    seats: formData.get("seats")
      ? Number(formData.get("seats"))
      : undefined,
    cost: formData.get("cost") ? Number(formData.get("cost")) : undefined,
    expiresAt: (() => {
      const d = ((formData.get("expiresAt") as string) || "").trim();
      return d ? new Date(d) : null;
    })(),
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
    computerName: ((formData.get("computerName") as string) || "").trim() || undefined,
    productId: ((formData.get("productId") as string) || "").trim() || undefined,
    programId: ((formData.get("programId") as string) || "").trim() || undefined,
    projectId: ((formData.get("projectId") as string) || "").trim() || undefined,
    salesOrderId:
      ((formData.get("salesOrderId") as string) || "").trim() || undefined,
    userId: user?.id,
  });
  revalidatePath("/virtual-assets");
  redirect("/virtual-assets");
}

export async function actionAssignVirtualAsset(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { assignVirtualAsset } = await import(
    "@/lib/services/virtual-assets"
  );
  await assignVirtualAsset({
    assetId: formData.get("assetId") as string,
    userId: formData.get("userId") as string,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
    actorId: user?.id,
  });
  revalidatePath("/virtual-assets");
}

export async function actionCheckoutVirtualAsset(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("No user");
  const { checkoutVirtualAsset } = await import(
    "@/lib/services/virtual-assets"
  );
  await checkoutVirtualAsset({
    assetId: formData.get("assetId") as string,
    userId: ((formData.get("userId") as string) || "").trim() || user.id,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
  });
  revalidatePath("/virtual-assets");
}

export async function actionReturnVirtualAsset(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { returnVirtualAsset } = await import(
    "@/lib/services/virtual-assets"
  );
  await returnVirtualAsset({
    assetId: formData.get("assetId") as string,
    actorId: user?.id,
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
  });
  revalidatePath("/virtual-assets");
}

export async function actionUnassignVirtualAsset(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const { unassignVirtualAsset } = await import(
    "@/lib/services/virtual-assets"
  );
  await unassignVirtualAsset({
    assetId: formData.get("assetId") as string,
    actorId: user?.id,
  });
  revalidatePath("/virtual-assets");
}

// ─── Business priority alignment ───────────────────────────────

export async function actionAlignBusinessPriority(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const entityType = ((formData.get("entityType") as string) || "").trim();
  const entityId = ((formData.get("entityId") as string) || "").trim();
  const raw = ((formData.get("businessPriorityId") as string) || "").trim();
  const businessPriorityId = raw && raw !== "UNRATED" ? raw : null;

  if (entityType === "WorkOrder") {
    await prisma.workOrder.update({
      where: { id: entityId },
      data: { businessPriorityId },
    });
    revalidatePath("/work-orders");
    revalidatePath(`/work-orders/${entityId}`);
    revalidatePath("/planning");
  } else if (entityType === "EngTask") {
    await prisma.engTask.update({
      where: { id: entityId },
      data: { businessPriorityId },
    });
    revalidatePath("/engineering");
    revalidatePath("/pmo");
  } else if (entityType === "Campaign") {
    await prisma.campaign.update({
      where: { id: entityId },
      data: { businessPriorityId },
    });
    revalidatePath("/pmo");
  } else if (entityType === "Saga") {
    await prisma.saga.update({
      where: { id: entityId },
      data: { businessPriorityId },
    });
    revalidatePath("/engineering");
    revalidatePath("/pmo");
  } else {
    throw new Error("Unknown entity type for priority alignment");
  }

  await logAudit({
    entityType,
    entityId,
    action: "PRIORITY_ALIGN",
    userId: user?.id,
    changes: { businessPriorityId },
  });
  revalidatePath("/leadership");
  revalidatePath("/planning");
}

export async function actionAssignWorkCenterStaff(
  formData: FormData
): Promise<{ movedFrom: { code: string; name: string } | null }> {
  const { assignWorkCenterStaff } = await import("@/lib/services/capacity");
  const result = await assignWorkCenterStaff({
    workCenterId: formData.get("workCenterId") as string,
    userId: formData.get("userId") as string,
    hoursPerDay: Number(formData.get("hoursPerDay") || 8),
  });
  revalidatePath("/planning");
  revalidatePath("/workcenters");
  revalidatePath("/floor");
  return { movedFrom: result.movedFrom };
}

export async function actionRemoveWorkCenterStaff(
  formData: FormData
): Promise<void> {
  const { removeWorkCenterStaff } = await import("@/lib/services/capacity");
  await removeWorkCenterStaff({
    workCenterId: formData.get("workCenterId") as string,
    userId: formData.get("userId") as string,
  });
  revalidatePath("/planning");
  revalidatePath("/workcenters");
  revalidatePath("/floor");
}

export async function actionCreateAccount(formData: FormData): Promise<void> {
  const user = await getCurrentUser("ACCOUNTING");
  const code = ((formData.get("code") as string) || "").trim();
  const name = ((formData.get("name") as string) || "").trim();
  if (!code || !name) throw new Error("Account code and name required");
  await prisma.account.create({
    data: {
      code,
      name,
      type: ((formData.get("type") as string) || "EXPENSE").trim(),
      subtype: ((formData.get("subtype") as string) || "").trim() || null,
      chargeCodeType:
        ((formData.get("chargeCodeType") as string) || "").trim() || null,
      chargeCode: ((formData.get("chargeCode") as string) || "").trim() || null,
      description:
        ((formData.get("description") as string) || "").trim() || null,
      isActive: true,
      balance: Number(formData.get("balance") || 0),
    },
  });
  await logAudit({
    entityType: "Account",
    entityId: code,
    action: "CREATED",
    userId: user?.id,
  });
  revalidatePath("/accounting");
}

export async function actionUpdateAccount(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  await prisma.account.update({
    where: { id },
    data: {
      name: ((formData.get("name") as string) || "").trim() || undefined,
      type: ((formData.get("type") as string) || "").trim() || undefined,
      chargeCodeType:
        ((formData.get("chargeCodeType") as string) || "").trim() || null,
      chargeCode: ((formData.get("chargeCode") as string) || "").trim() || null,
      description:
        ((formData.get("description") as string) || "").trim() || null,
      isActive: formData.get("isActive") !== "false",
    },
  });
  revalidatePath("/accounting");
}

// Fix queue packing list — always redirect to shipment detail when created
export async function actionQueueShipmentAndOpen(
  formData: FormData
): Promise<void> {
  const salesOrderId = formData.get("salesOrderId") as string;
  const user = await getCurrentUser();
  const result = await ensureShipmentForSalesOrder({
    salesOrderId,
    userId: user?.id,
  });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`, "/shipping"]);
  if (result.shipment) {
    redirect(`/shipping/${result.shipment.id}`);
  }
  redirect("/shipping?queued=empty");
}

// ─────────────────────────────────────────────────────────────
// HR / Workforce
// ─────────────────────────────────────────────────────────────

export async function actionDecidePto(formData: FormData): Promise<void> {
  const { decidePtoRequest } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  await decidePtoRequest({
    id: formData.get("id") as string,
    decision:
      (formData.get("decision") as string) === "REJECTED"
        ? "REJECTED"
        : "APPROVED",
    userId: user?.id,
    approver: user ? { id: user.id, role: user.role } : null,
  });
  revalidatePath("/hr");
  revalidatePath("/approvals");
}

export async function actionRequestPto(formData: FormData): Promise<void> {
  const { createPtoRequest } = await import("@/lib/services/hr");
  const userId = (formData.get("userId") as string) || "";
  const startDate = new Date((formData.get("startDate") as string) || "");
  const endDate = new Date((formData.get("endDate") as string) || "");
  const hours = Number(formData.get("hours") || 0);
  if (!userId || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || hours <= 0) {
    return;
  }
  await createPtoRequest({
    userId,
    type: ((formData.get("type") as string) || "PTO").trim(),
    startDate,
    endDate,
    hours,
    reason: ((formData.get("reason") as string) || "").trim() || undefined,
  });
  revalidatePath("/hr");
}

export async function actionDecideTimeEntry(formData: FormData): Promise<void> {
  const { decideTimeEntry } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  await decideTimeEntry({
    id: formData.get("id") as string,
    decision:
      (formData.get("decision") as string) === "REJECTED"
        ? "REJECTED"
        : "APPROVED",
    userId: user?.id,
    approver: user ? { id: user.id, role: user.role } : null,
  });
  revalidatePath("/hr");
  revalidatePath("/approvals");
}

export async function actionAdvanceExpense(formData: FormData): Promise<void> {
  const { advanceExpenseReport } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  await advanceExpenseReport({
    id: formData.get("id") as string,
    status: ((formData.get("status") as string) || "").trim(),
    userId: user?.id,
    approver: user ? { id: user.id, role: user.role } : null,
  });
  revalidatePath("/hr");
  revalidatePath("/approvals");
}

export async function actionUpdateGoalProgress(
  formData: FormData
): Promise<void> {
  const { updateGoalProgress } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  await updateGoalProgress({
    id: formData.get("id") as string,
    progress: Number(formData.get("progress") || 0),
    userId: user?.id,
  });
  revalidatePath("/hr");
}

export async function actionSwitchDemoUser(formData: FormData): Promise<void> {
  const { cookies } = await import("next/headers");
  const { DEMO_USER_COOKIE } = await import("@/lib/auth");
  const userId = ((formData.get("userId") as string) || "").trim();
  const jar = await cookies();
  if (userId) {
    jar.set(DEMO_USER_COOKIE, userId, { path: "/", httpOnly: false });
  } else {
    jar.delete(DEMO_USER_COOKIE);
  }
  revalidatePath("/", "layout");
}

export async function actionSavePerformanceReview(
  formData: FormData
): Promise<void> {
  const { upsertPerformanceReview, canDecideFor } = await import(
    "@/lib/services/hr"
  );
  const { saveManagerReviewNotes } = await import(
    "@/lib/services/review-cycles"
  );
  const user = await getCurrentUser();
  if (!user) return;
  const reviewId = ((formData.get("id") as string) || "").trim();
  const employeeId = formData.get("employeeId") as string;
  const ok = await canDecideFor(
    { id: user.id, role: user.role },
    employeeId,
    "hr.review.manage"
  );
  if (!ok) throw new Error("Not authorized to review this employee");
  const ratingRaw = (formData.get("overallRating") as string) || "";
  const readyForSignoff =
    (formData.get("readyForSignoff") as string) === "true" ||
    (formData.get("status") as string) === "AWAITING_SIGNOFF";

  if (reviewId) {
    await saveManagerReviewNotes({
      reviewId,
      manager: { id: user.id, role: user.role },
      overallRating: ratingRaw ? Number(ratingRaw) : null,
      strengths: (formData.get("strengths") as string) || null,
      improvements: (formData.get("improvements") as string) || null,
      careerNotes: (formData.get("careerNotes") as string) || null,
      readyForSignoff,
    });
  } else {
    await upsertPerformanceReview({
      employeeId,
      reviewerId: user.id,
      period: ((formData.get("period") as string) || "").trim(),
      status: readyForSignoff
        ? "AWAITING_SIGNOFF"
        : ((formData.get("status") as string) || "IN_PROGRESS").trim(),
      overallRating: ratingRaw ? Number(ratingRaw) : null,
      strengths: (formData.get("strengths") as string) || null,
      improvements: (formData.get("improvements") as string) || null,
      careerNotes: (formData.get("careerNotes") as string) || null,
    });
  }
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${employeeId}`);
}

export async function actionCreateEmployeeGoal(
  formData: FormData
): Promise<void> {
  const { createEmployeeGoal, canDecideFor } = await import(
    "@/lib/services/hr"
  );
  const user = await getCurrentUser();
  if (!user) return;
  const forUserId = ((formData.get("userId") as string) || "").trim();
  const title = ((formData.get("title") as string) || "").trim();
  if (!forUserId || !title) return;
  if (forUserId !== user.id) {
    const ok = await canDecideFor(
      { id: user.id, role: user.role },
      forUserId,
      "hr.goal.manage"
    );
    if (!ok) throw new Error("Not authorized to set goals for this employee");
  }
  const targetRaw = (formData.get("targetDate") as string) || "";
  const target = targetRaw ? new Date(targetRaw) : null;
  await createEmployeeGoal({
    userId: forUserId,
    title,
    category: ((formData.get("category") as string) || "SKILL").trim(),
    targetDate: target && !Number.isNaN(target.getTime()) ? target : null,
    description: (formData.get("description") as string) || null,
    alignedTo: ((formData.get("alignedTo") as string) || "").trim() || null,
    createdById: user.id,
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${forUserId}`);
}

export async function actionAddEmployeeDocument(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { canDecideFor } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  if (!user) return;
  const userId = ((formData.get("userId") as string) || "").trim();
  const title = ((formData.get("title") as string) || "").trim();
  if (!userId || !title) return;
  const isSelf = userId === user.id;
  const isHrDocs = await userHasPermission(user.id, "hr.docs.manage");
  const isManager = await canDecideFor(
    { id: user.id, role: user.role },
    userId,
    "hr.docs.manage"
  );
  if (!isSelf && !isHrDocs && !isManager) {
    throw new Error("Not authorized to manage employee documents");
  }
  await prisma.employeeDocument.create({
    data: {
      userId,
      title,
      kind: ((formData.get("kind") as string) || "GENERAL").trim(),
      url: ((formData.get("url") as string) || "").trim() || null,
      note: ((formData.get("note") as string) || "").trim() || null,
    },
  });
  await logAudit({
    entityType: "EmployeeDocument",
    entityId: userId,
    action: "DOC_ADDED",
    userId: user.id,
    metadata: { title },
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${userId}`);
}

export async function actionAddTrainingRecord(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { canDecideFor } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  if (!user) return;
  const userId = ((formData.get("userId") as string) || "").trim();
  const name = ((formData.get("name") as string) || "").trim();
  if (!userId || !name) return;
  const isSelf = userId === user.id;
  const isHr = await userHasPermission(user.id, "hr.docs.manage");
  const isManager = await canDecideFor(
    { id: user.id, role: user.role },
    userId,
    "hr.docs.manage"
  );
  if (!isSelf && !isHr && !isManager) {
    throw new Error("Not authorized to manage training records");
  }
  const attachName = ((formData.get("attachmentName") as string) || "").trim();
  const attachUrl = ((formData.get("attachmentUrl") as string) || "").trim();
  const completedAtRaw = ((formData.get("completedAt") as string) || "").trim();
  let expiresAtRaw = ((formData.get("expiresAt") as string) || "").trim();

  // Recurring cycle: when no expiry is given, auto-fill it from a matching
  // active training requirement's frequency (e.g. annual forklift cert).
  if (!expiresAtRaw && completedAtRaw) {
    const reqs = await prisma.trainingRequirement.findMany({
      where: { isActive: true, frequencyMonths: { gt: 0 } },
      select: { name: true, frequencyMonths: true },
    });
    const match = reqs.find(
      (r) => r.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (match) {
      const d = new Date(completedAtRaw);
      d.setMonth(d.getMonth() + match.frequencyMonths);
      expiresAtRaw = d.toISOString();
    }
  }
  await prisma.trainingRecord.create({
    data: {
      userId,
      name,
      type: ((formData.get("type") as string) || "COURSE").trim(),
      provider: ((formData.get("provider") as string) || "").trim() || null,
      status: ((formData.get("status") as string) || "COMPLETED").trim(),
      completedAt: completedAtRaw ? new Date(completedAtRaw) : null,
      expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
      notes: ((formData.get("notes") as string) || "").trim() || null,
      attachments:
        attachUrl || attachName
          ? JSON.stringify([{ name: attachName || "Attachment", url: attachUrl }])
          : null,
      createdById: user.id,
    },
  });
  await logAudit({
    entityType: "TrainingRecord",
    entityId: userId,
    action: "TRAINING_ADDED",
    userId: user.id,
    metadata: { name },
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${userId}`);
}

export async function actionCreateTrainingRequirement(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!user) return;
  const isHr = await userHasPermission(user.id, "hr.docs.manage");
  if (!isHr && user.role !== "ADMIN") {
    throw new Error("Only HR can define training cycles");
  }
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) return;
  const frequencyMonths = Math.max(
    0,
    parseInt((formData.get("frequencyMonths") as string) || "12", 10) || 0
  );
  await prisma.trainingRequirement.create({
    data: {
      name,
      description:
        ((formData.get("description") as string) || "").trim() || null,
      type: ((formData.get("type") as string) || "COMPLIANCE").trim(),
      frequencyMonths,
      department:
        ((formData.get("department") as string) || "").trim() || null,
      createdById: user.id,
    },
  });
  await logAudit({
    entityType: "TrainingRequirement",
    entityId: name,
    action: "TRAINING_CYCLE_CREATED",
    userId: user.id,
    metadata: { name, frequencyMonths },
  });
  revalidatePath("/hr");
}

export async function actionToggleTrainingRequirement(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!user) return;
  const isHr = await userHasPermission(user.id, "hr.docs.manage");
  if (!isHr && user.role !== "ADMIN") {
    throw new Error("Only HR can manage training cycles");
  }
  const id = ((formData.get("id") as string) || "").trim();
  if (!id) return;
  const req = await prisma.trainingRequirement.findUnique({ where: { id } });
  if (!req) return;
  await prisma.trainingRequirement.update({
    where: { id },
    data: { isActive: !req.isActive },
  });
  revalidatePath("/hr");
}

export async function actionAttachTrainingEvidence(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { canDecideFor } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  if (!user) return;
  const recordId = ((formData.get("recordId") as string) || "").trim();
  const url = ((formData.get("url") as string) || "").trim();
  const name = ((formData.get("name") as string) || "").trim();
  if (!recordId || (!url && !name)) return;
  const record = await prisma.trainingRecord.findUnique({
    where: { id: recordId },
  });
  if (!record) return;
  const isSelf = record.userId === user.id;
  const isHr = await userHasPermission(user.id, "hr.docs.manage");
  const isManager = await canDecideFor(
    { id: user.id, role: user.role },
    record.userId,
    "hr.docs.manage"
  );
  if (!isSelf && !isHr && !isManager) {
    throw new Error("Not authorized to attach training evidence");
  }
  let list: { name: string; url: string }[] = [];
  try {
    const parsed = JSON.parse(record.attachments || "[]");
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    // start fresh on malformed data
  }
  list.push({ name: name || "Attachment", url });
  await prisma.trainingRecord.update({
    where: { id: recordId },
    data: { attachments: JSON.stringify(list) },
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${record.userId}`);
}

export async function actionGoalCheckIn(formData: FormData): Promise<void> {
  const { canDecideFor } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  if (!user) return;
  const goalId = ((formData.get("goalId") as string) || "").trim();
  const progress = Math.min(100, Math.max(0, Number(formData.get("progress") || 0)));
  const note = ((formData.get("note") as string) || "").trim() || null;
  if (!goalId) return;
  const goal = await prisma.employeeGoal.findUnique({ where: { id: goalId } });
  if (!goal) return;
  const isSelf = goal.userId === user.id;
  const isManager = await canDecideFor(
    { id: user.id, role: user.role },
    goal.userId,
    "hr.goal.manage"
  );
  if (!isSelf && !isManager) {
    throw new Error("Not authorized to check in on this goal");
  }
  await prisma.goalCheckIn.create({
    data: { goalId, authorId: user.id, progress, note },
  });
  await prisma.employeeGoal.update({
    where: { id: goalId },
    data: {
      progress,
      status: progress >= 100 ? "COMPLETED" : goal.status,
    },
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${goal.userId}`);
}

export async function actionImportData(
  _prev: import("@/lib/services/data-import").ImportResult | null,
  formData: FormData
): Promise<import("@/lib/services/data-import").ImportResult> {
  const { runImport } = await import("@/lib/services/data-import");
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!user || !(await userHasPermission(user.id, "admin.users.manage"))) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      total: 0,
      errors: [{ row: 0, message: "Not authorized to import data (needs admin.users.manage)." }],
    };
  }
  const entityRaw = ((formData.get("entity") as string) || "").trim();
  const entity = (["parts", "customers", "suppliers", "people"] as const).find(
    (e) => e === entityRaw
  );
  const text = ((formData.get("text") as string) || "").trim();
  if (!entity || !text) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      total: 0,
      errors: [{ row: 0, message: "Pick a data type and paste your rows first." }],
    };
  }
  const result = await runImport({ entity, text, userId: user.id });
  revalidatePath("/items");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
  revalidatePath("/hr");
  return result;
}

export async function actionStartTestDrive(): Promise<void> {
  const { cookies } = await import("next/headers");
  const { randomUUID } = await import("crypto");
  const { SANDBOX_COOKIE, materializeSandbox } = await import("@/lib/db");
  const id = randomUUID().toLowerCase();
  await materializeSandbox(id);
  const jar = await cookies();
  jar.set(SANDBOX_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax" });
  // Fresh sandbox, fresh identity — start as the admin persona
  jar.delete("forge-demo-user");
  revalidatePath("/", "layout");
  redirect("/");
}

export async function actionEndTestDrive(): Promise<void> {
  const { cookies } = await import("next/headers");
  const { SANDBOX_COOKIE, destroySandbox } = await import("@/lib/db");
  const jar = await cookies();
  const id = jar.get(SANDBOX_COOKIE)?.value;
  if (id) destroySandbox(id);
  jar.delete(SANDBOX_COOKIE);
  jar.delete("forge-demo-user");
  revalidatePath("/", "layout");
  redirect("/demo?ended=1");
}

export async function actionAddFeedbackNote(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { canDecideFor } = await import("@/lib/services/hr");
  const user = await getCurrentUser();
  if (!user) return;
  const aboutUserId = ((formData.get("aboutUserId") as string) || "").trim();
  const body = ((formData.get("body") as string) || "").trim();
  if (!aboutUserId || !body) return;
  const isHr = await userHasPermission(user.id, "hr.review.manage");
  const isManager = await canDecideFor(
    { id: user.id, role: user.role },
    aboutUserId,
    "hr.review.manage"
  );
  if (!isHr && !isManager) {
    throw new Error("Not authorized to leave feedback for this person");
  }
  await prisma.feedbackNote.create({
    data: {
      aboutUserId,
      authorId: user.id,
      kind: ((formData.get("kind") as string) || "PRAISE").trim(),
      visibility:
        ((formData.get("visibility") as string) || "SHARED").trim() ===
        "MANAGER_ONLY"
          ? "MANAGER_ONLY"
          : "SHARED",
      body,
    },
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${aboutUserId}`);
}

export async function actionCreatePermissionGroup(
  formData: FormData
): Promise<void> {
  const { createPermissionGroup } = await import("@/lib/services/permissions");
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "admin.permissions"))) {
    throw new Error("Not authorized to manage permissions");
  }
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) return;
  await createPermissionGroup({
    name,
    baseRole: ((formData.get("baseRole") as string) || "").trim() || undefined,
    description:
      ((formData.get("description") as string) || "").trim() || undefined,
  });
  revalidatePath("/admin/permissions");
}

export async function actionToggleGroupPermission(
  formData: FormData
): Promise<void> {
  const { toggleGroupPermission } = await import("@/lib/services/permissions");
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "admin.permissions"))) {
    throw new Error("Not authorized to manage permissions");
  }
  await toggleGroupPermission({
    groupId: formData.get("groupId") as string,
    permissionCode: formData.get("permissionCode") as string,
    enabled: (formData.get("enabled") as string) !== "false",
  });
  revalidatePath("/admin/permissions");
}

/** Ship a return-to-vendor shipment (no sales order attached). */
export async function actionShipReturnShipment(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const id = formData.get("shipmentId") as string;
  const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id } });
  if (shipment.salesOrderId) {
    throw new Error("Customer shipments ship through the pack & ship flow");
  }
  await prisma.shipment.update({
    where: { id },
    data: {
      status: "SHIPPED",
      shipDate: new Date(),
      carrier: ((formData.get("carrier") as string) || "").trim() || null,
      trackingNumber:
        ((formData.get("trackingNumber") as string) || "").trim() || null,
    },
  });
  await prisma.traceEvent.create({
    data: {
      shipmentId: id,
      eventType: "SHIPPED",
      notes: `Return shipment dispatched${user ? ` by ${user.name}` : ""}`,
    },
  });
  await logAudit({
    entityType: "Shipment",
    entityId: id,
    action: "RETURN_SHIPPED",
    userId: user?.id,
  });
  revalidatePath("/shipping");
  revalidatePath(`/shipping/${id}`);
  revalidatePath("/mrb");
}

// ─────────────────────────────────────────────────────────────
// Timesheets & payroll
// ─────────────────────────────────────────────────────────────

export async function actionAddTimesheetEntry(
  formData: FormData
): Promise<void> {
  const { addTimesheetEntry } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  const date = new Date((formData.get("date") as string) || "");
  if (Number.isNaN(date.getTime())) return;
  await addTimesheetEntry({
    userId: user.id,
    date,
    hours: Number(formData.get("hours") || 0),
    type: ((formData.get("type") as string) || "REGULAR").trim(),
    workOrderId: ((formData.get("workOrderId") as string) || "").trim() || null,
    projectId: ((formData.get("projectId") as string) || "").trim() || null,
    description: (formData.get("description") as string) || null,
  });
  revalidatePath("/hr/timesheet");
}

export async function actionRemoveTimesheetEntry(
  formData: FormData
): Promise<void> {
  const { removeTimesheetEntry } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  await removeTimesheetEntry({
    entryId: formData.get("entryId") as string,
    userId: user.id,
  });
  revalidatePath("/hr/timesheet");
}

export async function actionSubmitTimesheet(
  formData: FormData
): Promise<void> {
  const { submitTimesheet } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  await submitTimesheet({ id: formData.get("id") as string, userId: user.id });
  revalidatePath("/hr/timesheet");
  revalidatePath("/approvals");
}

export async function actionDecideTimesheetApproval(
  formData: FormData
): Promise<void> {
  const { decideTimesheetApproval } = await import(
    "@/lib/services/timesheets"
  );
  const user = await getCurrentUser();
  if (!user) return;
  await decideTimesheetApproval({
    approvalId: formData.get("approvalId") as string,
    decision:
      (formData.get("decision") as string) === "REJECTED"
        ? "REJECTED"
        : "APPROVED",
    approver: { id: user.id, role: user.role },
    notes: ((formData.get("notes") as string) || "").trim() || undefined,
  });
  revalidatePath("/approvals");
  revalidatePath("/hr/timesheet");
  revalidatePath("/accounting");
}

/**
 * Decide all of the reviewer's buckets on one timecard at once, for the
 * line-item approval queue. Returns the remaining queue count so the UI
 * can fire confetti when it hits zero.
 */
export async function actionReviewTimecard(input: {
  timesheetId: string;
  decision: "APPROVED" | "REJECTED";
  notes?: string;
}): Promise<{ ok: boolean; remaining: number; error?: string }> {
  const { decideReviewerBucketsForTimesheet } = await import(
    "@/lib/services/timesheets"
  );
  const user = await getCurrentUser();
  if (!user) return { ok: false, remaining: 0, error: "Not signed in" };
  try {
    const { remaining } = await decideReviewerBucketsForTimesheet({
      timesheetId: input.timesheetId,
      decision: input.decision,
      approver: { id: user.id, role: user.role },
      notes: input.notes,
    });
    revalidatePath("/approvals");
    revalidatePath("/hr/timesheet");
    revalidatePath("/accounting");
    return { ok: true, remaining };
  } catch (e) {
    return {
      ok: false,
      remaining: -1,
      error: e instanceof Error ? e.message : "Decision failed",
    };
  }
}

export async function actionSaveTimecardGrid(
  formData: FormData
): Promise<void> {
  const { saveTimecardGrid } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  const sheetId = formData.get("sheetId") as string;
  const rowsRaw = (formData.get("rows") as string) || "[]";
  let rows;
  try {
    rows = JSON.parse(rowsRaw);
  } catch {
    throw new Error("Bad grid payload");
  }
  await saveTimecardGrid({ userId: user.id, sheetId, rows });
  revalidatePath("/hr/timesheet");
}

export async function actionProcessTimesheet(
  formData: FormData
): Promise<void> {
  const { processTimesheet } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  await processTimesheet({
    id: formData.get("id") as string,
    processor: { id: user.id, role: user.role },
  });
  revalidatePath("/accounting");
  revalidatePath("/accounting");
  revalidatePath("/hr/timesheet");
}

export async function actionCreateTestProcedure(
  formData: FormData
): Promise<void> {
  const { createTestProcedure } = await import(
    "@/lib/services/test-procedures"
  );
  const user = await getCurrentUser();
  if (!user) return;
  const title = ((formData.get("title") as string) || "").trim();
  if (!title) return;
  await createTestProcedure({
    title,
    category: (formData.get("category") as string) || "FUNCTIONAL",
    partId: ((formData.get("partId") as string) || "").trim() || null,
    equipment: ((formData.get("equipment") as string) || "").trim() || null,
    purpose: ((formData.get("purpose") as string) || "").trim() || null,
    userId: user.id,
  });
  revalidatePath("/test-procedures");
}

export async function actionAddTestProcedureStep(
  formData: FormData
): Promise<void> {
  const { addTestProcedureStep } = await import(
    "@/lib/services/test-procedures"
  );
  const user = await getCurrentUser();
  if (!user) return;
  const parameter = ((formData.get("parameter") as string) || "").trim();
  if (!parameter) return;
  const min = (formData.get("minValue") as string) || "";
  const max = (formData.get("maxValue") as string) || "";
  await addTestProcedureStep({
    testProcedureId: formData.get("testProcedureId") as string,
    parameter,
    method: ((formData.get("method") as string) || "").trim() || undefined,
    spec: ((formData.get("spec") as string) || "").trim() || undefined,
    minValue: min ? Number(min) : null,
    maxValue: max ? Number(max) : null,
    units: ((formData.get("units") as string) || "").trim() || undefined,
  });
  revalidatePath("/test-procedures");
}

export async function actionReleaseTestProcedure(
  formData: FormData
): Promise<void> {
  const { releaseTestProcedure } = await import(
    "@/lib/services/test-procedures"
  );
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!user) return;
  if (
    !(await userHasPermission(user.id, "wi.release")) &&
    user.role !== "ADMIN" &&
    user.role !== "CM" &&
    user.role !== "QUALITY"
  ) {
    throw new Error("Releasing a test procedure requires CM/Quality authority");
  }
  await releaseTestProcedure({
    testProcedureId: formData.get("testProcedureId") as string,
    userId: user.id,
  });
  revalidatePath("/test-procedures");
}

export async function actionCreateAsset(formData: FormData): Promise<void> {
  const { createAsset } = await import("@/lib/services/assets");
  const user = await getCurrentUser();
  if (!user) return;
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) return;
  await createAsset({
    name,
    category: (formData.get("category") as string) || "EQUIPMENT",
    serialNumber: ((formData.get("serialNumber") as string) || "").trim() || undefined,
    manufacturer: ((formData.get("manufacturer") as string) || "").trim() || undefined,
    locationScope: (formData.get("locationScope") as string) || "IN_HOUSE_ONLY",
    homeLocation: ((formData.get("homeLocation") as string) || "").trim() || undefined,
    purchaseValue: Number(formData.get("purchaseValue") || 0) || undefined,
    userId: user.id,
  });
  revalidatePath("/assets");
}

export async function actionCheckoutAsset(formData: FormData): Promise<void> {
  const { checkoutAsset } = await import("@/lib/services/assets");
  const user = await getCurrentUser();
  if (!user) return;
  const holderId = ((formData.get("userId") as string) || "").trim() || user.id;
  const dueRaw = ((formData.get("dueAt") as string) || "").trim();
  await checkoutAsset({
    assetId: formData.get("assetId") as string,
    userId: holderId,
    purpose: ((formData.get("purpose") as string) || "").trim() || undefined,
    offsite: (formData.get("offsite") as string) === "true",
    destination: ((formData.get("destination") as string) || "").trim() || undefined,
    dueAt: dueRaw ? new Date(dueRaw) : null,
    workOrderId: ((formData.get("workOrderId") as string) || "").trim() || null,
    engTaskId: ((formData.get("engTaskId") as string) || "").trim() || null,
    actorId: user.id,
  });
  revalidatePath("/assets");
}

export async function actionCheckinAsset(formData: FormData): Promise<void> {
  const { checkinAsset } = await import("@/lib/services/assets");
  const user = await getCurrentUser();
  if (!user) return;
  await checkinAsset({
    assetId: formData.get("assetId") as string,
    returnNote: ((formData.get("returnNote") as string) || "").trim() || undefined,
    actorId: user.id,
  });
  revalidatePath("/assets");
}

export async function actionConnectBank(formData: FormData): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { connectBankAccount } = await import("@/lib/services/banking");
  const user = await getCurrentUser();
  if (!user || !(await userHasPermission(user.id, "accounting.journal.post"))) {
    throw new Error("Connecting accounts requires accounting authority");
  }
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) return;
  await connectBankAccount({
    name,
    institution: ((formData.get("institution") as string) || "").trim() || undefined,
    kind: (formData.get("kind") as string) || "CHECKING",
    last4: ((formData.get("last4") as string) || "").trim() || undefined,
    glAccountId: ((formData.get("glAccountId") as string) || "").trim() || undefined,
    userId: user.id,
  });
  revalidatePath("/accounting");
}

export async function actionImportBankTransactions(
  _prev: import("@/lib/services/banking").BankImportResult | null,
  formData: FormData
): Promise<import("@/lib/services/banking").BankImportResult> {
  const { userHasPermission } = await import("@/lib/auth");
  const { importBankTransactions } = await import("@/lib/services/banking");
  const user = await getCurrentUser();
  if (!user || !(await userHasPermission(user.id, "accounting.journal.post"))) {
    return { imported: 0, duplicates: 0, errors: [{ row: 0, message: "Not authorized." }] };
  }
  const bankAccountId = ((formData.get("bankAccountId") as string) || "").trim();
  const text = ((formData.get("text") as string) || "").trim();
  if (!bankAccountId || !text) {
    return { imported: 0, duplicates: 0, errors: [{ row: 0, message: "Pick an account and paste rows." }] };
  }
  const res = await importBankTransactions({ bankAccountId, text, userId: user.id });
  revalidatePath("/accounting");
  return res;
}

export async function actionCategorizeBankTxn(formData: FormData): Promise<void> {
  const { categorizeBankTransaction } = await import("@/lib/services/banking");
  const user = await getCurrentUser();
  if (!user) return;
  await categorizeBankTransaction({
    transactionId: formData.get("transactionId") as string,
    categoryAccountId: formData.get("categoryAccountId") as string,
    userId: user.id,
  });
  revalidatePath("/accounting");
  revalidatePath("/accounting");
}

export async function actionReconcileBankTxn(formData: FormData): Promise<void> {
  const { reconcileBankTransaction } = await import("@/lib/services/banking");
  await reconcileBankTransaction(formData.get("transactionId") as string);
  revalidatePath("/accounting");
}

export async function actionRunPayroll(): Promise<void> {
  const { runPayroll } = await import("@/lib/services/timesheets");
  const user = await getCurrentUser();
  if (!user) return;
  await runPayroll({ id: user.id, role: user.role });
  revalidatePath("/accounting");
  revalidatePath("/accounting");
  revalidatePath("/hr/timesheet");
}

export async function actionSavePayrollPolicy(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  const allowed =
    (await userHasPermission(user?.id, "accounting.journal.post")) ||
    (await userHasPermission(user?.id, "hr.admin"));
  if (!allowed) throw new Error("Payroll policy is owned by accounting / HR");

  // Holidays arrive one per line: "YYYY-MM-DD Name of holiday"
  const holidayLines = ((formData.get("holidays") as string) || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const holidays = holidayLines
    .map((l) => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      return m ? { date: m[1], name: m[2] } : null;
    })
    .filter(Boolean);

  const freq = ((formData.get("timesheetFrequency") as string) || "WEEKLY").toUpperCase();
  await prisma.payrollPolicy.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {
      timesheetFrequency: ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY"].includes(freq)
        ? freq
        : "WEEKLY",
      weekStartsOn: Math.min(6, Math.max(0, Number(formData.get("weekStartsOn") || 1))),
      ptoAccrualHoursPerPeriod: Math.max(0, Number(formData.get("ptoAccrualHoursPerPeriod") || 0)),
      sickHoursPerYear: Math.max(0, Number(formData.get("sickHoursPerYear") || 0)),
      maxHoursPerDay: Math.max(1, Number(formData.get("maxHoursPerDay") || 14)),
      otAfterDailyHours: Math.max(0, Number(formData.get("otAfterDailyHours") || 8)),
      dtAfterDailyHours: Math.max(0, Number(formData.get("dtAfterDailyHours") || 12)),
      otAfterWeeklyHours: Math.max(0, Number(formData.get("otAfterWeeklyHours") || 40)),
      otMultiplier: Math.max(1, Number(formData.get("otMultiplier") || 1.5)),
      dtMultiplier: Math.max(1, Number(formData.get("dtMultiplier") || 2)),
      holidays: JSON.stringify(holidays),
      updatedById: user?.id,
    },
  });
  await logAudit({
    entityType: "PayrollPolicy",
    entityId: "default",
    action: "POLICY_UPDATED",
    userId: user?.id,
  });
  revalidatePath("/accounting");
  revalidatePath("/hr/timesheet");
}

export async function actionSaveAccountingSettings(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Accounting settings require accounting authority");
  }
  const basis =
    ((formData.get("basis") as string) || "ACCRUAL").toUpperCase() === "CASH"
      ? "CASH"
      : "ACCRUAL";
  await prisma.accountingSettings.upsert({
    where: { id: "default" },
    create: { id: "default", basis },
    update: {
      basis,
      fiscalYearStartMonth: Math.min(
        12,
        Math.max(1, Number(formData.get("fiscalYearStartMonth") || 1))
      ),
      updatedById: user?.id,
    },
  });
  await logAudit({
    entityType: "AccountingSettings",
    entityId: "default",
    action: "SETTINGS_UPDATED",
    userId: user?.id,
  });
  revalidatePath("/accounting");
}

// ─────────────────────────────────────────────────────────────
// Review cycles
// ─────────────────────────────────────────────────────────────

export async function actionSaveReviewPolicy(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { saveReviewPolicy } = await import("@/lib/services/review-cycles");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "hr.admin"))) {
    throw new Error("Only HR administration may edit review policy");
  }
  const rawQuestions = ((formData.get("questions") as string) || "")
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  await saveReviewPolicy({
    frequencyMonths: Number(formData.get("frequencyMonths") || 12),
    selfReviewLeadDays: Number(formData.get("selfReviewLeadDays") || 30),
    questions: rawQuestions,
    updatedById: user?.id,
  });
  revalidatePath("/hr");
}

export async function actionOpenDueReviewCycles(): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { openDueReviewCycles } = await import("@/lib/services/review-cycles");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "hr.admin"))) {
    throw new Error("Only HR administration may open review cycles");
  }
  await openDueReviewCycles({ actorId: user?.id });
  revalidatePath("/hr");
}

export async function actionSubmitSelfReview(
  formData: FormData
): Promise<void> {
  const { submitSelfReview } = await import("@/lib/services/review-cycles");
  const user = await getCurrentUser();
  if (!user) return;
  const reviewId = formData.get("reviewId") as string;
  const questions = formData.getAll("question").map(String);
  const ratings = formData.getAll("rating").map(String);
  const comments = formData.getAll("comment").map(String);
  await submitSelfReview({
    reviewId,
    employeeId: user.id,
    ratings: questions.map((q, i) => ({
      question: q,
      rating: Number(ratings[i] || 3),
      comment: comments[i] || undefined,
    })),
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${user.id}`);
}

export async function actionSignOffReview(formData: FormData): Promise<void> {
  const { signOffReview } = await import("@/lib/services/review-cycles");
  const user = await getCurrentUser();
  if (!user) return;
  const reviewId = formData.get("reviewId") as string;
  const role =
    (formData.get("role") as string) === "MANAGER" ? "MANAGER" : "EMPLOYEE";
  const review = await signOffReview({
    reviewId,
    user: { id: user.id, role: user.role },
    role,
  });
  revalidatePath("/hr");
  revalidatePath(`/hr/person/${review.employeeId}`);
}

// ─────────────────────────────────────────────────────────────
// Accounting: JE approval, AR/AP payments, expenses
// ─────────────────────────────────────────────────────────────

export async function actionApproveJournal(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { approveJournal } = await import("@/lib/services/gaap");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Not authorized to approve journals");
  }
  await approveJournal({
    id: formData.get("id") as string,
    approvedById: user?.id,
  });
  revalidatePath("/accounting");
}

export async function actionVoidJournal(formData: FormData): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { voidJournal } = await import("@/lib/services/gaap");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Not authorized to void journals");
  }
  await voidJournal({ id: formData.get("id") as string, voidedById: user?.id });
  revalidatePath("/accounting");
}

export async function actionRecordArPayment(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { recordArPayment } = await import("@/lib/services/gaap");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Not authorized to record AR payments");
  }
  await recordArPayment({
    invoiceId: formData.get("invoiceId") as string,
    amount: Number(formData.get("amount") || 0),
    method: ((formData.get("method") as string) || "CHECK").trim(),
    reference: ((formData.get("reference") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/accounting");
}

export async function actionRecordApPayment(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { recordApPayment } = await import("@/lib/services/gaap");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Not authorized to record AP payments");
  }
  await recordApPayment({
    invoiceId: formData.get("invoiceId") as string,
    amount: Number(formData.get("amount") || 0),
    method: ((formData.get("method") as string) || "ACH").trim(),
    reference: ((formData.get("reference") as string) || "").trim() || null,
    userId: user?.id,
  });
  revalidatePath("/accounting");
}

export async function actionCreateExpenseEntry(
  formData: FormData
): Promise<void> {
  const { userHasPermission } = await import("@/lib/auth");
  const { createExpenseEntry } = await import("@/lib/services/gaap");
  const user = await getCurrentUser();
  if (!(await userHasPermission(user?.id, "accounting.journal.post"))) {
    throw new Error("Not authorized to create expenses");
  }
  await createExpenseEntry({
    description: ((formData.get("description") as string) || "").trim(),
    expenseAccountId: formData.get("expenseAccountId") as string,
    creditAccountId: formData.get("creditAccountId") as string,
    amount: Number(formData.get("amount") || 0),
    receiptUrl: ((formData.get("receiptUrl") as string) || "").trim() || null,
    receiptFileName:
      ((formData.get("receiptFileName") as string) || "").trim() || null,
    chargeCode: ((formData.get("chargeCode") as string) || "").trim() || null,
    projectId: ((formData.get("projectId") as string) || "").trim() || null,
    createdById: user?.id,
    submitForApproval: (formData.get("postNow") as string) !== "true",
  });
  revalidatePath("/accounting");
  redirect("/accounting?tab=je");
}

// ─────────────────────────────────────────────────────────────
// Setup wizard (plug-and-play onboarding)
// ─────────────────────────────────────────────────────────────

export async function actionSaveCompanyProfile(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  const name = ((formData.get("name") as string) || "").trim();
  if (!name) return;
  const departments = ((formData.get("departments") as string) || "")
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: { id: "default", name },
    update: {
      name,
      tagline: ((formData.get("tagline") as string) || "").trim() || "Manufacturing",
      departments: departments.length ? JSON.stringify(departments) : null,
      updatedById: user?.id,
    },
  });
  await logAudit({
    entityType: "CompanySettings",
    entityId: "default",
    action: "COMPANY_PROFILE_SAVED",
    userId: user?.id,
  });
  revalidatePath("/", "layout");
}

export async function actionWizardAddPerson(
  formData: FormData
): Promise<void> {
  const name = ((formData.get("name") as string) || "").trim();
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  if (!name || !email) return;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Update role/department/manager instead of failing
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        role: ((formData.get("role") as string) || existing.role).trim(),
        title: ((formData.get("title") as string) || "").trim() || existing.title,
        department:
          ((formData.get("department") as string) || "").trim() ||
          existing.department,
        managerId: ((formData.get("managerId") as string) || "").trim() || null,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        role: ((formData.get("role") as string) || "OPERATOR").trim(),
        title: ((formData.get("title") as string) || "").trim() || null,
        department: ((formData.get("department") as string) || "").trim() || null,
        managerId: ((formData.get("managerId") as string) || "").trim() || null,
        isActive: true,
      },
    });
  }
  revalidatePath("/setup");
  revalidatePath("/hr");
}

export async function actionCompleteSetup(): Promise<void> {
  const user = await getCurrentUser();
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: { id: "default", setupCompleted: true },
    update: { setupCompleted: true, updatedById: user?.id },
  });
  await logAudit({
    entityType: "CompanySettings",
    entityId: "default",
    action: "SETUP_COMPLETED",
    userId: user?.id,
  });
  revalidatePath("/", "layout");
  redirect("/");
}
