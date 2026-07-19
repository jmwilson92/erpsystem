import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getAvailableQty } from "@/lib/services/order-fulfillment";
import { startPrApprovalWorkflow } from "@/lib/services/pr-approval";

export type WiStepType = "BUILD" | "QA" | "TEST";

export type WiToolInput = {
  name: string;
  partId?: string | null;
  qty?: number;
  notes?: string | null;
};

export type WiStepInput = {
  stepNumber?: number;
  title: string;
  instructions: string;
  /** BUILD | QA | TEST */
  stepType?: WiStepType | string;
  isTestStep?: boolean;
  passFailRequired?: boolean;
  testCriteria?: string;
  expectedValue?: string;
  minValue?: number | null;
  maxValue?: number | null;
  measureUom?: string | null;
  measureUomUnitId?: string | null;
  cureTimeMinutes?: number | null;
  requiredArea?: string | null;
  workCenter?: string | null;
  routeLock?: boolean;
  estimatedMinutes?: number | null;
  attachmentUrls?: string[]; // photos
  mediaUrls?: string[]; // recordings
  drawingLinks?: string[];
  requiresSignOff?: boolean;
  /** Optional linked CM test procedure (ATP / functional) */
  testProcedureId?: string | null;
};

function jsonArr(v?: string[] | null) {
  if (!v?.length) return null;
  return JSON.stringify(v);
}

function normalizeStepType(st: WiStepInput): WiStepType {
  const raw = (st.stepType || "").toUpperCase();
  if (raw === "QA" || raw === "TEST" || raw === "BUILD") return raw;
  if (st.isTestStep) return "TEST";
  return "BUILD";
}

function stepCreateData(st: WiStepInput, i: number) {
  const stepType = normalizeStepType(st);
  const isTestStep = stepType === "TEST" || !!st.isTestStep;
  // Default area from step type when not specified
  let requiredArea = st.requiredArea || null;
  if (!requiredArea) {
    if (stepType === "QA") requiredArea = "QA";
    else if (stepType === "TEST") requiredArea = "TEST";
    else requiredArea = "MANUFACTURING";
  }
  return {
    stepNumber: st.stepNumber ?? i + 1,
    title: st.title.trim(),
    instructions: st.instructions.trim(),
    stepType,
    isTestStep,
    passFailRequired:
      st.passFailRequired ?? (stepType === "QA" || stepType === "TEST"),
    testCriteria: st.testCriteria || null,
    expectedValue: st.expectedValue || null,
    minValue: st.minValue ?? null,
    maxValue: st.maxValue ?? null,
    measureUom: st.measureUom || null,
    measureUomUnitId: st.measureUomUnitId || null,
    cureTimeMinutes: st.cureTimeMinutes ?? null,
    requiredArea,
    workCenter: st.workCenter || null,
    routeLock: st.routeLock ?? false,
    estimatedMinutes: st.estimatedMinutes ?? null,
    attachmentUrls: jsonArr(st.attachmentUrls),
    mediaUrls: jsonArr(st.mediaUrls),
    drawingLinks: jsonArr(st.drawingLinks),
    requiresSignOff: st.requiresSignOff ?? true,
    sortOrder: st.stepNumber ?? i + 1,
    testProcedureId: st.testProcedureId || null,
  };
}

/**
 * If WI tools are item-linked and not in stock, open a PR so purchasing can obtain them.
 * PR justification / triggerSource show WI + tool purpose.
 */
