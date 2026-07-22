import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Recruiting (ATS) + new-hire onboarding + background checks.
 *
 * Pipeline: JobRequisition → Candidate (APPLIED→…→HIRED) → EmployeeOnboarding
 * (personal info, IDs/documents checklist, background checks) → provisioned
 * user account.
 */

export const CANDIDATE_STAGES = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type ChecklistItem = {
  key: string;
  label: string;
  category: string;
  done: boolean;
  docUrl?: string | null;
  docName?: string | null;
  completedAt?: string | null;
};

/** Default new-hire checklist — the "collect info, IDs and documents" set. */
export const DEFAULT_ONBOARDING_CHECKLIST: Omit<ChecklistItem, "done">[] = [
  { key: "offer_letter", label: "Signed offer letter", category: "Documents" },
  { key: "i9", label: "Form I-9 — employment eligibility", category: "Documents" },
  { key: "w4", label: "Form W-4 — federal withholding", category: "Documents" },
  { key: "state_tax", label: "State tax withholding form", category: "Documents" },
  { key: "direct_deposit", label: "Direct deposit authorization", category: "Documents" },
  { key: "id_gov", label: "Government photo ID (verified)", category: "Identification" },
  { key: "ssn", label: "Social Security card / number", category: "Identification" },
  { key: "work_auth", label: "Work authorization / visa (if applicable)", category: "Identification" },
  { key: "emergency_contact", label: "Emergency contact on file", category: "Personal" },
  { key: "background_check", label: "Background check cleared", category: "Screening" },
  { key: "handbook", label: "Employee handbook acknowledged", category: "Policies" },
  { key: "confidentiality", label: "Confidentiality / IP agreement signed", category: "Policies" },
  { key: "it_setup", label: "IT accounts & equipment issued", category: "Setup" },
  { key: "workspace", label: "Workspace / badge assigned", category: "Setup" },
];

function freshChecklist(): ChecklistItem[] {
  return DEFAULT_ONBOARDING_CHECKLIST.map((i) => ({
    ...i,
    done: false,
    docUrl: null,
    docName: null,
    completedAt: null,
  }));
}

