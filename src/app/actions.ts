"use server";

import { revalidatePath } from "next/cache";
import {
  receivePurchaseOrder,
  dispositionMrb,
  updateSupplierScorecard,
} from "@/lib/services/supply-chain";
import {
  createWorkOrder,
  updateWorkOrderStatus,
  signOffStep,
} from "@/lib/services/work-orders";
import { certifyBom } from "@/lib/services/bom";
import { processAiQuery } from "@/lib/services/ai";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";

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

  revalidatePath("/purchasing");
  revalidatePath("/inventory");
  revalidatePath("/quality");
  revalidatePath("/mrb");
  revalidatePath("/suppliers");
  revalidatePath("/value-stream");
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

  await updateWorkOrderStatus({
    workOrderId,
    toStatus,
    userId: user?.id,
  });

  revalidatePath(`/work-orders/${workOrderId}`);
  revalidatePath("/work-orders");
  revalidatePath("/floor");
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
    include: { lines: true },
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

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "CREATED_FROM_PR",
    userId: user?.id,
    metadata: { prNumber: pr.number },
  });

  revalidatePath("/purchasing");
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