export async function createToolPurchaseRequestForWi(params: {
  workInstructionId: string;
  documentNumber: string;
  revision: string;
  title: string;
  tools: WiToolInput[];
  userId?: string;
}): Promise<{ prId: string; prNumber: string } | null> {
  const shortages: {
    partId: string;
    partNumber: string;
    description: string;
    qty: number;
    unitCost: number;
    uom: string;
    toolName: string;
  }[] = [];

  for (const tool of params.tools) {
    if (!tool.partId) continue;
    const part = await prisma.part.findUnique({ where: { id: tool.partId } });
    if (!part) continue;
    const need = Math.max(1, tool.qty || 1);
    const onHand = await getAvailableQty(part.id);
    const short = Math.max(0, need - onHand);
    if (short <= 0) continue;
    shortages.push({
      partId: part.id,
      partNumber: part.partNumber,
      description: part.description,
      qty: short,
      unitCost: part.standardCost || part.lastBuyCost || 0,
      uom: part.uom || "EA",
      toolName: tool.name || part.partNumber,
    });
  }

  if (!shortages.length) return null;

  const preferred = await prisma.supplier.findFirst({
    where: {
      isApprovedVendor: true,
      status: { in: ["APPROVED", "CONDITIONAL"] },
    },
    orderBy: { overallScore: "desc" },
  });

  const prCount = await prisma.purchaseRequest.count();
  const number = `PR-${String(prCount + 1).padStart(5, "0")}`;
  const totalEstimate = shortages.reduce(
    (s, r) => s + r.qty * r.unitCost,
    0
  );

  const justification = [
    `WI TOOLING — auto-created when work instruction was authored.`,
    `Work instruction: ${params.documentNumber} Rev ${params.revision} — ${params.title}`,
    `Trigger: required tools not in stock at WI create.`,
    `Tools needed:`,
    ...shortages.map(
      (s) =>
        `• ${s.toolName} (${s.partNumber}) × ${s.qty} — needed for WI ${params.documentNumber}`
    ),
  ].join("\n");

  const pr = await prisma.purchaseRequest.create({
    data: {
      number,
      status: "SUBMITTED",
      requestedById: params.userId,
      department: "Engineering",
      neededBy: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      justification,
      totalEstimate,
      supplierId: preferred?.id,
      workInstructionId: params.workInstructionId,
      triggerSource: "WI_TOOL",
      lines: {
        create: shortages.map((s) => ({
          partId: s.partId,
          description: `TOOL: ${s.toolName} — ${s.description}`,
          quantity: s.qty,
          estimatedUnitCost: s.unitCost,
          uom: s.uom,
          notes: `Required for WI ${params.documentNumber} Rev ${params.revision} (${params.title})`,
        })),
      },
    },
  });

  await startPrApprovalWorkflow({
    purchaseRequestId: pr.id,
    userId: params.userId,
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "CREATED_FROM_WI_TOOL",
    userId: params.userId,
    metadata: {
      number,
      workInstructionId: params.workInstructionId,
      tools: shortages.map((s) => s.partNumber),
    },
  });

  return { prId: pr.id, prNumber: pr.number };
}

