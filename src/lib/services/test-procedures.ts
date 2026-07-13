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
