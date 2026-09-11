"use server";

import { revalidatePath } from "next/cache";
import { flashToast } from "@/lib/flash";

export async function actionBackfillStockSerials(formData: FormData) {
  const { requirePermission } = await import("@/lib/auth");
  const user = await requirePermission("serials.manage");
  const partId = String(formData.get("partId") || "");
  const raw = String(formData.get("serials") || "");
  const lotNumber = String(formData.get("lotNumber") || "").trim() || null;
  const serials = [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
  if (!partId || serials.length === 0) {
    await flashToast("Part and at least one serial required", "error");
    return;
  }
  const { prisma } = await import("@/lib/db");
  const { mintSerial } = await import("@/lib/services/serials");
  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) {
    await flashToast("Part not found", "error");
    return;
  }
  if (!part.isSerialized) {
    await prisma.part.update({
      where: { id: partId },
      data: { isSerialized: true },
    });
  }
  let created = 0;
  let skipped = 0;
  for (const serial of serials) {
    try {
      await mintSerial({
        serial,
        partId,
        lotNumber,
        status: "IN_STOCK",
        userId: user?.id,
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }
  await flashToast(
    `Recorded ${created} stock serial${created === 1 ? "" : "s"} on ${part.partNumber}${skipped ? ` (${skipped} already existed)` : ""}`
  );
  revalidatePath("/trace/serials");
  revalidatePath(`/items/${partId}`);
  revalidatePath("/inventory");
}
