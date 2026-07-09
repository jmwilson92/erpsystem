"use server";

import { revalidatePath } from "next/cache";
import {
  receivePurchaseOrder,
  dispositionMrb,
  updateSupplierScorecard,
} from "@/lib/services/supply-chain";
import {
  createReceivingTravelerForPo,
  syncReceivingTravelerStatus,
} from "@/lib/services/receiving";
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
    ...extra,
  ]) {
    revalidatePath(p);
  }
}

export async function actionReceivePo(formData: FormData): Promise<void> {
  const purchaseOrderId = formData.get("purchaseOrderId") as string;
  const failInspection = formData.get("failInspection") === "true";
  const user = await getCurrentUser();

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!po) throw new Error("PO not found");

  const lines = po.lines
    .filter((l) => l.quantityReceived < l.quantity)
    .map((l) => ({
      poLineId: l.id,
      quantityReceived: Math.min(l.quantity - l.quantityReceived, l.quantity),
      lotNumber: `LOT-RCV-${Date.now().toString(36).toUpperCase()}`,
    }));

  if (lines.length === 0) throw new Error("Nothing left to receive");

  await receivePurchaseOrder({
    purchaseOrderId,
    lines,
    receivedById: user?.id,
    failInspection,
  });

  await syncReceivingTravelerStatus(purchaseOrderId);

  revalidateFulfillmentPaths([
    "/purchasing",
    `/purchasing/po/${purchaseOrderId}`,
    "/receiving",
    "/mrb",
    "/suppliers",
  ]);
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

  await dispositionMrb({
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
}

export async function actionSignOffStep(formData: FormData) {
  const workOrderId = formData.get("workOrderId") as string;
  const stepId = formData.get("stepId") as string;
  const result = (formData.get("result") as string) || "PASS";
  const measuredValue = (formData.get("measuredValue") as string) || undefined;
  const notes = (formData.get("notes") as string) || undefined;
  const user = await getCurrentUser("OPERATOR");

  if (!user) throw new Error("No user");

  await signOffStep({
    workOrderId,
    stepId,
    userId: user.id,
    result,
    measuredValue,
    notes,
  });

  revalidatePath(`/work-orders/${workOrderId}`);
  revalidatePath("/floor");
  revalidatePath("/work-orders");
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
  const user = await getCurrentUser();

  await createWorkOrder({
    bomHeaderId,
    quantity,
    type,
    createdById: user?.id,
    workCenter: "ASM-01",
  });

  revalidatePath("/work-orders");
  revalidatePath("/floor");
  revalidatePath("/bom");
}

export async function actionCreateTaskWo(formData: FormData): Promise<void> {
  const description = formData.get("description") as string;
  const user = await getCurrentUser();

  const wi = await prisma.workInstruction.findFirst({
    where: { documentNumber: "WI-5S-DAILY", status: "RELEASED" },
  });

  await createWorkOrder({
    type: "TASK_ONLY",
    description: description || "Task-only work order",
    createdById: user?.id,
    workCenter: "ASM-01",
    workInstructionIds: wi ? [wi.id] : [],
  });

  revalidatePath("/work-orders");
  revalidatePath("/floor");
}

export async function actionApprovePr(formData: FormData) {
  const id = formData.get("id") as string;
  const user = await getCurrentUser("PURCHASING");
  await prisma.purchaseRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: user?.id,
      approvedAt: new Date(),
    },
  });
  await logAudit({
    entityType: "PurchaseRequest",
    entityId: id,
    action: "APPROVED",
    userId: user?.id,
  });
  revalidatePath("/purchasing");
}

export async function actionConvertPrToPo(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const user = await getCurrentUser("PURCHASING");
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: {
      lines: true,
      workOrder: { include: { project: true, wbsElement: true } },
    },
  });
  if (!pr || pr.status !== "APPROVED") throw new Error("PR must be approved");
  if (!pr.supplierId) throw new Error("PR needs a supplier");

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
      notes: pr.justification || undefined,
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

  const data: Record<string, unknown> = { status: toStatus };
  if (toStatus === "RELEASED") data.releasedAt = new Date();

  await prisma.workInstruction.update({ where: { id }, data });
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

export async function actionVoteCm(formData: FormData) {
  const memberId = formData.get("memberId") as string;
  const vote = formData.get("vote") as string;
  const comments = (formData.get("comments") as string) || undefined;

  await prisma.cmBoardMember.update({
    where: { id: memberId },
    data: { vote, comments, votedAt: new Date() },
  });

  const member = await prisma.cmBoardMember.findUnique({
    where: { id: memberId },
    include: { changeRequest: { include: { boardMembers: true } } },
  });

  if (member) {
    const votes = member.changeRequest.boardMembers;
    const allVoted = votes.every((v) => v.vote);
    if (allVoted) {
      const approved = votes.filter((v) => v.vote === "APPROVE").length;
      const rejected = votes.filter((v) => v.vote === "REJECT").length;
      const status = approved > rejected ? "APPROVED" : "REJECTED";
      await prisma.changeRequest.update({
        where: { id: member.changeRequestId },
        data: {
          status,
          decidedAt: new Date(),
          decisionNotes: `Board vote: ${approved} approve, ${rejected} reject`,
        },
      });
    }
  }

  revalidatePath("/cm");
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

  // Never fail the whole create if planning hits a soft block (no BOM, etc.)
  if (autoPlan) {
    try {
      await planSalesOrderFulfillment({
        salesOrderId: so.id,
        userId: user?.id,
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

  // Mark accepted then convert
  await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "ACCEPTED" },
  });

  const so = await convertQuoteToSalesOrder({
    quoteId,
    userId: user?.id,
    autoPlan,
  });

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
  const user = await getCurrentUser();
  await planSalesOrderFulfillment({ salesOrderId, userId: user?.id });
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
  const user = await getCurrentUser();
  await planWorkOrderMaterials({ workOrderId, userId: user?.id });
  revalidateFulfillmentPaths([`/work-orders/${workOrderId}`]);
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
  const kit = await completeKitOrder({ kitOrderId, userId: user?.id });
  revalidateFulfillmentPaths([
    `/work-orders/${kit?.workOrderId}`,
    `/kitting/${kitOrderId}`,
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
  const force = formData.get("force") === "true";
  const carrier = (formData.get("carrier") as string) || undefined;
  const trackingNumber = (formData.get("trackingNumber") as string) || undefined;
  const user = await getCurrentUser();
  await shipSalesOrder({
    salesOrderId,
    carrier,
    trackingNumber,
    userId: user?.id,
    force,
  });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`, "/shipping"]);
}

export async function actionQueueShipment(formData: FormData): Promise<void> {
  const salesOrderId = formData.get("salesOrderId") as string;
  const user = await getCurrentUser();
  await ensureShipmentForSalesOrder({ salesOrderId, userId: user?.id });
  revalidateFulfillmentPaths([`/sales/${salesOrderId}`, "/shipping"]);
}
