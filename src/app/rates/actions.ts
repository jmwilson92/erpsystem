"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import {
  upsertCostCenter,
  upsertPool,
  upsertYear,
} from "@/lib/services/rate-pools";

/**
 * Rate structure is accounting master data, so it reuses the budgets
 * permission rather than minting a new code that existing tenants would not
 * have until seeded.
 */
const MANAGE = "budgets.manage";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

function num(fd: FormData, key: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function withMessage(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    redirect(`/rates?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/rates");
  redirect("/rates?saved=1");
}

export async function actionUpsertPool(fd: FormData) {
  await requirePermission(MANAGE);
  await withMessage(() =>
    upsertPool({
      id: str(fd, "id") || undefined,
      code: str(fd, "code"),
      name: str(fd, "name"),
      poolType: str(fd, "poolType"),
      allocationBase: str(fd, "allocationBase"),
      sequence: num(fd, "sequence") ?? 10,
      description: str(fd, "description") || null,
    })
  );
}

export async function actionUpsertYear(fd: FormData) {
  await requirePermission(MANAGE);
  await withMessage(() =>
    upsertYear({
      ratePoolId: str(fd, "ratePoolId"),
      fiscalYear: num(fd, "fiscalYear") ?? new Date().getFullYear(),
      provisionalRate: num(fd, "provisionalRate") ?? 0,
      poolAmount: num(fd, "poolAmount") ?? 0,
      baseAmount: num(fd, "baseAmount") ?? 0,
      finalRate: num(fd, "finalRate"),
      status: str(fd, "status") || "PROVISIONAL",
      notes: str(fd, "notes") || null,
    })
  );
}

export async function actionUpsertCostCenter(fd: FormData) {
  await requirePermission(MANAGE);
  await withMessage(() =>
    upsertCostCenter({
      id: str(fd, "id") || undefined,
      code: str(fd, "code"),
      name: str(fd, "name"),
      kind: str(fd, "kind"),
      ratePoolId: str(fd, "ratePoolId") || null,
    })
  );
}
