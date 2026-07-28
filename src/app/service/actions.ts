"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  addLabor,
  addPartUsage,
  completeVisit,
  createInstalledAsset,
  createTicket,
  removeLabor,
  removePartUsage,
  scheduleVisit,
  startVisit,
  updateTicketStatus,
} from "@/lib/services/field-service";
import { checkLotUsable } from "@/lib/services/shelf-life";

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
export async function actionCreateTicket(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const ticket = await createTicket({
    customerId: str(fd, "customerId"),
    title: str(fd, "title"),
    description: str(fd, "description") || null,
    installedAssetId: str(fd, "installedAssetId") || null,
    priority: str(fd, "priority") || "MEDIUM",
    serviceType: str(fd, "serviceType") || "REPAIR",
    billable: str(fd, "billable") !== "no",
    slaDueAt: date(fd, "slaDueAt"),
    siteAddress: str(fd, "siteAddress") || null,
    contactName: str(fd, "contactName") || null,
    contactPhone: str(fd, "contactPhone") || null,
    userId: user?.id,
  });
  revalidatePath("/service");
  redirect(`/service/${ticket.id}`);
}

export async function actionUpdateTicketStatus(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return;
  await updateTicketStatus({ id, status, userId: user?.id });
  revalidatePath(`/service/${id}`);
  revalidatePath("/service");
}

export async function actionScheduleVisit(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const ticketId = str(fd, "ticketId");
  if (!ticketId) return;
  await scheduleVisit({
    ticketId,
    technicianId: str(fd, "technicianId") || null,
    vehicleId: str(fd, "vehicleId") || null,
    scheduledFor: date(fd, "scheduledFor"),
    scheduledEnd: date(fd, "scheduledEnd"),
    userId: user?.id,
  });
  revalidatePath(`/service/${ticketId}`);
  revalidatePath("/service");
}

export async function actionStartVisit(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const ticketId = str(fd, "ticketId");
  if (!id) return;
  await startVisit({
    id,
    odometerStart: num(fd, "odometerStart"),
    userId: user?.id,
  });
  revalidatePath(`/service/${ticketId}`);
  revalidatePath("/service");
}

export async function actionCompleteVisit(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const ticketId = str(fd, "ticketId");
  if (!id) return;
  await completeVisit({
    id,
    summary: str(fd, "summary") || null,
    signedBy: str(fd, "signedBy") || null,
    odometerEnd: num(fd, "odometerEnd"),
    userId: user?.id,
  });
  revalidatePath(`/service/${ticketId}`);
  revalidatePath("/service");
}

export async function actionAddLabor(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const visitId = str(fd, "visitId");
  const hours = num(fd, "hours");
  if (!visitId || hours == null) return;
  await addLabor({
    visitId,
    userId: str(fd, "userId") || user?.id || null,
    hours,
    rate: num(fd, "rate") ?? 0,
    billable: str(fd, "billable") !== "no",
    notes: str(fd, "notes") || null,
  });
  revalidatePath(`/service/${str(fd, "ticketId")}`);
}

export async function actionAddPartUsage(fd: FormData): Promise<void> {
  const visitId = str(fd, "visitId");
  const quantity = num(fd, "quantity");
  if (!visitId || quantity == null) return;

  // Expired or quarantined material must not leave on a truck.
  const lotId = str(fd, "lotId");
  if (lotId) {
    const problem = await checkLotUsable(lotId);
    if (problem) throw new Error(problem);
  }

  await addPartUsage({
    visitId,
    partId: str(fd, "partId") || null,
    lotId: lotId || null,
    description: str(fd, "description") || null,
    quantity,
    unitPrice: num(fd, "unitPrice") ?? 0,
    billable: str(fd, "billable") !== "no",
    fromVehicleId: str(fd, "fromVehicleId") || null,
  });
  revalidatePath(`/service/${str(fd, "ticketId")}`);
}

export async function actionRemoveLabor(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  await removeLabor(id);
  revalidatePath(`/service/${str(fd, "ticketId")}`);
}

export async function actionRemovePartUsage(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  await removePartUsage(id);
  revalidatePath(`/service/${str(fd, "ticketId")}`);
}

export async function actionCreateInstalledAsset(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const customerId = str(fd, "customerId");
  if (!customerId) return;
  await createInstalledAsset({
    customerId,
    serialNumber: str(fd, "serialNumber") || null,
    partId: str(fd, "partId") || null,
    siteName: str(fd, "siteName") || null,
    address: str(fd, "address") || null,
    installedAt: date(fd, "installedAt"),
    warrantyEnds: date(fd, "warrantyEnds"),
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/service/assets");
}
