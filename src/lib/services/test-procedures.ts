/**
 * Test Procedures — CM-controlled test documents (ATP, functional,
 * burn-in). Released procedures are locked and revision-controlled;
 * work-instruction steps and part functional-test requirements call
 * them out by reference.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function createTestProcedure(params: {
  title: string;
  category?: string;
  partId?: string | null;
  equipment?: string | null;
  purpose?: string | null;
  acceptanceCriteria?: string | null;
  steps?: {
    parameter: string;
    method?: string;
    spec?: string;
    minValue?: number | null;
    maxValue?: number | null;
    units?: string;
  }[];
  userId?: string | null;
}) {
  const count = await prisma.testProcedure.count();
  const number = `TP-${String(count + 1).padStart(5, "0")}`;
  const tp = await prisma.testProcedure.create({
    data: {
      number,
      title: params.title,
      category: [
        "FUNCTIONAL",
        "ATP",
        "BURN_IN",
        "ENVIRONMENTAL",
        "INSPECTION",
      ].includes(params.category || "")
        ? params.category!
        : "FUNCTIONAL",
      partId: params.partId || null,
      equipment: params.equipment || null,
      purpose: params.purpose || null,
      acceptanceCriteria: params.acceptanceCriteria || null,
      createdById: params.userId || null,
      steps: params.steps?.length
        ? {
            create: params.steps.map((s, i) => ({
              stepNumber: i + 1,
              parameter: s.parameter,
              method: s.method || null,
              spec: s.spec || null,
              minValue: s.minValue ?? null,
              maxValue: s.maxValue ?? null,
              units: s.units || null,
              sortOrder: i,
            })),
          }
        : undefined,
    },
  });
  await logAudit({
    entityType: "TestProcedure",
    entityId: tp.id,
    action: "TP_CREATED",
    userId: params.userId,
    metadata: { number, title: params.title },
  });
  return tp;
}

export async function addTestProcedureStep(params: {
  testProcedureId: string;
  parameter: string;
  method?: string;
  spec?: string;
  minValue?: number | null;
  maxValue?: number | null;
  units?: string;
}) {
  const tp = await prisma.testProcedure.findUniqueOrThrow({
    where: { id: params.testProcedureId },
  });
  if (tp.isLocked) throw new Error("Released procedure is locked — revise it");
  const n = await prisma.testProcedureStep.count({
    where: { testProcedureId: params.testProcedureId },
  });
  return prisma.testProcedureStep.create({
    data: {
      testProcedureId: params.testProcedureId,
      stepNumber: n + 1,
      parameter: params.parameter,
      method: params.method || null,
      spec: params.spec || null,
      minValue: params.minValue ?? null,
      maxValue: params.maxValue ?? null,
      units: params.units || null,
      sortOrder: n,
    },
  });
}

/** Release a test procedure (CM-controlled) — locks it. */
/** Submit a test procedure to the CM board for release review (like a WI). */
export async function submitTestProcedureToCm(params: {
  testProcedureId: string;
  userId?: string | null;
  notes?: string;
}) {
  const tp = await prisma.testProcedure.findUniqueOrThrow({
    where: { id: params.testProcedureId },
    include: { _count: { select: { steps: true } }, part: true },
  });
  if (tp.isLocked || tp.status === "RELEASED") throw new Error("Already released");
  if (tp._count.steps === 0) throw new Error("Add at least one test step before CM");

  const count = await prisma.changeRequest.count();
  const cr = await prisma.changeRequest.create({
    data: {
      number: `ECR-TP-${String(count + 1).padStart(4, "0")}`,
      title: `Release ${tp.number} Rev ${tp.revision}`,
      description:
        params.notes ||
        `Request CM release of test procedure ${tp.number} Rev ${tp.revision}: ${tp.title}`,
      type: "TEST_PROCEDURE",
      status: "REVIEW_BOARD",
      priority: "NORMAL",
      requestedById: params.userId || null,
      testProcedureId: tp.id,
      affectedParts: tp.partId ? JSON.stringify([tp.part?.partNumber || tp.partId]) : null,
      boardDate: new Date(),
    },
  });

  // Seat ENG + QUALITY reviewers if available (chair = requester or CM/ADMIN).
  const [eng, quality, chair] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ENGINEERING", isActive: true } }),
    prisma.user.findFirst({ where: { role: "QUALITY", isActive: true } }),
    params.userId
      ? Promise.resolve({ id: params.userId })
      : prisma.user.findFirst({ where: { role: { in: ["CM", "ADMIN"] }, isActive: true } }),
  ]);
  for (const [u, role] of [
    [chair, "CHAIR"],
    [eng, "ENGINEERING"],
    [quality, "QUALITY"],
  ] as const) {
    if (u) {
      const exists = await prisma.cmBoardMember.findFirst({
        where: { changeRequestId: cr.id, userId: u.id },
      });
      if (!exists) {
        await prisma.cmBoardMember.create({
          data: { changeRequestId: cr.id, userId: u.id, role },
        });
      }
    }
  }

  await prisma.testProcedure.update({
    where: { id: tp.id },
    data: { status: "CM_REVIEW" },
  });
  await logAudit({
    entityType: "TestProcedure",
    entityId: tp.id,
    action: "TP_SUBMITTED_TO_CM",
    userId: params.userId,
    metadata: { changeRequestId: cr.id },
  });
  return { testProcedure: tp, changeRequest: cr };
}

