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
export async function releaseTestProcedure(params: {
  testProcedureId: string;
  userId?: string | null;
}) {
  const tp = await prisma.testProcedure.findUniqueOrThrow({
    where: { id: params.testProcedureId },
    include: { _count: { select: { steps: true } } },
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
  await logAudit({
    entityType: "TestProcedure",
    entityId: tp.id,
    action: "TP_RELEASED",
    userId: params.userId,
    metadata: { number: tp.number, revision: tp.revision },
  });
  return updated;
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
