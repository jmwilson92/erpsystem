"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  addActivity,
  completeActivity,
  convertLead,
  convertToCustomer,
  createContact,
  createLead,
  createOpportunity,
  setStage,
  updateLeadStatus,
  updateOpportunity,
  type Stage,
  STAGES,
} from "@/lib/services/crm";

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

// ── Leads ──────────────────────────────────────────────────────

export async function actionCreateLead(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  await createLead({
    company: str(fd, "company"),
    contactName: str(fd, "contactName") || null,
    email: str(fd, "email") || null,
    phone: str(fd, "phone") || null,
    source: str(fd, "source") || null,
    ownerId: str(fd, "ownerId") || user?.id || null,
    notes: str(fd, "notes") || null,
    userId: user?.id,
  });
  revalidatePath("/crm/leads");
  revalidatePath("/crm");
}

export async function actionUpdateLeadStatus(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return;
  await updateLeadStatus(id, status, user?.id);
  revalidatePath("/crm/leads");
}

export async function actionConvertLead(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const leadId = str(fd, "leadId");
  if (!leadId) return;
  const opp = await convertLead({
    leadId,
    value: num(fd, "value") ?? 0,
    expectedCloseAt: date(fd, "expectedCloseAt"),
    ownerId: str(fd, "ownerId") || user?.id || null,
    userId: user?.id,
  });
  revalidatePath("/crm/leads");
  revalidatePath("/crm");
  redirect(`/crm/${opp.id}`);
}

// ── Opportunities ──────────────────────────────────────────────

export async function actionCreateOpportunity(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const opp = await createOpportunity({
    name: str(fd, "name"),
    customerId: str(fd, "customerId") || null,
    stage: str(fd, "stage") || "PROSPECT",
    value: num(fd, "value") ?? 0,
    expectedCloseAt: date(fd, "expectedCloseAt"),
    ownerId: str(fd, "ownerId") || user?.id || null,
    source: str(fd, "source") || null,
    description: str(fd, "description") || null,
    userId: user?.id,
  });
  revalidatePath("/crm");
  redirect(`/crm/${opp.id}`);
}

export async function actionSetStage(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  const raw = str(fd, "stage");
  const stage = STAGES.find((s) => s === raw) as Stage | undefined;
  if (!id || !stage) return;
  await setStage({
    id,
    stage,
    probability: num(fd, "probability"),
    lostReason: str(fd, "lostReason") || null,
    userId: user?.id,
  });
  revalidatePath(`/crm/${id}`);
  revalidatePath("/crm");
}

export async function actionUpdateOpportunity(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = str(fd, "id");
  if (!id) return;
  await updateOpportunity(
    id,
    {
      name: str(fd, "name"),
      value: num(fd, "value") ?? 0,
      probability: num(fd, "probability") ?? 10,
      expectedCloseAt: date(fd, "expectedCloseAt"),
      ownerId: str(fd, "ownerId") || null,
      customerId: str(fd, "customerId") || null,
      source: str(fd, "source") || null,
      description: str(fd, "description") || null,
    },
    user?.id
  );
  revalidatePath(`/crm/${id}`);
  revalidatePath("/crm");
}

export async function actionConvertToCustomer(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const opportunityId = str(fd, "opportunityId");
  if (!opportunityId) return;
  await convertToCustomer({
    opportunityId,
    paymentTerms: str(fd, "paymentTerms") || "NET30",
    creditLimit: num(fd, "creditLimit") ?? 0,
    userId: user?.id,
  });
  revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/customers");
}

// ── Activities ─────────────────────────────────────────────────

export async function actionAddActivity(fd: FormData): Promise<void> {
  const user = await getCurrentUser();
  const opportunityId = str(fd, "opportunityId") || null;
  await addActivity({
    opportunityId,
    contactId: str(fd, "contactId") || null,
    type: str(fd, "type") || "NOTE",
    subject: str(fd, "subject"),
    body: str(fd, "body") || null,
    dueAt: date(fd, "dueAt"),
    userId: user?.id,
  });
  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/crm");
}

export async function actionCompleteActivity(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  await completeActivity(id);
  revalidatePath(`/crm/${str(fd, "opportunityId")}`);
  revalidatePath("/crm");
}

// ── Contacts ───────────────────────────────────────────────────

export async function actionCreateContact(fd: FormData): Promise<void> {
  await createContact({
    customerId: str(fd, "customerId") || null,
    name: str(fd, "name"),
    title: str(fd, "title") || null,
    email: str(fd, "email") || null,
    phone: str(fd, "phone") || null,
    isPrimary: str(fd, "isPrimary") === "yes",
    notes: str(fd, "notes") || null,
  });
  revalidatePath("/crm/contacts");
}
