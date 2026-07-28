"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  addMaintenance,
  completeMaintenance,
  createEquipment,
  endDowntime,
  recordMeter,
  startDowntime,
  updateEquipment,
} from "@/lib/services/maintenance";

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

export async function actionCreateEquipment(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const eq = await createEquipment({
    assetTag: str(fd, "assetTag"),
    name: str(fd, "name"),
    workCenterId: str(fd, "workCenterId") || null,
    manufacturer: str(fd, "manufacturer") || null,
    model: str(fd, "model") || null,
    serialNumber: str(fd, "serialNumber") || null,
    location: str(fd, "location") || null,
    meter: num(fd, "meter") ?? 0,
    meterUnit: str(fd, "meterUnit") || "HOURS",
    criticality: str(fd, "criticality") || "MEDIUM",
    installedAt: date(fd, "installedAt"),
    warrantyEnds: date(fd, "warrantyEnds"),
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/maintenance");
  redirect(`/maintenance/${eq.id}`);
}

export async function actionUpdateEquipment(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  if (!id) return;
  await updateEquipment(
    id,
    {
      name: str(fd, "name"),
      workCenterId: str(fd, "workCenterId") || null,
      status: str(fd, "status") || "ACTIVE",
      manufacturer: str(fd, "manufacturer") || null,
      model: str(fd, "model") || null,
      serialNumber: str(fd, "serialNumber") || null,
      location: str(fd, "location") || null,
      meterUnit: str(fd, "meterUnit") || "HOURS",
      criticality: str(fd, "criticality") || "MEDIUM",
      installedAt: date(fd, "installedAt"),
      warrantyEnds: date(fd, "warrantyEnds"),
      notes: str(fd, "notes") || null,
    },
    user?.id
  );
  revalidatePath(`/maintenance/${id}`);
  revalidatePath("/maintenance");
}

export async function actionRecordMeter(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const equipmentId = str(fd, "equipmentId");
  const value = num(fd, "value");
  if (!equipmentId || value == null) return;
  await recordMeter({
    equipmentId,
    value,
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath(`/maintenance/${equipmentId}`);
  revalidatePath("/maintenance");
}

export async function actionAddMaintenance(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const equipmentId = str(fd, "equipmentId");
  if (!equipmentId) return;
  await addMaintenance({
    equipmentId,
    type: str(fd, "type") || "PM",
    description: str(fd, "description") || null,
    dueAt: date(fd, "dueAt"),
    dueMeter: num(fd, "dueMeter"),
    intervalDays: num(fd, "intervalDays"),
    intervalMeter: num(fd, "intervalMeter"),
    userId: user?.id,
  });
  revalidatePath(`/maintenance/${equipmentId}`);
  revalidatePath("/maintenance");
}

export async function actionCompleteMaintenance(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const equipmentId = str(fd, "equipmentId");
  if (!id) return;
  await completeMaintenance({
    id,
    completedMeter: num(fd, "completedMeter"),
    cost: num(fd, "cost"),
    vendor: str(fd, "vendor") || null,
    downtimeMinutes: num(fd, "downtimeMinutes"),
    userId: user?.id,
  });
  revalidatePath(`/maintenance/${equipmentId}`);
  revalidatePath("/maintenance");
}

export async function actionStartDowntime(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const equipmentId = str(fd, "equipmentId");
  if (!equipmentId) return;
  await startDowntime({
    equipmentId,
    reason: str(fd, "reason") || "BREAKDOWN",
    description: str(fd, "description") || null,
    userId: user?.id,
  });
  revalidatePath(`/maintenance/${equipmentId}`);
  revalidatePath("/maintenance");
}

export async function actionEndDowntime(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const equipmentId = str(fd, "equipmentId");
  if (!id) return;
  await endDowntime({ id, userId: user?.id });
  revalidatePath(`/maintenance/${equipmentId}`);
  revalidatePath("/maintenance");
}
