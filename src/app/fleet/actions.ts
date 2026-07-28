"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  addFuelLog,
  addMaintenance,
  completeMaintenance,
  createVehicle,
  updateVehicle,
} from "@/lib/services/fleet";

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

export async function actionCreateVehicle(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const vehicle = await createVehicle({
    unitNumber: str(fd, "unitNumber"),
    name: str(fd, "name") || null,
    type: str(fd, "type") || "VAN",
    make: str(fd, "make") || null,
    model: str(fd, "model") || null,
    year: num(fd, "year") ?? null,
    vin: str(fd, "vin") || null,
    licensePlate: str(fd, "licensePlate") || null,
    odometer: num(fd, "odometer") ?? 0,
    odometerUnit: str(fd, "odometerUnit") || "MI",
    assignedToId: str(fd, "assignedToId") || null,
    homeLocation: str(fd, "homeLocation") || null,
    registrationExpires: date(fd, "registrationExpires"),
    insuranceExpires: date(fd, "insuranceExpires"),
    inspectionExpires: date(fd, "inspectionExpires"),
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/fleet");
  redirect(`/fleet/${vehicle.id}`);
}

export async function actionUpdateVehicle(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  if (!id) return;
  await updateVehicle(
    id,
    {
      name: str(fd, "name") || null,
      type: str(fd, "type") || "VAN",
      status: str(fd, "status") || "ACTIVE",
      make: str(fd, "make") || null,
      model: str(fd, "model") || null,
      year: num(fd, "year"),
      vin: str(fd, "vin") || null,
      licensePlate: str(fd, "licensePlate") || null,
      odometer: num(fd, "odometer") ?? 0,
      odometerUnit: str(fd, "odometerUnit") || "MI",
      assignedToId: str(fd, "assignedToId") || null,
      homeLocation: str(fd, "homeLocation") || null,
      registrationExpires: date(fd, "registrationExpires"),
      insuranceExpires: date(fd, "insuranceExpires"),
      inspectionExpires: date(fd, "inspectionExpires"),
      notes: str(fd, "notes") || null,
    },
    user?.id
  );
  revalidatePath(`/fleet/${id}`);
  revalidatePath("/fleet");
}

export async function actionAddMaintenance(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const vehicleId = str(fd, "vehicleId");
  if (!vehicleId) return;
  await addMaintenance({
    vehicleId,
    type: str(fd, "type") || "PM",
    description: str(fd, "description") || null,
    dueAt: date(fd, "dueAt"),
    dueOdometer: num(fd, "dueOdometer"),
    intervalDays: num(fd, "intervalDays"),
    intervalDistance: num(fd, "intervalDistance"),
    userId: user?.id,
  });
  revalidatePath(`/fleet/${vehicleId}`);
  revalidatePath("/fleet");
}

export async function actionCompleteMaintenance(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const vehicleId = str(fd, "vehicleId");
  if (!id) return;
  await completeMaintenance({
    id,
    completedOdometer: num(fd, "completedOdometer"),
    cost: num(fd, "cost"),
    vendor: str(fd, "vendor") || null,
    userId: user?.id,
  });
  revalidatePath(`/fleet/${vehicleId}`);
  revalidatePath("/fleet");
}

export async function actionAddFuel(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const vehicleId = str(fd, "vehicleId");
  const gallons = num(fd, "gallons");
  const cost = num(fd, "cost");
  if (!vehicleId || gallons == null || cost == null) return;
  await addFuelLog({
    vehicleId,
    gallons,
    cost,
    odometer: num(fd, "odometer"),
    location: str(fd, "location") || null,
    userId: user?.id,
  });
  revalidatePath(`/fleet/${vehicleId}`);
}
