"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import {
  addUnit,
  approveDeviation,
  closeDeviation,
  consume,
  createDeviation,
  recordCustomerApproval,
  rejectDeviation,
  removeUnit,
  submitDeviation,
} from "@/lib/services/deviations";

/**
 * Requesting a departure is mapped onto the NCR-author permission and
 * approving it onto the MRB disposition authority. That matches who actually
 * does each job, and avoids minting new permission codes that would be absent
 * from existing tenants' permission tables until seeded.
 */
const REQUEST = "quality.ncr.create";
const APPROVE = "mrb.disposition";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

function num(fd: FormData, key: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function date(fd: FormData, key: string): Date | null {
  const raw = str(fd, key);
  return raw ? new Date(raw) : null;
}

/** Validation failures are ordinary user error, so they come back as text. */
async function withMessage(returnTo: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }
}

export async function actionCreateDeviation(fd: FormData) {
  const user = await requirePermission(REQUEST);
  let createdId = "";
  await withMessage("/deviations", async () => {
    const created = await createDeviation({
      kind: str(fd, "kind") || "DEVIATION",
      title: str(fd, "title"),
      requirement: str(fd, "requirement"),
      description: str(fd, "description"),
      justification: str(fd, "justification"),
      partId: str(fd, "partId") || null,
      contractId: str(fd, "contractId") || null,
      nonConformanceId: str(fd, "nonConformanceId") || null,
      quantityLimit: num(fd, "quantityLimit"),
      effectiveFrom: date(fd, "effectiveFrom"),
      effectiveTo: date(fd, "effectiveTo"),
      customerApprovalRequired: str(fd, "customerApprovalRequired") === "1",
      requestedById: user.id,
    });
    createdId = created.id;
  });
  revalidatePath("/deviations");
  redirect(`/deviations/${createdId}`);
}

export async function actionSubmit(fd: FormData) {
  const user = await requirePermission(REQUEST);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () => submitDeviation(id, user.id));
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionApprove(fd: FormData) {
  const user = await requirePermission(APPROVE);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () => approveDeviation(id, user.id));
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionReject(fd: FormData) {
  const user = await requirePermission(APPROVE);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () =>
    rejectDeviation(id, str(fd, "reason"), user.id)
  );
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionCustomerApproval(fd: FormData) {
  const user = await requirePermission(APPROVE);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () =>
    recordCustomerApproval(id, str(fd, "customerReference"), user.id)
  );
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionClose(fd: FormData) {
  const user = await requirePermission(APPROVE);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () => closeDeviation(id, user.id));
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionAddUnit(fd: FormData) {
  await requirePermission(REQUEST);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () =>
    addUnit(id, {
      serial: str(fd, "serial"),
      lotNumber: str(fd, "lotNumber"),
      note: str(fd, "note"),
    })
  );
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionRemoveUnit(fd: FormData) {
  await requirePermission(REQUEST);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () => removeUnit(str(fd, "unitId")));
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}

export async function actionConsume(fd: FormData) {
  const user = await requirePermission(REQUEST);
  const id = str(fd, "id");
  await withMessage(`/deviations/${id}`, () =>
    consume(id, num(fd, "qty") ?? 1, user.id)
  );
  revalidatePath(`/deviations/${id}`);
  redirect(`/deviations/${id}`);
}
