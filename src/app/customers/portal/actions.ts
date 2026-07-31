"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { issueToken, revokeToken } from "@/lib/services/customer-portal";

/**
 * Customer-facing links are a sales relationship, so they ride the existing
 * customer-management permission rather than a new code no tenant has seeded.
 */
const MANAGE = "customers.manage";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

export async function actionIssueCustomerToken(fd: FormData) {
  await requirePermission(MANAGE);
  const { token } = await issueToken({
    customerId: str(fd, "customerId"),
    label: str(fd, "label") || null,
    days: Number(str(fd, "days")) || undefined,
  });
  revalidatePath("/customers/portal");
  redirect(`/customers/portal?issued=${encodeURIComponent(token)}`);
}

export async function actionRevokeCustomerToken(fd: FormData) {
  await requirePermission(MANAGE);
  await revokeToken(str(fd, "id"));
  revalidatePath("/customers/portal");
  redirect("/customers/portal");
}
