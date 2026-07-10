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

function parsePassFail(raw: FormDataEntryValue | null): "PASS" | "FAIL" | "PENDING" | undefined {
  if (!raw) return undefined;
  const v = String(raw).toUpperCase();
  if (v === "PASS" || v === "FAIL" || v === "PENDING") return v;
  return undefined;
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
  const user = await getCurrentUser();

  const wo = await createWorkOrder({
    bomHeaderId,
    quantity,
    type,
    sourceType: "BOM",
    // Only attach project when user explicitly selected one
    projectId,
    createdById: user?.id,
    workCenter: "ASM-01",
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
  const user = await getCurrentUser();

  const wi = await prisma.workInstruction.findFirst({
    where: { documentNumber: "WI-5S-DAILY", status: "RELEASED" },
  });

  const wo = await createWorkOrder({
    type: "TASK_ONLY",
    description: description || "Task-only work order",
    createdById: user?.id,
    workCenter: "ASM-01",
    workInstructionIds: wi ? [wi.id] : [],
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
  const id = formData.get("id") as string;
  const user = await getCurrentUser("PURCHASING");
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: {
      lines: true,
      supplier: true,
      workOrder: { include: { project: true, wbsElement: true } },
    },
  });
  if (!pr || pr.status !== "APPROVED") throw new Error("PR must be approved");
  if (!pr.supplierId || !pr.supplier) throw new Error("PR needs a supplier");
  if (!isSupplierApprovedForPo(pr.supplier)) {
    throw new Error(
      `Supplier ${pr.supplier.code} is not on the Approved Supplier List (ASL). ` +
        "Only ASL vendors (isApprovedVendor + APPROVED/CONDITIONAL) can be used on POs."
    );
  }

  // PO-level GFP only if explicitly marked on the PR justification/notes for now
  // (material becomes GFP when put away to a GFP area or via GFP traveler)
  const isGovernmentProperty =
    formData.get("isGovernmentProperty") === "true" ||
    formData.get("isGovernmentProperty") === "on" ||
    /government property|gfp|gfe/i.test(pr.justification || "");

  const count = await prisma.purchaseOrder.count();
  const po = await prisma.purchaseOrder.create({
    data: {
      number: `PO-${String(count + 1).padStart(5, "0")}`,
      status: "ISSUED",
      supplierId: pr.supplierId,
      purchaseRequestId: pr.id,
      totalAmount: pr.totalEstimate,
      buyerId: user?.id,
      promisedDate: pr.neededBy,
      projectId: pr.workOrder?.projectId || undefined,
      wbsElementId: pr.workOrder?.wbsElementId || undefined,
      shipToAddress: "Forge Dynamics LLC\nReceiving Dock\n1200 Precision Way\nHuntsville, AL 35806",
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
          partId: l.partId,
          description: l.description,
          quantity: l.quantity,
          unitCost: l.estimatedUnitCost,
          lineNumber: i + 1,
          promisedDate: pr.neededBy,
        })),
      },
    },
  });

  await prisma.purchaseRequest.update({
    where: { id },
    data: { status: "CONVERTED" },
  });

  // Count trial ASL usage toward the vendor's trial order limit
  if (pr.supplier.isTrialVendor) {
    await prisma.supplier.update({
      where: { id: pr.supplierId },
      data: { trialOrdersUsed: { increment: 1 } },
    });
  }

  // Dock traveler waits for material against this PO
  await createReceivingTravelerForPo({
    purchaseOrderId: po.id,
    userId: user?.id,
  });

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
  // Approvers may vote; CM can also vote if on board
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
    const isDocEcr = Boolean(cr.documentNumber);
    const voters = isDocEcr
      ? cr.boardMembers.filter((v) =>
          ["APPROVER", "ENGINEERING", "QUALITY"].includes(v.role)
        )
      : cr.boardMembers;
    const allVoted = voters.length > 0 && voters.every((v) => v.vote);
    if (allVoted) {
      const approved = voters.filter((v) => v.vote === "APPROVE").length;
      const rejected = voters.filter((v) => v.vote === "REJECT").length;
      // Document ECRs require both approvers to APPROVE
      const status =
        isDocEcr
          ? approved === voters.length && rejected === 0
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
          decisionNotes: `Released by CM board (${approved}/${voters.length})`,
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
  const column = ((formData.get("column") as string) || "IN_WORK").toUpperCase();
  const user = await getCurrentUser("CM");
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
  await ensureShipmentForSalesOrder({ salesOrderId, userId: user?.id });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`, "/shipping"]);
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
