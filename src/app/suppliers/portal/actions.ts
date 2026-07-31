"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import {
  acceptProposedDate,
  issueToken,
  revokeToken,
} from "@/lib/services/supplier-portal";

/**
 * Buyers who can turn a PR into a PO are the ones who own supplier dates, so
 * that existing code governs portal links and date acceptance rather than a
 * new one that no tenant would have seeded yet.
 */
const MANAGE = "purchasing.po.convert";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

/**
 * The raw token exists only in this redirect. It is hashed at rest and cannot
 * be shown again, so the buyer has to copy it now.
 */
export async function actionIssueToken(fd: FormData) {
  await requirePermission(MANAGE);
  const { token } = await issueToken({
    supplierId: str(fd, "supplierId"),
    label: str(fd, "label") || null,
    days: Number(str(fd, "days")) || undefined,
  });
  revalidatePath("/suppliers/portal");
  redirect(`/suppliers/portal?issued=${encodeURIComponent(token)}`);
}

export async function actionRevokeToken(fd: FormData) {
  await requirePermission(MANAGE);
  await revokeToken(str(fd, "id"));
  revalidatePath("/suppliers/portal");
  redirect("/suppliers/portal");
}

export async function actionAcceptDate(fd: FormData) {
  const user = await requirePermission(MANAGE);
  try {
    await acceptProposedDate(str(fd, "lineId"), user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not accept";
    redirect(`/suppliers/portal?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/suppliers/portal");
  redirect("/suppliers/portal?saved=1");
}
