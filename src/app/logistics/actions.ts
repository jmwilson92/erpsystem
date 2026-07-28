"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import {
  addLandedCost,
  applyLandedCost,
  createCarrier,
  recordFreight,
  setReceiptLineWeight,
  updateCarrier,
} from "@/lib/services/logistics";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) || "").trim();
}
function num(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function date(fd: FormData, k: string): Date | null {
  const v = str(fd, k);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function actionCreateCarrier(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  await createCarrier({
    code: str(fd, "code"),
    name: str(fd, "name"),
    mode: str(fd, "mode") || "PARCEL",
    accountNumber: str(fd, "accountNumber") || null,
    contactName: str(fd, "contactName") || null,
    contactPhone: str(fd, "contactPhone") || null,
    trackingUrl: str(fd, "trackingUrl") || null,
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/logistics");
}

export async function actionToggleCarrier(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  await updateCarrier(id, { isActive: str(fd, "isActive") === "yes" });
  revalidatePath("/logistics");
}

export async function actionRecordFreight(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const cost = num(fd, "cost");
  if (cost == null) return;
  await recordFreight({
    carrierId: str(fd, "carrierId") || null,
    shipmentId: str(fd, "shipmentId") || null,
    receiptId: str(fd, "receiptId") || null,
    direction: str(fd, "direction") || "OUTBOUND",
    trackingNumber: str(fd, "trackingNumber") || null,
    service: str(fd, "service") || null,
    weight: num(fd, "weight"),
    weightUnit: str(fd, "weightUnit") || "LB",
    cost,
    billedAmount: num(fd, "billedAmount"),
    shippedAt: date(fd, "shippedAt"),
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/logistics");
}

export async function actionAddLandedCost(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const receiptId = str(fd, "receiptId");
  const amount = num(fd, "amount");
  if (!receiptId || amount == null) return;
  await addLandedCost({
    receiptId,
    type: str(fd, "type") || "FREIGHT",
    amount,
    allocation: str(fd, "allocation") || "VALUE",
    description: str(fd, "description") || null,
    vendor: str(fd, "vendor") || null,
    userId: user?.id,
  });
  revalidatePath(`/logistics/landed/${receiptId}`);
  revalidatePath("/logistics");
}

export async function actionApplyLandedCost(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const chargeId = str(fd, "chargeId");
  const receiptId = str(fd, "receiptId");
  if (!chargeId) return;
  await applyLandedCost({ chargeId, userId: user?.id });
  revalidatePath(`/logistics/landed/${receiptId}`);
  revalidatePath("/logistics");
}

export async function actionSetLineWeight(fd: FormData): Promise<void> {
  const lineId = str(fd, "lineId");
  const receiptId = str(fd, "receiptId");
  if (!lineId) return;
  await setReceiptLineWeight({
    lineId,
    weight: num(fd, "weight"),
    weightUom: str(fd, "weightUom") || "LB",
  });
  revalidatePath(`/logistics/landed/${receiptId}`);
}