export async function createWorkInstruction(params: {
  documentNumber: string;
  revision?: string;
  title: string;
  partId?: string | null;
  bomHeaderId?: string | null;
  workCenter?: string | null;
  notes?: string | null;
  hazmatRequired?: string | null;
  drawingNumber?: string | null;
  drawingReferences?: string | null;
  requiredTools?: WiToolInput[];
  steps?: WiStepInput[];
  userId?: string;
}) {
  const documentNumber = params.documentNumber.trim().toUpperCase();
  const revision = (params.revision || "A").trim().toUpperCase();
  if (!documentNumber) throw new Error("Document number required");
  if (!params.title.trim()) throw new Error("Title required");

  const existing = await prisma.workInstruction.findUnique({
    where: { documentNumber_revision: { documentNumber, revision } },
  });
  if (existing) throw new Error(`${documentNumber} Rev ${revision} already exists`);

  let bomRevision: string | null = null;
  if (params.bomHeaderId) {
    const bom = await prisma.bomHeader.findUnique({
      where: { id: params.bomHeaderId },
    });
    if (bom) bomRevision = bom.revision;
  }

  const tools = (params.requiredTools || []).filter((t) => t.name?.trim());
  const steps = params.steps || [];
  const wi = await prisma.workInstruction.create({
    data: {
      documentNumber,
      revision,
      title: params.title.trim(),
      status: "DRAFT",
      partId: params.partId || null,
      bomHeaderId: params.bomHeaderId || null,
      bomRevision,
      workCenter: params.workCenter || null,
      notes: params.notes || null,
      hazmatRequired: params.hazmatRequired?.trim() || null,
      drawingNumber: params.drawingNumber?.trim() || null,
      drawingReferences: params.drawingReferences?.trim() || null,
      requiredTools: tools.length
        ? JSON.stringify(
            tools.map((t) => ({
              name: t.name.trim(),
              partId: t.partId || null,
              qty: t.qty ?? 1,
              notes: t.notes || null,
            }))
          )
        : null,
      createdById: params.userId,
      isLocked: false,
      estimatedMinutes: steps.reduce(
        (s, st) => s + (st.estimatedMinutes || 0),
        0
      ) || null,
      steps: {
        create: steps.map((st, i) => stepCreateData(st, i)),
      },
    },
    include: { steps: true, part: true },
  });

  // Auto-PR for tools not in stock (item-linked tools only)
  let toolPr: { prId: string; prNumber: string } | null = null;
  try {
    toolPr = await createToolPurchaseRequestForWi({
      workInstructionId: wi.id,
      documentNumber: wi.documentNumber,
      revision: wi.revision,
      title: wi.title,
      tools,
      userId: params.userId,
    });
  } catch (e) {
    console.error("WI tool PR create failed:", e);
  }

  await logAudit({
    entityType: "WorkInstruction",
    entityId: wi.id,
    action: "CREATED",
    userId: params.userId,
    metadata: {
      documentNumber,
      revision,
      toolPr: toolPr?.prNumber,
    },
  });
  return { ...wi, toolPr };
}

export async function addWorkInstructionStep(
  wiId: string,
  step: WiStepInput,
  userId?: string
) {
  const wi = await prisma.workInstruction.findUnique({
    where: { id: wiId },
    include: { steps: true },
  });
  if (!wi) throw new Error("Work instruction not found");
  if (wi.isLocked || wi.status === "RELEASED" || wi.status === "OBSOLETE") {
    throw new Error("Released WIs are locked — create a new revision to edit");
  }
  if (wi.status === "CM_REVIEW") {
    throw new Error("WI is in CM review — withdraw to DRAFT to edit");
  }

  const stepNumber =
    step.stepNumber ??
    (wi.steps.reduce((m, s) => Math.max(m, s.stepNumber), 0) + 1);

  const data = stepCreateData({ ...step, stepNumber }, stepNumber - 1);
  const created = await prisma.workInstructionStep.create({
    data: {
      workInstructionId: wiId,
      ...data,
    },
  });

  await logAudit({
    entityType: "WorkInstruction",
    entityId: wiId,
    action: "STEP_ADDED",
    userId,
    metadata: { stepNumber, stepType: data.stepType },
  });
  return created;
}

