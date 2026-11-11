"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { quarantineExpiredLots } from "@/lib/services/shelf-life";

export async function actionQuarantineExpired(): Promise<void> {
  const user = await requirePermission("inventory.putaway");
  await quarantineExpiredLots(user.id);
  revalidatePath("/inventory/expiring");
  revalidatePath("/inventory");
}