async function nextNumber(prefix: string, count: number) {
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

// ─── Requisitions ───────────────────────────────────────────────

export async function createRequisition(params: {
  title: string;
  department?: string;
  location?: string;
  employmentType?: string;
  openings?: number;
  description?: string;
  payRangeMin?: number;
  payRangeMax?: number;
  hiringManagerId?: string;
  recruiterId?: string;
  userId?: string;
}) {
  if (!params.title?.trim()) throw new Error("Job title is required");
  const count = await prisma.jobRequisition.count();
  const req = await prisma.jobRequisition.create({
    data: {
      number: await nextNumber("REQ", count),
      title: params.title.trim(),
      department: params.department?.trim() || null,
      location: params.location?.trim() || null,
      employmentType: params.employmentType || "FULL_TIME",
      openings: params.openings && params.openings > 0 ? params.openings : 1,
      description: params.description?.trim() || null,
      payRangeMin: params.payRangeMin ?? null,
      payRangeMax: params.payRangeMax ?? null,
      hiringManagerId: params.hiringManagerId || null,
      recruiterId: params.recruiterId || null,
      createdById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "JobRequisition",
    entityId: req.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: req.number, title: req.title },
  });
  return req;
}

export async function updateRequisitionStatus(params: {
  requisitionId: string;
  status: string;
  userId?: string;
}) {
  return prisma.jobRequisition.update({
    where: { id: params.requisitionId },
    data: { status: params.status },
  });
}

// ─── Candidates ─────────────────────────────────────────────────

export async function addCandidate(params: {
  requisitionId?: string;
  name: string;
  email?: string;
  phone?: string;
  source?: string;
  resumeUrl?: string;
  resumeName?: string;
  recruiterId?: string;
  notes?: string;
  userId?: string;
}) {
  if (!params.name?.trim()) throw new Error("Candidate name is required");
  const c = await prisma.candidate.create({
    data: {
      requisitionId: params.requisitionId || null,
      name: params.name.trim(),
      email: params.email?.trim() || null,
      phone: params.phone?.trim() || null,
      source: params.source?.trim() || null,
      resumeUrl: params.resumeUrl?.trim() || null,
      resumeName: params.resumeName?.trim() || null,
      recruiterId: params.recruiterId || null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Candidate",
    entityId: c.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { name: c.name },
  });
  return c;
}

export async function moveCandidateStage(params: {
  candidateId: string;
  stage: string;
  rejectedReason?: string;
  userId?: string;
}) {
  if (!CANDIDATE_STAGES.includes(params.stage as never)) {
    throw new Error(`Unknown stage: ${params.stage}`);
  }
  const candidate = await prisma.candidate.findUnique({
    where: { id: params.candidateId },
    include: { onboarding: true, requisition: true },
  });
  if (!candidate) throw new Error("Candidate not found");

  const updated = await prisma.candidate.update({
    where: { id: candidate.id },
    data: {
      stage: params.stage,
      rejectedReason:
        params.stage === "REJECTED" ? params.rejectedReason || null : null,
    },
  });

  // Moving to HIRED spins up an onboarding record (once).
  let onboardingId = candidate.onboarding?.id ?? null;
  if (params.stage === "HIRED" && !candidate.onboarding) {
    const onb = await createOnboarding({
      candidateId: candidate.id,
      legalName: candidate.name,
      personalEmail: candidate.email || undefined,
      phone: candidate.phone || undefined,
      jobTitle: candidate.requisition?.title,
      department: candidate.requisition?.department || undefined,
      employmentType: candidate.requisition?.employmentType,
      userId: params.userId,
    });
    onboardingId = onb.id;
  }

  await logAudit({
    entityType: "Candidate",
    entityId: candidate.id,
    action: "STAGE_CHANGED",
    userId: params.userId,
    metadata: { from: candidate.stage, to: params.stage },
  });
  return { candidate: updated, onboardingId };
}

// ─── Onboarding ─────────────────────────────────────────────────

export async function createOnboarding(params: {
  candidateId?: string;
  legalName: string;
  preferredName?: string;
  personalEmail?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  managerId?: string;
  employmentType?: string;
  startDate?: Date;
  userId?: string;
}) {
  if (!params.legalName?.trim()) throw new Error("Legal name is required");
  const count = await prisma.employeeOnboarding.count();
  const onb = await prisma.employeeOnboarding.create({
    data: {
      number: await nextNumber("ONB", count),
      candidateId: params.candidateId || null,
      legalName: params.legalName.trim(),
      preferredName: params.preferredName?.trim() || null,
      personalEmail: params.personalEmail?.trim() || null,
      phone: params.phone?.trim() || null,
      jobTitle: params.jobTitle?.trim() || null,
      department: params.department?.trim() || null,
      managerId: params.managerId || null,
      employmentType: params.employmentType || "FULL_TIME",
      startDate: params.startDate || null,
      status: "IN_PROGRESS",
      checklist: JSON.stringify(freshChecklist()),
      createdById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "EmployeeOnboarding",
    entityId: onb.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: onb.number, name: onb.legalName },
  });
  return onb;
}

export async function updateOnboarding(params: {
  onboardingId: string;
  data: Record<string, unknown>;
  userId?: string;
}) {
  return prisma.employeeOnboarding.update({
    where: { id: params.onboardingId },
    data: params.data,
  });
}

/** Toggle / attach a document to one checklist item. */
export async function setChecklistItem(params: {
  onboardingId: string;
  key: string;
  done?: boolean;
  docUrl?: string | null;
  docName?: string | null;
  userId?: string;
}) {
  const onb = await prisma.employeeOnboarding.findUnique({
    where: { id: params.onboardingId },
  });
  if (!onb) throw new Error("Onboarding not found");
  let items: ChecklistItem[] = [];
  try {
    items = onb.checklist ? (JSON.parse(onb.checklist) as ChecklistItem[]) : [];
  } catch {
    items = freshChecklist();
  }
  const item = items.find((i) => i.key === params.key);
  if (!item) throw new Error("Checklist item not found");
  if (params.done !== undefined) {
    item.done = params.done;
    item.completedAt = params.done ? new Date().toISOString() : null;
  }
  if (params.docUrl !== undefined) item.docUrl = params.docUrl;
  if (params.docName !== undefined) item.docName = params.docName;

  await prisma.employeeOnboarding.update({
    where: { id: onb.id },
    data: { checklist: JSON.stringify(items) },
  });
  return items;
}

export async function completeOnboarding(params: {
  onboardingId: string;
  userId?: string;
}) {
  const onb = await prisma.employeeOnboarding.findUnique({
    where: { id: params.onboardingId },
  });
  if (!onb) throw new Error("Onboarding not found");
  let items: ChecklistItem[] = [];
  try {
    items = onb.checklist ? (JSON.parse(onb.checklist) as ChecklistItem[]) : [];
  } catch {
    items = [];
  }
  const open = items.filter((i) => !i.done);
  if (open.length > 0) {
    throw new Error(
      `${open.length} checklist item(s) still open — finish them before completing onboarding`
    );
  }
  await logAudit({
    entityType: "EmployeeOnboarding",
    entityId: onb.id,
    action: "COMPLETED",
    userId: params.userId,
  });
  return prisma.employeeOnboarding.update({
    where: { id: onb.id },
    data: { status: "COMPLETE" },
  });
}

// ─── Background checks ───────────────────────────────────────────

export async function recordBackgroundCheck(params: {
  candidateId?: string;
  onboardingId?: string;
  checkType?: string;
  provider?: string;
  status?: string;
  result?: string;
  documentUrl?: string;
  documentName?: string;
  notes?: string;
  userId?: string;
}) {
  if (!params.candidateId && !params.onboardingId) {
    throw new Error("A background check needs a candidate or onboarding record");
  }
  const status = params.status || "INITIATED";
  const bc = await prisma.backgroundCheck.create({
    data: {
      candidateId: params.candidateId || null,
      onboardingId: params.onboardingId || null,
      checkType: params.checkType || "STANDARD",
      provider: params.provider?.trim() || null,
      status,
      result: params.result?.trim() || null,
      requestedAt: new Date(),
      completedAt: ["CLEAR", "FLAGGED"].includes(status) ? new Date() : null,
      documentUrl: params.documentUrl?.trim() || null,
      documentName: params.documentName?.trim() || null,
      notes: params.notes?.trim() || null,
      requestedById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "BackgroundCheck",
    entityId: bc.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { type: bc.checkType, status: bc.status },
  });
  return bc;
}

export async function updateBackgroundCheck(params: {
  id: string;
  status?: string;
  result?: string;
  provider?: string;
  documentUrl?: string;
  documentName?: string;
  notes?: string;
  userId?: string;
}) {
  const completed =
    params.status && ["CLEAR", "FLAGGED"].includes(params.status);
  return prisma.backgroundCheck.update({
    where: { id: params.id },
    data: {
      status: params.status ?? undefined,
      result: params.result ?? undefined,
      provider: params.provider ?? undefined,
      documentUrl: params.documentUrl ?? undefined,
      documentName: params.documentName ?? undefined,
      notes: params.notes ?? undefined,
      completedAt: completed ? new Date() : undefined,
    },
  });
}