/** Submit WI to CM board for release approval. */
export async function submitWiToCm(params: {
  workInstructionId: string;
  userId?: string;
  notes?: string;
}) {
  const wi = await prisma.workInstruction.findUnique({
    where: { id: params.workInstructionId },
    include: { steps: true, part: true },
  });
  if (!wi) throw new Error("Work instruction not found");
  if (wi.isLocked || wi.status === "RELEASED") {
    throw new Error("Already released");
  }
  if (wi.steps.length === 0) throw new Error("Add at least one step before CM");

  const count = await prisma.changeRequest.count();
  const cr = await prisma.changeRequest.create({
    data: {
      number: `ECR-WI-${String(count + 1).padStart(4, "0")}`,
      title: `Release ${wi.documentNumber} Rev ${wi.revision}`,
      description:
        params.notes ||
        `Request CM release of work instruction ${wi.documentNumber} Rev ${wi.revision}: ${wi.title}`,
      type: "WORK_INSTRUCTION",
      status: "REVIEW_BOARD",
      priority: "NORMAL",
      requestedById: params.userId,
      workInstructionId: wi.id,
      affectedParts: wi.partId
        ? JSON.stringify([wi.part?.partNumber || wi.partId])
        : null,
      boardDate: new Date(),
      boardMembers: {
        create: [
          { userId: params.userId || "", role: "CHAIR" },
        ].filter((m) => m.userId),
      },
    },
  });

  // Ensure board members from CM/QUALITY/ENG if chair missing
  if (!params.userId) {
    const chair = await prisma.user.findFirst({
      where: { role: { in: ["CM", "ADMIN"] }, isActive: true },
    });
    if (chair) {
      await prisma.cmBoardMember.create({
        data: {
          changeRequestId: cr.id,
          userId: chair.id,
          role: "CHAIR",
        },
      });
    }
  }

  const eng = await prisma.user.findFirst({
    where: { role: "ENGINEERING", isActive: true },
  });
  const quality = await prisma.user.findFirst({
    where: { role: "QUALITY", isActive: true },
  });
  for (const [user, role] of [
    [eng, "ENGINEERING"],
    [quality, "QUALITY"],
  ] as const) {
    if (user) {
      const exists = await prisma.cmBoardMember.findFirst({
        where: { changeRequestId: cr.id, userId: user.id },
      });
      if (!exists) {
        await prisma.cmBoardMember.create({
          data: {
            changeRequestId: cr.id,
            userId: user.id,
            role,
          },
        });
      }
    }
  }

  await prisma.workInstruction.update({
    where: { id: wi.id },
    data: { status: "CM_REVIEW" },
  });

  await logAudit({
    entityType: "WorkInstruction",
    entityId: wi.id,
    action: "SUBMITTED_TO_CM",
    userId: params.userId,
    metadata: { changeRequestId: cr.id },
  });

  return { wi, changeRequest: cr };
}

/** CM releases WI — locks it and optionally links BOM. */
export async function releaseWorkInstructionFromCm(params: {
  workInstructionId: string;
  bomHeaderId?: string | null;
  userId?: string;
  decisionNotes?: string;
}) {
  const wi = await prisma.workInstruction.findUnique({
    where: { id: params.workInstructionId },
  });
  if (!wi) throw new Error("Work instruction not found");

  let bomRevision = wi.bomRevision;
  const bomHeaderId = params.bomHeaderId ?? wi.bomHeaderId;
  if (bomHeaderId) {
    const bom = await prisma.bomHeader.findUnique({ where: { id: bomHeaderId } });
    if (bom) bomRevision = bom.revision;
  }

  const released = await prisma.workInstruction.update({
    where: { id: wi.id },
    data: {
      status: "RELEASED",
      isLocked: true,
      releasedAt: new Date(),
      releasedById: params.userId,
      bomHeaderId: bomHeaderId || null,
      bomRevision,
    },
  });

  // Close related open CRs
  await prisma.changeRequest.updateMany({
    where: {
      workInstructionId: wi.id,
      status: { in: ["REVIEW_BOARD", "SUBMITTED", "IMPACT_ANALYSIS"] },
    },
    data: {
      status: "APPROVED",
      decidedAt: new Date(),
      decisionNotes: params.decisionNotes || "Released from CM",
    },
  });

  // Retain a CM-controlled master copy (archives prior revisions' masters).
  // Never let CM retention failure block the release itself.
  try {
    const { retainWorkInstructionMaster } = await import(
      "@/lib/services/cm-library"
    );
    await retainWorkInstructionMaster({
      workInstructionId: wi.id,
      userId: params.userId,
    });
  } catch (e) {
    console.error("WI CM master retention failed:", e);
  }

  await logAudit({
    entityType: "WorkInstruction",
    entityId: wi.id,
    action: "RELEASED",
    userId: params.userId,
    metadata: { bomHeaderId, locked: true },
  });

  return released;
}