export async function releaseTestProcedure(params: {
  testProcedureId: string;
  userId?: string | null;
}) {
  const tp = await prisma.testProcedure.findUniqueOrThrow({
    where: { id: params.testProcedureId },
    include: { _count: { select: { steps: true } }, part: true },
  });
  if (tp.status === "RELEASED") throw new Error("Already released");
  if (tp._count.steps === 0) {
    throw new Error("Add at least one test step before releasing");
  }
  const updated = await prisma.testProcedure.update({
    where: { id: params.testProcedureId },
    data: {
      status: "RELEASED",
      isLocked: true,
      releasedAt: new Date(),
      releasedById: params.userId || null,
    },
  });

  // Close any open CRs for this procedure.
  await prisma.changeRequest.updateMany({
    where: {
      testProcedureId: tp.id,
      status: { in: ["REVIEW_BOARD", "SUBMITTED", "IMPACT_ANALYSIS", "APPROVED"] },
    },
    data: { status: "IMPLEMENTED", decidedAt: new Date(), releasedAt: new Date() },
  });

  // Retain a CM-controlled master copy (archives prior revisions' masters).
  try {
    await retainTestProcedureMaster({ testProcedureId: tp.id, userId: params.userId });
  } catch (e) {
    console.error("TP CM master retention failed:", e);
  }

  await logAudit({
    entityType: "TestProcedure",
    entityId: tp.id,
    action: "TP_RELEASED",
    userId: params.userId,
    metadata: { number: tp.number, revision: tp.revision },
  });
  return updated;
}

