"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  addCdrl,
  addClin,
  addMod,
  createContract,
  exerciseOption,
  executeMod,
  submitCdrl,
} from "@/lib/services/contracts";

/**
 * Contracts reuse the PMO permission codes rather than introducing a new
 * `contracts.*` namespace: a new code would be missing from every existing
 * tenant's permission table until it was seeded, which silently locks people
 * out of a module they can already see in the nav.
 */
const VIEW = "pmo.view";
const MANAGE = "pmo.project.manage";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

function num(fd: FormData, key: string) {
  const raw = str(fd, key);
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function date(fd: FormData, key: string) {
  const raw = str(fd, key);
  return raw ? new Date(raw) : null;
}

export async function actionCreateContract(formData: FormData) {
  const user = await requirePermission(MANAGE);
  await createContract({
    number: str(formData, "number"),
    name: str(formData, "name"),
    customerId: str(formData, "customerId") || null,
    programId: str(formData, "programId") || null,
    contractType: str(formData, "contractType") || "FFP",
    isPrime: str(formData, "isPrime") !== "0",
    primeContractor: str(formData, "primeContractor") || null,
    contractingOfficer: str(formData, "contractingOfficer") || null,
    dpasRating: str(formData, "dpasRating") || null,
    awardDate: date(formData, "awardDate"),
    startDate: date(formData, "startDate"),
    endDate: date(formData, "endDate"),
    ownerId: str(formData, "ownerId") || null,
    description: str(formData, "description") || null,
    userId: user.id,
  });
  revalidatePath("/contracts");
}

export async function actionAddClin(formData: FormData) {
  const user = await requirePermission(MANAGE);
  const contractId = str(formData, "contractId");
  await addClin({
    contractId,
    number: str(formData, "number"),
    description: str(formData, "description"),
    category: str(formData, "category") || "SUPPLY",
    clinType: str(formData, "clinType") || null,
    partId: str(formData, "partId") || null,
    quantity: num(formData, "quantity"),
    uom: str(formData, "uom") || "EA",
    unitPrice: num(formData, "unitPrice"),
    fundedValue: num(formData, "fundedValue"),
    isOption: str(formData, "isOption") === "1",
    isInformational: str(formData, "isInformational") === "1",
    parentId: str(formData, "parentId") || null,
    deliveryDate: date(formData, "deliveryDate"),
    userId: user.id,
  });
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/contracts");
}

export async function actionExerciseOption(formData: FormData) {
  const user = await requirePermission(MANAGE);
  await exerciseOption({ clinId: str(formData, "clinId"), userId: user.id });
  revalidatePath(`/contracts/${str(formData, "contractId")}`);
  revalidatePath("/contracts");
}

export async function actionAddMod(formData: FormData) {
  const user = await requirePermission(MANAGE);
  const contractId = str(formData, "contractId");
  await addMod({
    contractId,
    number: str(formData, "number"),
    description: str(formData, "description"),
    modType: str(formData, "modType") || "BILATERAL",
    valueDelta: num(formData, "valueDelta"),
    fundingDelta: num(formData, "fundingDelta"),
    newEndDate: date(formData, "newEndDate"),
    effectiveDate: date(formData, "effectiveDate"),
    userId: user.id,
  });
  revalidatePath(`/contracts/${contractId}`);
}

export async function actionExecuteMod(formData: FormData) {
  const user = await requirePermission(MANAGE);
  await executeMod({ modId: str(formData, "modId"), userId: user.id });
  revalidatePath(`/contracts/${str(formData, "contractId")}`);
}

export async function actionAddCdrl(formData: FormData) {
  const user = await requirePermission(MANAGE);
  const contractId = str(formData, "contractId");
  await addCdrl({
    contractId,
    number: str(formData, "number"),
    title: str(formData, "title"),
    clinId: str(formData, "clinId") || null,
    didNumber: str(formData, "didNumber") || null,
    frequency: str(formData, "frequency") || "ONE_TIME",
    approvalCode: str(formData, "approvalCode") || "A",
    reviewDays: num(formData, "reviewDays") || 30,
    firstDueDate: date(formData, "firstDueDate"),
    ownerId: str(formData, "ownerId") || null,
    userId: user.id,
  });
  revalidatePath(`/contracts/${contractId}`);
}

export async function actionSubmitCdrl(formData: FormData) {
  // Submitting a deliverable is ordinary programme work, not contract
  // administration, so it sits at view level rather than manage.
  const user = await requirePermission(VIEW);
  await submitCdrl({
    cdrlId: str(formData, "cdrlId"),
    documentName: str(formData, "documentName") || null,
    documentUrl: str(formData, "documentUrl") || null,
    userId: user.id,
  });
  revalidatePath(`/contracts/${str(formData, "contractId")}`);
}
