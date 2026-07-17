import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { seedStepAssignments } from "@/lib/services/workcenters";

export type WorkOrderSourceType =
  | "SALES_ORDER"
  | "BOM"
  | "MATERIAL_REQ"
  | "OTHER";

/** Prefix by origin: SWO sales, BWO BOM, MWO material req, WO other */
export function workOrderPrefix(source: WorkOrderSourceType): string {
  switch (source) {
    case "SALES_ORDER":
      return "SWO";
    case "BOM":
      return "BWO";
    case "MATERIAL_REQ":
      return "MWO";
    default:
      return "WO";
  }
}

export function resolveWorkOrderSource(params: {
  sourceType?: WorkOrderSourceType;
  salesOrderId?: string | null;
  materialRequisitionId?: string | null;
  bomHeaderId?: string | null;
}): WorkOrderSourceType {
  if (params.sourceType) return params.sourceType;
  if (params.materialRequisitionId) return "MATERIAL_REQ";
  if (params.salesOrderId) return "SALES_ORDER";
  if (params.bomHeaderId) return "BOM";
  return "OTHER";
}

async function nextWorkOrderNumber(prefix: string): Promise<string> {
  const rows = await prisma.workOrder.findMany({
    where: { number: { startsWith: `${prefix}-` } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(5, "0")}`;
}

/**
 * Create Work Order from BOM (certified revision only for PRODUCTION)
 * or as TASK_ONLY without BOM.
 *
 * Numbering:
 * - SWO-##### sales order
 * - BWO-##### BOM / production (no SO)
 * - MWO-##### material requisition (forecast)
 * - WO-##### other (task, rework, inspection)
 */
export async function createWorkOrder(params: {
  type?: string;
  partId?: string;
  bomHeaderId?: string;
  quantity?: number;
  projectId?: string;
  wbsElementId?: string;
  workCenter?: string;
  department?: string;
  assigneeId?: string;
  createdById?: string;
  description?: string;
  dueDate?: Date;
  plannedStart?: Date;
  plannedEnd?: Date;
  workInstructionIds?: string[];
  requiresInspection?: boolean;
  priority?: string;
  salesOrderId?: string;
  salesOrderLineId?: string;
  salesOrderRef?: string;
  materialRequisitionId?: string;
  sourceType?: WorkOrderSourceType;
  travelerNotes?: string;
  /** BACKLOG | PLANNED | RELEASED (default PLANNED) */
  status?: string;
  businessPriorityId?: string;
}) {
  const type = params.type || (params.bomHeaderId || params.partId ? "PRODUCTION" : "TASK_ONLY");
  const sourceType = resolveWorkOrderSource({
    sourceType: params.sourceType,
    salesOrderId: params.salesOrderId,
    materialRequisitionId: params.materialRequisitionId,
    bomHeaderId: params.bomHeaderId,
  });

  // Sales-order builds are commercial demand — do not attach project/WBS unless
  // the caller explicitly passed them (rare). Forecast MWOs also stay project-free.
  const projectId =
    sourceType === "SALES_ORDER" || sourceType === "MATERIAL_REQ"
      ? params.projectId || undefined
      : params.projectId;
  const wbsElementId =
    sourceType === "SALES_ORDER" || sourceType === "MATERIAL_REQ"
      ? params.wbsElementId || undefined
      : params.wbsElementId;

  const bomHeaderId = params.bomHeaderId;
  let partId = params.partId;
  let standardCost = 0;

  if (bomHeaderId) {
    const bom = await prisma.bomHeader.findUnique({
      where: { id: bomHeaderId },
      include: { part: true, lines: { include: { componentPart: true } } },
    });
    if (!bom) throw new Error("BOM not found");

    if (type === "PRODUCTION" && bom.status !== "CERTIFIED") {
      throw new Error(
        `BOM revision ${bom.revision} is ${bom.status}. Only CERTIFIED BOMs can be used for production. Use PROTOTYPE type for prototype builds.`
      );
    }
    if (type === "PROTOTYPE" && !["PROTOTYPE", "CERTIFIED", "IN_REVIEW"].includes(bom.status)) {
      throw new Error(`BOM status ${bom.status} cannot be used for prototype WO`);
    }

    partId = bom.partId;
    standardCost =
      bom.lines.reduce(
        (s, l) => s + l.quantity * (l.componentPart.standardCost || 0),
        0
      ) * (params.quantity || 1);
  }

  // Attach work instructions (needed for schedule estimate)
  let wiIds = params.workInstructionIds || [];
  if (wiIds.length === 0 && partId) {
    const linked = await prisma.workInstruction.findMany({
      where: { partId, status: "RELEASED" },
      orderBy: { revision: "desc" },
      take: 1,
    });
    wiIds = linked.map((w) => w.id);
  }

  let estimatedMinutes = 0;
  if (wiIds.length) {
    const steps = await prisma.workInstructionStep.findMany({
      where: { workInstructionId: { in: wiIds } },
    });
    estimatedMinutes = steps.reduce((s, st) => s + (st.estimatedMinutes || 30), 0);
  }
  // kit + buffer
  estimatedMinutes = Math.round(estimatedMinutes * (params.quantity || 1) + 60);

  const dueDate = params.dueDate;
  let plannedEnd = params.plannedEnd;
  let plannedStart = params.plannedStart;
  if (dueDate && !plannedEnd) plannedEnd = dueDate;
  if (plannedEnd && !plannedStart) {
    plannedStart = new Date(plannedEnd.getTime() - estimatedMinutes * 60 * 1000);
  }

  const number = await nextWorkOrderNumber(workOrderPrefix(sourceType));

  // Resolve MRS number for traveler header when MWO
  let mrsNumber: string | null = null;
  if (params.materialRequisitionId) {
    const mrs = await prisma.materialRequisition.findUnique({
      where: { id: params.materialRequisitionId },
      select: { number: true },
    });
    mrsNumber = mrs?.number || null;
  }

  const travelerNotes =
    params.travelerNotes ||
    [
      "DIGITAL TRAVELER",
      sourceType === "SALES_ORDER"
        ? `Source: Sales order ${params.salesOrderRef || params.salesOrderId || ""}`
        : sourceType === "MATERIAL_REQ"
          ? `Source: Material requisition ${mrsNumber || params.materialRequisitionId}`
          : sourceType === "BOM"
            ? "Source: BOM / production plan"
            : null,
      params.salesOrderRef && sourceType !== "SALES_ORDER"
        ? `Sales order: ${params.salesOrderRef}`
        : null,
      mrsNumber ? `MRS: ${mrsNumber}` : null,
      dueDate ? `Due: ${dueDate.toISOString().slice(0, 10)}` : null,
      `Est. process: ${estimatedMinutes} min`,
      "Contains: BOM, Work Instructions, Kit list, sign-offs, material trace",
    ]
      .filter(Boolean)
      .join("\n");

  const initialStatus = ["BACKLOG", "PLANNED", "RELEASED"].includes(
    (params.status || "").toUpperCase()
  )
    ? (params.status || "PLANNED").toUpperCase()
    : "PLANNED";

  const wo = await prisma.workOrder.create({
    data: {
      number,
      type,
      sourceType,
      status: initialStatus,
      priority: params.priority || "NORMAL",
      partId,
      bomHeaderId,
      quantity: params.quantity || 1,
      projectId: projectId || null,
      wbsElementId: wbsElementId || null,
      salesOrderId: params.salesOrderId,
      salesOrderLineId: params.salesOrderLineId,
      salesOrderRef: params.salesOrderRef,
      materialRequisitionId: params.materialRequisitionId || null,
      businessPriorityId: params.businessPriorityId || null,
      workCenter: params.workCenter,
      department: params.department,
      assigneeId: params.assigneeId,
      createdById: params.createdById,
      description: params.description,
      dueDate,
      plannedStart,
      plannedEnd,
      estimatedMinutes,
      kitStatus: "NOT_STARTED",
      standardCost,
      travelerNotes,
      requiresInspection: params.requiresInspection || false,
      statusHistory: {
        create: {
          toStatus: initialStatus,
          userId: params.createdById,
          notes: [
            `${number} created (${sourceType})`,
            dueDate ? `due ${dueDate.toISOString().slice(0, 10)}` : null,
            `est ${estimatedMinutes} min`,
            mrsNumber ? `MRS ${mrsNumber}` : null,
          ]
            .filter(Boolean)
            .join(" — "),
        },
      },
    },
  });

  for (let i = 0; i < wiIds.length; i++) {
    await prisma.workOrderInstruction.create({
      data: {
        workOrderId: wo.id,
        workInstructionId: wiIds[i],
        sequence: i + 1,
      },
    });

    const steps = await prisma.workInstructionStep.findMany({
      where: { workInstructionId: wiIds[i] },
      orderBy: { stepNumber: "asc" },
    });
    for (const step of steps) {
      await prisma.workOrderStepCompletion.create({
        data: {
          workOrderId: wo.id,
          stepId: step.id,
          status: "PENDING",
        },
      });
    }
  }

  // Seed step stations from WI routing (area/specific WC) + WO preferred station
  await seedStepAssignments(wo.id, params.workCenter || wo.workCenter || undefined);

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: {
      number,
      type,
      sourceType,
      bomHeaderId,
      partId,
      dueDate,
      estimatedMinutes,
      salesOrderId: params.salesOrderId,
      materialRequisitionId: params.materialRequisitionId,
    },
  });

  return wo;
}

/**
 * Ensure the traveler has work instructions + step completions from released WIs.
 * Safe to call on every WO open — idempotent.
 */
export async function ensureWorkOrderTravelerSteps(params: {
  workOrderId: string;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: {
      instructions: true,
      stepCompletions: { select: { stepId: true } },
      part: { select: { id: true, partNumber: true } },
    },
  });
  if (!wo) throw new Error("Work order not found");

  let wiIds = wo.instructions.map((i) => i.workInstructionId);

  // Attach released WI for the part if none linked
  if (wiIds.length === 0 && wo.partId) {
    const linked = await prisma.workInstruction.findMany({
      where: {
        partId: wo.partId,
        status: { in: ["RELEASED", "CERTIFIED", "APPROVED"] },
      },
      orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
      take: 3,
    });
    // Prefer RELEASED first
    const ordered = [
      ...linked.filter((w) => w.status === "RELEASED"),
      ...linked.filter((w) => w.status !== "RELEASED"),
    ].slice(0, 1);

    let seq = 1;
    for (const wi of ordered) {
      await prisma.workOrderInstruction.create({
        data: {
          workOrderId: wo.id,
          workInstructionId: wi.id,
          sequence: seq++,
        },
      });
      wiIds.push(wi.id);
    }

    // Fall back: any released WI that lists this part via product? skip
    if (wiIds.length === 0) {
      // Last resort: latest WI for part any status except CANCELLED
      const any = await prisma.workInstruction.findFirst({
        where: {
          partId: wo.partId,
          status: { notIn: ["CANCELLED", "OBSOLETE", "SUPERSEDED"] },
        },
        orderBy: { revision: "desc" },
      });
      if (any) {
        await prisma.workOrderInstruction.create({
          data: {
            workOrderId: wo.id,
            workInstructionId: any.id,
            sequence: 1,
          },
        });
        wiIds.push(any.id);
      }
    }
  }

  if (wiIds.length === 0) {
    return { attached: 0, stepsSeeded: 0, wiIds: [] as string[] };
  }

  const existing = new Set(wo.stepCompletions.map((c) => c.stepId));
  const steps = await prisma.workInstructionStep.findMany({
    where: { workInstructionId: { in: wiIds } },
    orderBy: { stepNumber: "asc" },
  });

  let stepsSeeded = 0;
  for (const step of steps) {
    if (existing.has(step.id)) continue;
    await prisma.workOrderStepCompletion.create({
      data: {
        workOrderId: wo.id,
        stepId: step.id,
        status: "PENDING",
      },
    });
    stepsSeeded += 1;
  }

  if (stepsSeeded > 0) {
    await seedStepAssignments(wo.id, wo.workCenter || undefined);
  }

  return { attached: wiIds.length, stepsSeeded, wiIds };
}

/**
 * Start floor work on a traveler — moves to IN_PROGRESS and ensures WI steps exist.
 * Allowed from KITTED, RELEASED, READY_TO_KIT (or kitStatus KITTED).
 */
export async function startWorkOrderProduction(params: {
  workOrderId: string;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");

  const allowed = new Set([
    "KITTED",
    "RELEASED",
    "READY_TO_KIT",
    "IN_PROGRESS",
  ]);
  const kitOk = wo.kitStatus === "KITTED";
  if (!allowed.has(wo.status) && !kitOk) {
    throw new Error(
      `Cannot start production from status ${wo.status}. Release the WO or complete kitting first.`
    );
  }

  await ensureWorkOrderTravelerSteps({
    workOrderId: wo.id,
    userId: params.userId,
  });

  if (wo.status === "IN_PROGRESS") {
    return wo;
  }

  const updated = await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      status: "IN_PROGRESS",
      actualStart: wo.actualStart || new Date(),
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: "IN_PROGRESS",
          userId: params.userId,
          notes: "Production started — traveler steps open for sign-off",
        },
      },
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "PRODUCTION_START",
    userId: params.userId,
    metadata: { from: wo.status },
  });

  return updated;
}

export async function updateWorkOrderStatus(params: {
  workOrderId: string;
  toStatus: string;
  userId?: string;
  notes?: string;
}) {
  const wo = await prisma.workOrder.findUnique({ where: { id: params.workOrderId } });
  if (!wo) throw new Error("Work order not found");

  const data: Record<string, unknown> = { status: params.toStatus };
  if (params.toStatus === "IN_PROGRESS" && !wo.actualStart) {
    data.actualStart = new Date();
  }
  if (params.toStatus === "COMPLETED" || params.toStatus === "CLOSED") {
    data.actualEnd = new Date();
    if (params.toStatus === "COMPLETED") {
      data.quantityCompleted = wo.quantity;
    }
  }

  const updated = await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      ...data,
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: params.toStatus,
          userId: params.userId,
          notes: params.notes,
        },
      },
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "STATUS_CHANGE",
    userId: params.userId,
    changes: { from: wo.status, to: params.toStatus },
  });

  return updated;
}

export async function signOffStep(params: {
  workOrderId: string;
  stepId: string;
  userId: string;
  result?: string;
  measuredValue?: string;
  measureUom?: string;
  notes?: string;
  /** Tech PIN required to confirm identity */
  pinCode?: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw new Error("User not found");
  const expectedPin = user.pinCode || "1234";
  if (!params.pinCode || params.pinCode.trim() !== expectedPin) {
    throw new Error("Invalid PIN — sign-off not recorded");
  }

  const completion = await prisma.workOrderStepCompletion.findUnique({
    where: {
      workOrderId_stepId: {
        workOrderId: params.workOrderId,
        stepId: params.stepId,
      },
    },
    include: { step: true },
  });
  if (!completion) throw new Error("Step completion record not found");

  const step = completion.step;
  if (step.passFailRequired || step.isTestStep) {
    if (!params.result || !["PASS", "FAIL"].includes(params.result)) {
      throw new Error("Pass or Fail required for this step");
    }
  }
  if (step.measureUom && !params.measuredValue?.trim()) {
    throw new Error(
      `Measured value required (${step.measureUom}${step.expectedValue ? ` · expect ${step.expectedValue}` : ""})`
    );
  }

  const status =
    params.result === "FAIL"
      ? "FAILED"
      : params.result === "PASS" || !step.isTestStep
        ? "SIGNED"
        : "SIGNED";

  const updated = await prisma.workOrderStepCompletion.update({
    where: { id: completion.id },
    data: {
      status,
      result: params.result || (step.isTestStep ? "PASS" : "NA"),
      measuredValue: params.measuredValue,
      notes: params.notes,
      signedById: params.userId,
      signedAt: new Date(),
    },
  });

  // Also create WI sign-off record
  await prisma.workInstructionSignOff.create({
    data: {
      stepId: params.stepId,
      workInstructionId: step.workInstructionId,
      workOrderId: params.workOrderId,
      userId: params.userId,
      result: params.result || "PASS",
      measuredValue: params.measuredValue,
      measureUom: params.measureUom || step.measureUom || null,
      notes: params.notes,
      pinVerified: true,
    },
  });

  // If failed test step → create NCR path
  if (params.result === "FAIL") {
    const wo = await prisma.workOrder.findUnique({ where: { id: params.workOrderId } });
    if (wo) {
      const ncrCount = await prisma.nonConformance.count();
      await prisma.nonConformance.create({
        data: {
          number: `NCR-${String(ncrCount + 1).padStart(5, "0")}`,
          title: `In-process test failure on ${wo.number}`,
          description: `Step "${completion.step.title}" failed. Measured: ${params.measuredValue || "N/A"}. ${params.notes || ""}`,
          status: "OPEN",
          severity: "MAJOR",
          source: "IN_PROCESS",
          partId: wo.partId,
          workOrderId: wo.id,
          quantity: 1,
          createdById: params.userId,
        },
      });
      await updateWorkOrderStatus({
        workOrderId: wo.id,
        toStatus: "ON_HOLD",
        userId: params.userId,
        notes: "Held due to failed test step",
      });
    }
  }

  // Resolve stations by code + area (BUILD vs QA vs TEST) — not string equality alone
  const { resolveStepStation } = await import("@/lib/services/workcenters");
  const { isWorkArea, WORK_AREA_MOVE_LABELS } = await import("@/lib/work-areas");

  async function stationOf(sc: {
    assignedWorkCenter: string | null;
    step: {
      workCenter: string | null;
      requiredArea: string | null;
      isTestStep: boolean;
      stepType?: string | null;
    };
  }) {
    if (sc.assignedWorkCenter) {
      const wc = await prisma.workCenter.findFirst({
        where: { code: sc.assignedWorkCenter },
      });
      return {
        code: sc.assignedWorkCenter,
        area:
          (wc && isWorkArea(wc.area) ? wc.area : null) ||
          (isWorkArea(sc.step.requiredArea) ? sc.step.requiredArea : null),
      };
    }
    // stepType QA/TEST when WI didn't set requiredArea
    let requiredArea = sc.step.requiredArea;
    if (!requiredArea) {
      if (sc.step.isTestStep || sc.step.stepType === "TEST") requiredArea = "TEST";
      else if (sc.step.stepType === "QA") requiredArea = "QA";
      else if (sc.step.stepType === "BUILD") requiredArea = "MANUFACTURING";
    }
    const resolved = await resolveStepStation({
      stepWorkCenter: sc.step.workCenter,
      requiredArea,
      isTestStep: sc.step.isTestStep,
    });
    return { code: resolved.code, area: resolved.area };
  }

  const signedLoc = await stationOf({
    assignedWorkCenter: completion.assignedWorkCenter,
    step,
  });

  const nextOpen = await prisma.workOrderStepCompletion.findFirst({
    where: {
      workOrderId: params.workOrderId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    include: {
      step: {
        select: {
          id: true,
          stepNumber: true,
          title: true,
          workCenter: true,
          requiredArea: true,
          isTestStep: true,
          stepType: true,
        },
      },
    },
    orderBy: { step: { stepNumber: "asc" } },
  });

  let nextLoc: { code: string | null; area: string | null } = {
    code: null,
    area: null,
  };
  if (nextOpen) {
    nextLoc = await stationOf(nextOpen);
    // Ensure next step has an assigned station for queues/floor
    if (!nextOpen.assignedWorkCenter && nextLoc.code) {
      await prisma.workOrderStepCompletion.update({
        where: { id: nextOpen.id },
        data: { assignedWorkCenter: nextLoc.code },
      });
    }
  }

  // Area change (Mfg → QA) counts even when codes were empty before resolve
  const stationChanged = Boolean(
    nextOpen &&
      ((signedLoc.area &&
        nextLoc.area &&
        signedLoc.area !== nextLoc.area) ||
        (signedLoc.code &&
          nextLoc.code &&
          signedLoc.code.toUpperCase() !== nextLoc.code.toUpperCase()))
  );

  // Move WO to next station + note for the handoff banner
  let handoffLabel: string | null = null;
  if (stationChanged && nextLoc.code && params.result !== "FAIL") {
    const woNow = await prisma.workOrder.findUnique({
      where: { id: params.workOrderId },
      select: { status: true },
    });
    handoffLabel =
      nextLoc.area && isWorkArea(nextLoc.area)
        ? WORK_AREA_MOVE_LABELS[nextLoc.area]
        : nextLoc.code;
    await prisma.workOrder.update({
      where: { id: params.workOrderId },
      data: {
        workCenter: nextLoc.code,
        department: nextLoc.area || undefined,
        statusHistory: {
          create: {
            fromStatus: woNow?.status || "IN_PROGRESS",
            toStatus: woNow?.status || "IN_PROGRESS",
            userId: params.userId,
            notes: `Handoff: take traveler to ${handoffLabel} (${nextLoc.code}) for step ${
              nextOpen?.step.stepNumber
            } — ${nextOpen?.step.title || "next"}`,
          },
        },
      },
    });
  }

  // When all steps signed (no fails) → Receiving putaway
  const remaining = await prisma.workOrderStepCompletion.count({
    where: {
      workOrderId: params.workOrderId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });
  let allStepsComplete = remaining === 0;
  let readyForPutaway = false;

  if (remaining === 0) {
    const failed = await prisma.workOrderStepCompletion.count({
      where: { workOrderId: params.workOrderId, status: "FAILED" },
    });
    if (failed === 0) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: params.workOrderId },
      });
      if (
        wo &&
        ["IN_PROGRESS", "RELEASED", "KITTED"].includes(wo.status) &&
        wo.type !== "TASK_ONLY"
      ) {
        await sendWorkOrderToReceivingPutaway({
          workOrderId: wo.id,
          userId: params.userId,
          reason: "All WI steps complete",
        });
        readyForPutaway = true;
        allStepsComplete = true;
      }
    } else {
      allStepsComplete = false;
    }
  }

  await logAudit({
    entityType: "WorkOrderStep",
    entityId: completion.id,
    action: "SIGN_OFF",
    userId: params.userId,
    metadata: {
      workOrderId: params.workOrderId,
      stepId: params.stepId,
      result: params.result,
      stationChanged,
      nextStepId: nextOpen?.stepId || null,
      fromArea: signedLoc.area,
      toArea: nextLoc.area,
      toCode: nextLoc.code,
    },
  });

  // Plain JSON only — Prisma models break client serialization
  return {
    stationChanged: readyForPutaway ? true : stationChanged,
    nextStepId: nextOpen?.stepId || null,
    nextWorkCenter: nextLoc.code,
    nextArea: nextLoc.area,
    nextAreaLabel: handoffLabel,
    nextStepTitle: nextOpen?.step.title || null,
    nextStepNumber: nextOpen?.step.stepNumber ?? null,
    signedWorkCenter: signedLoc.code,
    signedArea: signedLoc.area,
    allStepsComplete,
    readyForPutaway,
  };
}

/**
 * Ensure a draft WI exists for a prototype WO (for building steps during build).
 */
export async function ensurePrototypeWorkInstruction(params: {
  workOrderId: string;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: {
      part: true,
      instructions: { include: { workInstruction: true } },
    },
  });
  if (!wo) throw new Error("Work order not found");
  if (wo.type !== "PROTOTYPE") {
    throw new Error("Only prototype work orders can draft WIs during build");
  }
  if (!wo.partId || !wo.part) throw new Error("Prototype WO needs a part");

  const existing = wo.instructions.find(
    (i) =>
      i.workInstruction &&
      !["RELEASED", "OBSOLETE"].includes(i.workInstruction.status)
  );
  if (existing) {
    return existing.workInstruction;
  }

  const draft = await prisma.workInstruction.findFirst({
    where: {
      partId: wo.partId,
      status: { in: ["DRAFT", "ENGINEERING_REVIEW"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (draft) {
    await prisma.workOrderInstruction.create({
      data: {
        workOrderId: wo.id,
        workInstructionId: draft.id,
        sequence: wo.instructions.length + 1,
      },
    });
    return draft;
  }

  const { createWorkInstruction } = await import(
    "@/lib/services/work-instructions"
  );
  const count = await prisma.workInstruction.count();
  const docNum = `WI-P-${String(count + 1).padStart(4, "0")}`;
  const wi = await createWorkInstruction({
    documentNumber: docNum,
    title: `Prototype traveler WI — ${wo.part.partNumber}`,
    partId: wo.partId,
    bomHeaderId: wo.bomHeaderId || undefined,
    revision: "A",
    userId: params.userId,
    steps: [],
  });
  await prisma.workOrderInstruction.create({
    data: {
      workOrderId: wo.id,
      workInstructionId: wi.id,
      sequence: 1,
    },
  });
  return wi;
}

/**
 * Finish prototype build: submit draft WI to CM submissions as ECR, then putaway.
 */
export async function finishPrototypeWorkOrder(params: {
  workOrderId: string;
  userId?: string;
  notes?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: {
      instructions: { include: { workInstruction: { include: { steps: true } } } },
      part: true,
    },
  });
  if (!wo) throw new Error("Work order not found");
  if (wo.type !== "PROTOTYPE") {
    throw new Error("Finish prototype is only for PROTOTYPE work orders");
  }

  // Prefer linked draft WI with steps
  let wi =
    wo.instructions
      .map((i) => i.workInstruction)
      .find(
        (w) =>
          w &&
          w.steps.length > 0 &&
          !["RELEASED", "OBSOLETE"].includes(w.status)
      ) || null;

  if (!wi) {
    // Fall back: any draft WI for part with steps
    wi = await prisma.workInstruction.findFirst({
      where: {
        partId: wo.partId || undefined,
        status: { in: ["DRAFT", "ENGINEERING_REVIEW"] },
        steps: { some: {} },
      },
      include: { steps: true },
    });
  }

  if (!wi || wi.steps.length === 0) {
    throw new Error(
      "Add at least one work instruction step on this prototype before finishing"
    );
  }

  const { submitWiToCm } = await import("@/lib/services/work-instructions");
  const submitted = await submitWiToCm({
    workInstructionId: wi.id,
    userId: params.userId,
    notes:
      params.notes ||
      `Prototype ${wo.number} complete — submit ${wi.documentNumber} for CM release`,
  });

  // Complete traveler steps if any pending (prototype capture)
  await prisma.workOrderStepCompletion.updateMany({
    where: {
      workOrderId: wo.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    data: {
      status: "SIGNED",
      result: "PASS",
      signedAt: new Date(),
      signedById: params.userId || null,
      notes: "Auto-signed on prototype finish",
    },
  });

  // Send to receiving putaway (or complete if task-like)
  try {
    await sendWorkOrderToReceivingPutaway({
      workOrderId: wo.id,
      userId: params.userId,
      reason: `Prototype finished — WI ${wi.documentNumber} submitted to CM`,
    });
  } catch {
    await updateWorkOrderStatus({
      workOrderId: wo.id,
      toStatus: "READY_FOR_PUTAWAY",
      userId: params.userId,
      notes: "Prototype finished — awaiting putaway",
    });
  }

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "PROTOTYPE_FINISHED",
    userId: params.userId,
    metadata: {
      workInstructionId: wi.id,
      changeRequestId: submitted.changeRequest.id,
      ecr: submitted.changeRequest.number,
    },
  });

  return {
    workOrderId: wo.id,
    workInstructionId: wi.id,
    changeRequestId: submitted.changeRequest.id,
    ecrNumber: submitted.changeRequest.number,
    wiNumber: wi.documentNumber,
  };
}

/** Resolve default Receiving station code (seed uses RCV-01). */
export async function defaultReceivingWorkCenterCode(): Promise<string> {
  const rec =
    (await prisma.workCenter.findFirst({
      where: { code: "RCV-01", isActive: true },
    })) ||
    (await prisma.workCenter.findFirst({
      where: { area: "RECEIVING", isActive: true },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    })) ||
    (await prisma.workCenter.findFirst({
      where: {
        isActive: true,
        OR: [
          { code: { startsWith: "RCV" } },
          { code: { startsWith: "REC" } },
          { name: { contains: "Receiv" } },
        ],
      },
    }));
  return rec?.code || "RCV-01";
}

/**
 * Park finished traveler at Receiving (RCV-01) for FG putaway.
 * Does NOT put away / complete stock — that only happens on the Receiving putaway queue.
 */
export async function sendWorkOrderToReceivingPutaway(params: {
  workOrderId: string;
  userId?: string;
  reason?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
    throw new Error(`WO already ${wo.status}`);
  }

  // Require traveler steps done first
  const pending = await prisma.workOrderStepCompletion.count({
    where: {
      workOrderId: wo.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });
  if (pending > 0 && wo.type !== "TASK_ONLY") {
    throw new Error(
      `${pending} traveler step(s) still open — finish sign-off before Sending to Receiving`
    );
  }
  const failed = await prisma.workOrderStepCompletion.count({
    where: { workOrderId: wo.id, status: "FAILED" },
  });
  if (failed > 0) {
    throw new Error("Failed steps on traveler — resolve NCR before putaway");
  }

  const code = await defaultReceivingWorkCenterCode();

  // Already parked at receiving putaway — idempotent
  if (wo.status === "READY_FOR_PUTAWAY" && wo.workCenter === code) {
    return { workCenter: code, alreadyThere: true as const };
  }

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      status: "READY_FOR_PUTAWAY",
      workCenter: code,
      department: "RECEIVING",
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: "READY_FOR_PUTAWAY",
          userId: params.userId,
          notes:
            params.reason ||
            `Delivered to Receiving workcenter ${code} — awaiting putaway (not stocked yet)`,
        },
      },
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "SENT_TO_RECEIVING_PUTAWAY",
    userId: params.userId,
    metadata: { workCenter: code, stocked: false },
  });

  return { workCenter: code, alreadyThere: false as const };
}

export async function getFloorBoardData() {
  const workOrders = await prisma.workOrder.findMany({
    where: {
      status: {
        in: [
          "PLANNED",
          "WAITING_MATERIAL",
          "READY_TO_KIT",
          "KITTING",
          "KITTED",
          "RELEASED",
          "IN_PROGRESS",
          "READY_FOR_PUTAWAY",
          "ON_HOLD",
        ],
      },
    },
    include: {
      part: true,
      assignee: { select: { id: true, name: true } },
      stepCompletions: true,
      project: { select: { number: true, name: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ priority: "desc" }, { plannedEnd: "asc" }],
  });

  const workCenters = await prisma.workCenter.findMany({ where: { isActive: true } });

  const byCenter: Record<
    string,
    {
      center: string;
      name: string;
      area: string;
      efficiency: number;
      capacity: number;
      loadHours: number;
      sortOrder: number;
      orders: typeof workOrders;
    }
  > = {};

  for (const wc of workCenters) {
    byCenter[wc.code] = {
      center: wc.code,
      name: wc.name,
      area: wc.area,
      efficiency: wc.efficiency,
      capacity: wc.capacityHoursPerDay * wc.efficiency,
      loadHours: 0,
      sortOrder: wc.sortOrder,
      orders: [],
    };
  }

  for (const wo of workOrders) {
    const center = wo.workCenter || "UNASSIGNED";
    if (!byCenter[center]) {
      byCenter[center] = {
        center,
        name: center === "UNASSIGNED" ? "Unassigned" : center,
        area: "MANUFACTURING",
        efficiency: 1,
        capacity: 16,
        loadHours: 0,
        sortOrder: 999,
        orders: [],
      };
    }
    byCenter[center].orders.push(wo);
    // Rough load estimate from remaining steps, WO estimate, or default
    const pending = wo.stepCompletions.filter((s) =>
      ["PENDING", "IN_PROGRESS"].includes(s.status)
    ).length;
    if (pending > 0) {
      byCenter[center].loadHours += pending * 0.5;
    } else if (wo.estimatedMinutes && wo.estimatedMinutes > 0) {
      byCenter[center].loadHours += wo.estimatedMinutes / 60;
    } else {
      byCenter[center].loadHours += wo.type === "INSPECTION" ? 1.5 : 2;
    }
  }

  const wipValue = workOrders.reduce(
    (s, w) => s + (w.actualCost || w.standardCost || 0),
    0
  );

  const signOffProgress = workOrders.map((wo) => {
    const total = wo.stepCompletions.length;
    const done = wo.stepCompletions.filter((s) =>
      ["SIGNED", "PASSED", "SKIPPED"].includes(s.status)
    ).length;
    return {
      id: wo.id,
      number: wo.number,
      pct: total > 0 ? Math.round((done / total) * 100) : wo.status === "COMPLETED" ? 100 : 0,
    };
  });

  // ── Plant KPIs ──────────────────────────────────────────────
  // First-pass yield from recent inspection outcomes.
  const inspAgg = await prisma.inspection.groupBy({
    by: ["status"],
    _count: true,
  });
  const passed = inspAgg.find((i) => i.status === "PASSED")?._count || 0;
  const failed = inspAgg.find((i) => i.status === "FAILED")?._count || 0;
  const fpy =
    passed + failed > 0 ? Math.round((passed / (passed + failed)) * 1000) / 10 : 100;

  // Plant efficiency: staffed-weighted average of work-center efficiency.
  const effCenters = workCenters.length
    ? Math.round(
        (workCenters.reduce((s, wc) => s + wc.efficiency, 0) / workCenters.length) *
          1000
      ) / 10
    : 100;

  const holds = workOrders.filter((w) => w.status === "ON_HOLD").length;

  // Whole-plant load vs capacity (for the over-capacity pulse).
  const centers = Object.values(byCenter);
  const totalCapacity = centers.reduce((s, c) => s + c.capacity, 0);
  const totalLoad = centers.reduce((s, c) => s + c.loadHours, 0);
  const utilization =
    totalCapacity > 0 ? Math.round((totalLoad / totalCapacity) * 1000) / 10 : 0;

  return {
    workOrders,
    byCenter: centers.sort((a, b) => a.sortOrder - b.sortOrder),
    wipValue,
    signOffProgress,
    counts: {
      planned: workOrders.filter((w) => w.status === "PLANNED").length,
      released: workOrders.filter((w) => w.status === "RELEASED").length,
      inProgress: workOrders.filter((w) => w.status === "IN_PROGRESS").length,
      onHold: holds,
    },
    kpis: {
      fpy,
      efficiency: effCenters,
      holds,
      utilization,
      overCapacity: utilization > 100,
    },
  };
}