/** Retain a released test procedure as a CM-controlled master document. */
async function retainTestProcedureMaster(params: {
  testProcedureId: string;
  userId?: string | null;
}) {
  const tp = await prisma.testProcedure.findUniqueOrThrow({
    where: { id: params.testProcedureId },
    include: { part: { select: { partNumber: true } }, _count: { select: { steps: true } } },
  });
  const { ensureWorkInstructionsFolder } = await import("@/lib/services/cm-library");
  // Reuse a prior master's folder, else the WI/procedures folder under Admin.
  const priors = await prisma.cmDocument.findMany({
    where: { docType: "TP", number: tp.number, isArchived: false },
  });
  let folderId = priors.find((p) => p.folderId)?.folderId || null;
  if (!folderId) folderId = (await ensureWorkInstructionsFolder(params.userId || undefined)).id;

  for (const p of priors) {
    if (p.revision === tp.revision) continue;
    await prisma.cmDocument.update({
      where: { id: p.id },
      data: { isLocked: true, isArchived: true, status: "ARCHIVED", lockedAt: new Date() },
    });
  }

  const existing = priors.find((p) => p.revision === tp.revision);
  const data = {
    folderId,
    docType: "TP",
    number: tp.number,
    title: tp.title,
    revision: tp.revision,
    status: "RELEASED",
    description: `Test procedure master — ${tp._count.steps} step${
      tp._count.steps === 1 ? "" : "s"
    }${tp.part ? ` · part ${tp.part.partNumber}` : ""}. Controlled copy; edit via new revision only.`,
    fileUrl: `/test-procedures/${tp.id}`,
    fileName: `${tp.number} Rev ${tp.revision}`,
    productTag: tp.part?.partNumber || null,
    partId: tp.partId || null,
    isLocked: false,
    isArchived: false,
    createdById: params.userId || null,
  };
  if (existing) {
    await prisma.cmDocument.update({ where: { id: existing.id }, data });
  } else {
    await prisma.cmDocument.create({ data });
  }
}

export async function listTestProcedures() {
  return prisma.testProcedure.findMany({
    include: {
      part: { select: { partNumber: true } },
      _count: { select: { steps: true, wiSteps: true } },
    },
    orderBy: [{ number: "asc" }, { revision: "desc" }],
  });
}

export async function getTestProcedureDetail(id: string) {
  return prisma.testProcedure.findUnique({
    where: { id },
    include: {
      part: { select: { id: true, partNumber: true } },
      createdBy: { select: { name: true } },
      steps: { orderBy: { sortOrder: "asc" } },
      signOffs: {
        orderBy: { signedAt: "desc" },
        take: 60,
        include: { user: { select: { name: true } } },
      },
    },
  });
}

/**
 * Record a PIN-verified execution of one test-procedure step: captures a
 * measurement, auto-grades PASS/FAIL against the step's min/max when numeric,
 * and stores an optional photo. Mirrors the WI step sign-off.
 */
export async function recordTestStepSignOff(params: {
  testProcedureId: string;
  stepId: string;
  workOrderId?: string | null;
  unitSerial?: string | null;
  userId: string;
  measuredValue?: string | null;
  result?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  pinCode?: string | null;
}) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { pinCode: true },
  });
  const expectedPin = user.pinCode || "1234";
  if (!params.pinCode || params.pinCode.trim() !== expectedPin) {
    throw new Error("PIN verification failed");
  }

  const step = await prisma.testProcedureStep.findUniqueOrThrow({
    where: { id: params.stepId },
  });

  // Auto-grade against min/max when a numeric measurement is given.
  let result = (params.result || "").toUpperCase();
  const num = params.measuredValue != null ? Number(params.measuredValue) : NaN;
  if (!result && !Number.isNaN(num) && (step.minValue != null || step.maxValue != null)) {
    const okMin = step.minValue == null || num >= step.minValue;
    const okMax = step.maxValue == null || num <= step.maxValue;
    result = okMin && okMax ? "PASS" : "FAIL";
  }
  if (!result) result = "PASS";

  const signOff = await prisma.testProcedureSignOff.create({
    data: {
      testProcedureId: params.testProcedureId,
      stepId: params.stepId,
      workOrderId: params.workOrderId || null,
      unitSerial: params.unitSerial?.trim() || null,
      userId: params.userId,
      result,
      measuredValue: params.measuredValue?.toString().trim() || null,
      units: step.units || null,
      notes: params.notes?.trim() || null,
      photoUrl: params.photoUrl?.trim() || null,
      pinVerified: true,
    },
  });
  await logAudit({
    entityType: "TestProcedure",
    entityId: params.testProcedureId,
    action: `TEST_STEP_${result}`,
    userId: params.userId,
    metadata: {
      stepId: params.stepId,
      parameter: step.parameter,
      measuredValue: params.measuredValue,
      unitSerial: params.unitSerial,
    },
  });
  return signOff;
}
