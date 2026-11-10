import { prisma } from "@/lib/db";

/** Demand/charge owner and buyer must be distinct people, including admins.
 * The charge owner may return for the final purchase approval, as the workflow intends.
 * Owner test-account role switching already produces distinct persona IDs. */
export async function assertSeparatePrSigner(purchaseRequestId: string, userId?: string, approvalId?: string) {
  if (!userId || !approvalId) throw new Error("A signed-in approver is required");
  const steps = await prisma.approval.findMany({ where: {
    entityType: "PurchaseRequest", entityId: purchaseRequestId,
  }, include: { policyStep: true } });
  const isBuyer = (step: typeof steps[number]) => step.policyStep?.routingKey === "BUYER_PACKAGE" || /buyer package/i.test(step.stage);
  const current = steps.find(step => step.id === approvalId);
  if (!current) throw new Error("Approval step not found");
  const previous = steps.find(step => step.id !== approvalId && step.status === "APPROVED" && step.approverId === userId && isBuyer(step) !== isBuyer(current));
  if (previous) throw new Error("A different person must sign demand/charge-owner and buyer approval steps; you already approved the other step");
}
