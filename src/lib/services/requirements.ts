import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const REQ_CATEGORIES = [
  "SYSTEM",
  "FUNCTIONAL",
  "PERFORMANCE",
  "INTERFACE",
  "ENVIRONMENTAL",
  "SAFETY",
  "REGULATORY",
  "OTHER",
] as const;

export const REQ_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "VERIFIED",
  "WAIVED",
  "OBSOLETE",
] as const;

export const VERIFICATION_METHODS = [
  "TEST",
  "ANALYSIS",
  "INSPECTION",
  "DEMONSTRATION",
] as const;

async function nextReqNumber() {
  const rows = await prisma.requirement.findMany({
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (n > max) max = n;
  }
  return `REQ-${String(max + 1).padStart(5, "0")}`;
}

export async function createRequirement(params: {
  title: string;
  statement: string;
  rationale?: string | null;
  category?: string;
  priority?: string;
  verificationMethod?: string | null;
  source?: string | null;
  parentId?: string | null;
  productId?: string | null;
  projectId?: string | null;
  testProcedureId?: string | null;
  userId?: string;
}) {
  if (!params.title?.trim()) throw new Error("Requirement title required");
  if (!params.statement?.trim()) {
    throw new Error("Requirement statement (the 'shall') is required");
  }

  let productId = params.productId || null;
  let projectId = params.projectId || null;
  if (params.parentId) {
    const parent = await prisma.requirement.findUnique({
      where: { id: params.parentId },
    });
    if (!parent) throw new Error("Parent requirement not found");
    // Children inherit the parent's product/project unless set explicitly
    productId = productId || parent.productId;
    projectId = projectId || parent.projectId;
  }

  const number = await nextReqNumber();
  const req = await prisma.requirement.create({
    data: {
      number,
      title: params.title.trim(),
      statement: params.statement.trim(),
      rationale: params.rationale?.trim() || null,
      category:
        params.category && REQ_CATEGORIES.includes(params.category as never)
          ? params.category
          : "FUNCTIONAL",
      priority: params.priority || "NORMAL",
      verificationMethod: params.verificationMethod || null,
      source: params.source?.trim() || null,
      parentId: params.parentId || null,
      productId,
      projectId,
      testProcedureId: params.testProcedureId || null,
      createdById: params.userId || null,
    },
  });

  await logAudit({
    entityType: "Requirement",
    entityId: req.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number, title: req.title, parentId: req.parentId },
  });
  return req;
}

export async function updateRequirementStatus(params: {
  requirementId: string;
  status: string;
  verificationMethod?: string | null;
  testProcedureId?: string | null;
  userId?: string;
}) {
  const req = await prisma.requirement.findUnique({
    where: { id: params.requirementId },
  });
  if (!req) throw new Error("Requirement not found");
  if (!REQ_STATUSES.includes(params.status as never)) {
    throw new Error("Invalid status");
  }
  const verificationMethod =
    params.verificationMethod !== undefined
      ? params.verificationMethod
      : req.verificationMethod;
  if (params.status === "VERIFIED" && !verificationMethod) {
    throw new Error(
      "Set a verification method (test / analysis / inspection / demonstration) before marking verified"
    );
  }
  const updated = await prisma.requirement.update({
    where: { id: req.id },
    data: {
      status: params.status,
      verificationMethod,
      ...(params.testProcedureId !== undefined
        ? { testProcedureId: params.testProcedureId || null }
        : {}),
      verifiedAt:
        params.status === "VERIFIED" ? req.verifiedAt || new Date() : null,
    },
  });
  await logAudit({
    entityType: "Requirement",
    entityId: req.id,
    action: "STATUS_CHANGED",
    userId: params.userId,
    changes: { from: req.status, to: params.status, number: req.number },
  });
  return updated;
}

/** Trace a requirement to engineering work — a board task or a saga lane. */
export async function linkRequirementToWork(params: {
  requirementId: string;
  engTaskId?: string | null;
  sagaId?: string | null;
  note?: string | null;
  userId?: string;
}) {
  if (!params.engTaskId && !params.sagaId) {
    throw new Error("Pick a task or a saga to trace to");
  }
  const req = await prisma.requirement.findUnique({
    where: { id: params.requirementId },
  });
  if (!req) throw new Error("Requirement not found");

  const dup = await prisma.requirementTrace.findFirst({
    where: {
      requirementId: req.id,
      engTaskId: params.engTaskId || null,
      sagaId: params.sagaId || null,
    },
  });
  if (dup) return dup;

  const trace = await prisma.requirementTrace.create({
    data: {
      requirementId: req.id,
      engTaskId: params.engTaskId || null,
      sagaId: params.sagaId || null,
      note: params.note?.trim() || null,
      createdById: params.userId || null,
    },
    include: {
      engTask: { select: { number: true } },
      saga: { select: { number: true, name: true } },
    },
  });
  await logAudit({
    entityType: "Requirement",
    entityId: req.id,
    action: "TRACED_TO_WORK",
    userId: params.userId,
    metadata: {
      number: req.number,
      engTask: trace.engTask?.number || null,
      saga: trace.saga?.number || null,
    },
  });
  return trace;
}

export async function removeRequirementTrace(params: {
  traceId: string;
  userId?: string;
}) {
  const trace = await prisma.requirementTrace.findUnique({
    where: { id: params.traceId },
    include: { requirement: { select: { id: true, number: true } } },
  });
  if (!trace) return;
  await prisma.requirementTrace.delete({ where: { id: trace.id } });
  await logAudit({
    entityType: "Requirement",
    entityId: trace.requirement.id,
    action: "TRACE_REMOVED",
    userId: params.userId,
    metadata: { number: trace.requirement.number },
  });
}

/** Full board: requirements with children, traces (live work status), TP. */
export async function getRequirementsBoard(filter?: {
  productId?: string;
  status?: string;
}) {
  const where = {
    ...(filter?.productId ? { productId: filter.productId } : {}),
    ...(filter?.status ? { status: filter.status } : {}),
  };
  const reqs = await prisma.requirement.findMany({
    where,
    orderBy: [{ number: "asc" }],
    include: {
      product: { select: { id: true, code: true, name: true } },
      project: { select: { id: true, number: true, name: true } },
      testProcedure: {
        select: { id: true, number: true, revision: true, status: true },
      },
      parent: { select: { id: true, number: true } },
      traces: {
        include: {
          engTask: {
            select: { id: true, number: true, name: true, status: true },
          },
          saga: {
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              discipline: true,
            },
          },
        },
      },
    },
  });

  const active = reqs.filter(
    (r) => !["OBSOLETE", "WAIVED"].includes(r.status)
  );
  const covered = active.filter((r) => r.traces.length > 0);
  const verified = active.filter((r) => r.status === "VERIFIED");
  return {
    requirements: reqs,
    stats: {
      total: active.length,
      covered: coverage(covered.length, active.length),
      coveredCount: covered.length,
      verified: verified.length,
      uncovered: active.length - covered.length,
    },
  };
}

function coverage(n: number, of: number) {
  return of === 0 ? 0 : Math.round((n / of) * 100);
}
