"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acknowledgeLine, uploadDocument } from "@/lib/services/supplier-portal";

/**
 * No requirePermission here on purpose: the caller is a supplier, not a user.
 * The token carries the authority, and every service call re-resolves it and
 * re-checks ownership rather than trusting anything posted with the form.
 */
function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

function back(token: string, params: string) {
  return `/portal/supplier/${encodeURIComponent(token)}?${params}`;
}

export async function actionAcknowledge(fd: FormData) {
  const token = str(fd, "token");
  const rawDate = str(fd, "confirmedDate");
  try {
    await acknowledgeLine({
      token,
      lineId: str(fd, "lineId"),
      status: str(fd, "status"),
      confirmedDate: rawDate ? new Date(rawDate) : null,
      note: str(fd, "note") || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not record that";
    redirect(back(token, `error=${encodeURIComponent(message)}`));
  }
  revalidatePath(`/portal/supplier/${token}`);
  redirect(back(token, "saved=1"));
}

export async function actionUploadDocument(fd: FormData) {
  const token = str(fd, "token");
  try {
    await uploadDocument({
      token,
      purchaseOrderId: str(fd, "purchaseOrderId") || null,
      docType: str(fd, "docType"),
      fileName: str(fd, "fileName"),
      fileUrl: str(fd, "fileUrl"),
      notes: str(fd, "notes") || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not upload";
    redirect(back(token, `error=${encodeURIComponent(message)}`));
  }
  revalidatePath(`/portal/supplier/${token}`);
  redirect(back(token, "saved=1"));
}