/** Create editable next revision from a released WI (original stays locked). */
export async function createWiRevisionFromReleased(params: {
  workInstructionId: string;
  userId?: string;
}) {
  const src = await prisma.workInstruction.findUnique({
    where: { id: params.workInstructionId },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
  if (!src) throw new Error("Work instruction not found");
  if (src.status !== "RELEASED" && !src.isLocked) {
    throw new Error("Only released/locked WIs use the Update → new revision path");
  }

  // Next revision letter
  let nextRev = "B";
  if (/^[A-Z]$/i.test(src.revision)) {
    nextRev = String.fromCharCode(src.revision.toUpperCase().charCodeAt(0) + 1);
  } else {
    nextRev = `${src.revision}.1`;
  }

  // Ensure unique
  let attempt = nextRev;
  let n = 0;
  while (
    await prisma.workInstruction.findUnique({
      where: {
        documentNumber_revision: {
          documentNumber: src.documentNumber,
          revision: attempt,
        },
      },
    })
  ) {
    n++;
    attempt = `${nextRev}${n}`;
  }

  const copy = await prisma.workInstruction.create({
    data: {
      documentNumber: src.documentNumber,
      revision: attempt,
      title: src.title,
      status: "DRAFT",
      partId: src.partId,
      bomHeaderId: src.bomHeaderId,
      bomRevision: src.bomRevision,
      workCenter: src.workCenter,
      hazmatRequired: src.hazmatRequired,
      drawingNumber: src.drawingNumber,
      drawingReferences: src.drawingReferences,
      requiredTools: src.requiredTools,
      notes: `In development revision from Rev ${src.revision}`,
      createdById: params.userId,
      isLocked: false,
      supersedesId: src.id,
      estimatedMinutes: src.estimatedMinutes,
      steps: {
        create: src.steps.map((st) => ({
          stepNumber: st.stepNumber,
          title: st.title,
          instructions: st.instructions,
          stepType: st.stepType || (st.isTestStep ? "TEST" : "BUILD"),
          isTestStep: st.isTestStep,
          passFailRequired: st.passFailRequired,
          testCriteria: st.testCriteria,
          expectedValue: st.expectedValue,
          minValue: st.minValue,
          maxValue: st.maxValue,
          measureUom: st.measureUom,
          measureUomUnitId: st.measureUomUnitId,
          cureTimeMinutes: st.cureTimeMinutes,
          requiredArea: st.requiredArea,
          workCenter: st.workCenter,
          routeLock: st.routeLock,
          estimatedMinutes: st.estimatedMinutes,
          attachmentUrls: st.attachmentUrls,
          mediaUrls: st.mediaUrls,
          drawingLinks: st.drawingLinks,
          requiresSignOff: st.requiresSignOff,
          sortOrder: st.sortOrder,
        })),
      },
    },
    include: { steps: true },
  });

  await logAudit({
    entityType: "WorkInstruction",
    entityId: copy.id,
    action: "REVISION_CREATED",
    userId: params.userId,
    metadata: { from: src.id, fromRev: src.revision, toRev: attempt },
  });

  return copy;
}

export async function linkWiToBom(params: {
  workInstructionId: string;
  bomHeaderId: string;
  userId?: string;
}) {
  const wi = await prisma.workInstruction.findUnique({
    where: { id: params.workInstructionId },
  });
  if (!wi) throw new Error("WI not found");
  if (wi.status !== "RELEASED") {
    throw new Error("Only released work instructions can be linked to a BOM");
  }
  const bom = await prisma.bomHeader.findUnique({
    where: { id: params.bomHeaderId },
  });
  if (!bom) throw new Error("BOM not found");

  return prisma.workInstruction.update({
    where: { id: wi.id },
    data: {
      bomHeaderId: bom.id,
      bomRevision: bom.revision,
      partId: wi.partId || bom.partId,
    },
  });
}
