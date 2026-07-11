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

  // When all steps signed (no fails) → material handler putaway queue
  const remaining = await prisma.workOrderStepCompletion.count({
    where: {
      workOrderId: params.workOrderId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });
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
        const mh =
          (await prisma.workCenter.findFirst({
            where: {
              isActive: true,
              OR: [
                { code: { startsWith: "SHIP" } },
                { code: { startsWith: "MH" } },
                { department: { contains: "Logistic" } },
              ],
            },
          })) ||
          (await prisma.workCenter.findFirst({
            where: { code: "SHIP-01", isActive: true },
          }));
        await updateWorkOrderStatus({
          workOrderId: wo.id,
          toStatus: "READY_FOR_PUTAWAY",
          userId: params.userId,
          notes: `All WI steps complete — route to material handler${
            mh ? ` (${mh.code})` : ""
          } for putaway`,
        });
        if (mh) {
          await prisma.workOrder.update({
            where: { id: wo.id },
            data: { workCenter: mh.code, department: mh.area || "MANUFACTURING" },
          });
        }
      }
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
    },
  });

  return updated;
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
      capacity: number;
      loadHours: number;
      orders: typeof workOrders;
    }
  > = {};

  for (const wc of workCenters) {
    byCenter[wc.code] = {
      center: wc.code,
      capacity: wc.capacityHoursPerDay * wc.efficiency,
      loadHours: 0,
      orders: [],
    };
  }

  for (const wo of workOrders) {
    const center = wo.workCenter || "UNASSIGNED";
    if (!byCenter[center]) {
      byCenter[center] = {
        center,
        capacity: 16,
        loadHours: 0,
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

  return {
    workOrders,
    byCenter: Object.values(byCenter),
    wipValue,
    signOffProgress,
    counts: {
      planned: workOrders.filter((w) => w.status === "PLANNED").length,
      released: workOrders.filter((w) => w.status === "RELEASED").length,
      inProgress: workOrders.filter((w) => w.status === "IN_PROGRESS").length,
      onHold: workOrders.filter((w) => w.status === "ON_HOLD").length,
    },
  };
}
