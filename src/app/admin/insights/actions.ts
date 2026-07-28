"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformSupportEnabled } from "@/lib/platform";
import {
  ISSUE_STATUSES,
  setIssueStatus,
  type IssueStatus,
} from "@/lib/services/telemetry";

/**
 * Triage an error group.
 *
 * Gated the same way the dashboard itself is: a customer's own admin is ADMIN
 * inside their tenant, so the role check alone is not enough — the request must
 * also be in platform context (no demo/tenant cookie).
 */
export async function actionSetIssueStatus(fd: FormData): Promise<void> {
  const jar = await cookies();
  if (jar.get(DEMO_COOKIE)?.value || jar.get(TENANT_COOKIE)?.value) return;
  if (!(await isPlatformSupportEnabled())) return;
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return;

  const fingerprint = String(fd.get("fingerprint") || "").trim();
  const raw = String(fd.get("status") || "").trim();
  const status = ISSUE_STATUSES.find((s) => s === raw) as IssueStatus | undefined;
  if (!fingerprint || !status) return;

  await setIssueStatus({
    fingerprint,
    status,
    note: String(fd.get("note") || "").trim() || null,
    userId: user.id,
  });
  revalidatePath("/admin/insights");
}
