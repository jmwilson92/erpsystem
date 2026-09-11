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
  if (!chosen) {
    await flashToast("Type the nameplate serial for this unit", "error");
    revalidatePath(`/work-orders/${workOrderId}`);
    return;
  }
  const { assignUnitSerial } = await import("@/lib/services/serials");
  try {
    await assignUnitSerial({
      workOrderId,
      unitIndex,
      serial: chosen,
      userId: user?.id,
    });
    await flashToast(`Unit ${unitIndex} top SN ${chosen}`);
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not issue top serial",
      "error"
    );
  }
  revalidatePath(`/work-orders/${workOrderId}`);
}

export async function listTravelerSerialState(workOrderId: string) {
  const { prisma } = await import("@/lib/db");
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { part: { select: { isSerialized: true, partNumber: true } } },
  });
  if (!wo?.part?.isSerialized) {
    return { enabled: false as const, topSerial: null as string | null, pending: [] as { serial: string; partNumber: string; partId: string }[] };
  }
  const { listKitSerialPlan } = await import("@/lib/services/serials");
  const units = await prisma.workOrderUnit.findMany({
    where: { workOrderId },
    include: { serial: true },
    orderBy: { unitIndex: "asc" },
  });
  const top = units[0]?.serial?.serial || null;
  const plan = await listKitSerialPlan(workOrderId);
  const pending = plan
    .filter((a) => a.status !== "INSTALLED")
    .map((a) => ({
      serial: a.serial.serial,
      partNumber: a.serial.part.partNumber,
      partId: a.serial.partId || a.partId,
    }));
  return { enabled: true as const, topSerial: top, pending };
}
