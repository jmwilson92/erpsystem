"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Create Work Order from BOM (certified revision only for PRODUCTION)
 * or as TASK_ONLY without BOM.
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
  travelerNotes?: string;
}) {
  const type = params.type || (params.bomHeaderId || params.partId ? "PRODUCTION" : "TASK_ONLY");

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

  const count = await prisma.workOrder.count();
  const number = `WO-${String(count + 1).padStart(5, "0")}`;

  const travelerNotes =
    params.travelerNotes ||
    [
      "DIGITAL TRAVELER",
      params.salesOrderRef ? `Sales order: ${params.salesOrderRef}` : null,
      dueDate ? `Due: ${dueDate.toISOString().slice(0, 10)}` : null,
      `Est. process: ${estimatedMinutes} min`,
      "Contains: BOM, Work Instructions, Kit list, sign-offs, material trace",
    ]
      .filter(Boolean)
      .join("\n");

  const wo = await prisma.workOrder.create({
    data: {
      number,
      type,
      status: "PLANNED",
      priority: params.priority || "NORMAL",
      partId,
      bomHeaderId,
      quantity: params.quantity || 1,
      projectId: params.projectId,
      wbsElementId: params.wbsElementId,
      salesOrderId: params.salesOrderId,
      salesOrderLineId: params.salesOrderLineId,
      salesOrderRef: params.salesOrderRef,
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
          toStatus: "PLANNED",
          userId: params.createdById,
          notes: dueDate
            ? `Work order created — due ${dueDate.toISOString().slice(0, 10)}, est ${estimatedMinutes} min`
            : "Work order created",
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

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: {
      number,
      type,
      bomHeaderId,
      partId,
      dueDate,
      estimatedMinutes,
      salesOrderId: params.salesOrderId,
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
  notes?: string;
}) {
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

  const status =
    params.result === "FAIL"
      ? "FAILED"
      : params.result === "PASS" || !completion.step.isTestStep
        ? "SIGNED"
        : "SIGNED";

  const updated = await prisma.workOrderStepCompletion.update({
    where: { id: completion.id },
    data: {
      status,
      result: params.result || (completion.step.isTestStep ? "PASS" : "NA"),
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
      workInstructionId: completion.step.workInstructionId,
      workOrderId: params.workOrderId,
      userId: params.userId,
      result: params.result || "PASS",
      measuredValue: params.measuredValue,
      notes: params.notes,
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

  // Auto-progress WO if all steps signed
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
      const wo = await prisma.workOrder.findUnique({ where: { id: params.workOrderId } });
      if (wo && wo.status === "IN_PROGRESS") {
        // leave as IN_PROGRESS for final QA — leadership sees 100% sign-off
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
    // Rough load estimate from remaining steps
    const pending = wo.stepCompletions.filter((s) =>
      ["PENDING", "IN_PROGRESS"].includes(s.status)
    ).length;
    byCenter[center].loadHours += pending * 0.5 || 2;
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
