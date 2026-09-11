"use server";

import { revalidatePath } from "next/cache";
import { flashToast } from "@/lib/flash";

export async function actionIssueTopUnitSerial(
  formData: FormData
): Promise<void> {
  const { requirePermission } = await import("@/lib/auth");
  const user = await requirePermission("serials.manage");
  const workOrderId = formData.get("workOrderId") as string;
  const unitIndex = Number(formData.get("unitIndex") || 1);
  const chosen = ((formData.get("serial") as string) || "").trim();
  const { assignUnitSerial } = await import("@/lib/services/serials");
  try {
    const { prisma } = await import("@/lib/db");
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { number: true },
    });
    const serial =
      chosen ||
      `${(wo?.number || "WO").replace(/\s+/g, "")}-U${String(unitIndex).padStart(2, "0")}`;
    await assignUnitSerial({
      workOrderId,
      unitIndex,
      serial,
      userId: user?.id,
    });
    await flashToast(`Unit ${unitIndex} top SN ${serial}`);
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not issue top serial",
      "error"
    );
  }
  revalidatePath(`/work-orders/${workOrderId}`);
}
