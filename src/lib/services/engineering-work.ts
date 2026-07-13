import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Default system swim lanes (seeded; users can add more). */
export const DEFAULT_ENG_LANES = [
  { code: "SYSTEMS", name: "Systems", sortOrder: 0 },
  { code: "MECHANICAL", name: "Mechanical", sortOrder: 1 },
  { code: "ELECTRICAL", name: "Electrical", sortOrder: 2 },
  { code: "NETWORK", name: "Network", sortOrder: 3 },
  { code: "CYBER", name: "Cyber", sortOrder: 4 },
  { code: "SOFTWARE", name: "Software", sortOrder: 5 },
  { code: "HARDWARE", name: "Hardware", sortOrder: 6 },
  { code: "RF", name: "RF", sortOrder: 7 },
  { code: "QUALITY", name: "Quality", sortOrder: 8 },
  {
    code: "MFG_ENG",
    name: "Manufacturing Eng",
    sortOrder: 9,
    description: "BOM/process/doc sustainment + production support",
  },
  { code: "OTHER", name: "Other", sortOrder: 10 },
] as const;

/** @deprecated use listSwimLanes() — kept for type helpers */
export const ENG_DISCIPLINES = DEFAULT_ENG_LANES.map((l) => l.code);

export const PROD_ISSUE_CATEGORIES = [
  "HARDWARE",
  "PROCESS",
  "DOCUMENT",
  "BOM",
  "TOOLING",
  "OTHER",
] as const;

export type EngDiscipline = string;

export const WORK_STATUSES = [
  "BACKLOG",
  "TODO",
  "PLANNED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const;

const DEFAULT_LABOR_RATE = 125; // $/hr for NRE rollup when not set

// ── Campaigns (PM) ────────────────────────────────────────────

export async function createCampaign(params: {
  projectId: string;
  wbsElementId?: string | null;
  name: string;
  description?: string | null;
  definitionOfDone?: string | null;
  priority?: string;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number;
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Campaign name required");
  const count = await prisma.campaign.count({
    where: { projectId: params.projectId },
  });
  const number = `CMP-${String(count + 1).padStart(3, "0")}`;
  const campaign = await prisma.campaign.create({
    data: {
      projectId: params.projectId,
      wbsElementId: params.wbsElementId || null,
      number,
      name,
      description: params.description?.trim() || null,
      definitionOfDone: params.definitionOfDone?.trim() || null,
      status: "PLANNED",
      priority: (params.priority || "NORMAL").toUpperCase(),
      ownerId: params.ownerId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      dueDate: params.dueDate || null,
      estimatedHours: params.estimatedHours ?? 0,
      storyPoints: params.storyPoints ?? 0,
    },
  });
  await logAudit({
    entityType: "Campaign",
    entityId: campaign.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, name, projectId: params.projectId },
  });
  return campaign;
}

export async function updateCampaign(params: {
  id: string;
  name?: string;
  description?: string | null;
  definitionOfDone?: string | null;
  status?: string;
  priority?: string;
  wbsElementId?: string | null;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number;
}) {
  return prisma.campaign.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.definitionOfDone !== undefined
        ? { definitionOfDone: params.definitionOfDone }
        : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.priority ? { priority: params.priority.toUpperCase() } : {}),
      ...(params.wbsElementId !== undefined
        ? { wbsElementId: params.wbsElementId || null }
        : {}),
      ...(params.ownerId !== undefined ? { ownerId: params.ownerId || null } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.estimatedHours !== undefined
        ? { estimatedHours: params.estimatedHours }
        : {}),
      ...(params.storyPoints !== undefined
        ? { storyPoints: params.storyPoints }
        : {}),
    },
  });
}

// ── Sagas (Engineering under campaign) ────────────────────────

export async function createSaga(params: {
  projectId: string;
  campaignId: string;
  name: string;
  description?: string | null;
  discipline?: string;
  definitionOfDone?: string | null;
  priority?: string;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number;
  dependsOnTaskIds?: string[];
  dependsOnSagaIds?: string[];
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Saga name required");
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.campaignId },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.projectId !== params.projectId) {
    throw new Error("Campaign does not belong to this project");
  }
  const count = await prisma.saga.count({
    where: { campaignId: params.campaignId },
  });
  const number = `SAG-${String(count + 1).padStart(3, "0")}`;
  const saga = await prisma.saga.create({
    data: {
      projectId: params.projectId,
      campaignId: params.campaignId,
      number,
      name,
      description: params.description?.trim() || null,
      discipline: (params.discipline || "SYSTEMS").toUpperCase(),
      definitionOfDone: params.definitionOfDone?.trim() || null,
      status: "BACKLOG",
      priority: (params.priority || "NORMAL").toUpperCase(),
      ownerId: params.ownerId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      dueDate: params.dueDate || null,
      estimatedHours: params.estimatedHours ?? 0,
      storyPoints: params.storyPoints ?? 0,
    },
  });
  for (const src of params.dependsOnTaskIds || []) {
    if (src)
      await addEngDependency({
        sourceTaskId: src,
        targetSagaId: saga.id,
        type: "FINISH_TO_START",
      });
  }
  for (const src of params.dependsOnSagaIds || []) {
    if (src)
      await addEngDependency({
        sourceSagaId: src,
        targetSagaId: saga.id,
        type: "FINISH_TO_START",
      });
  }

  await logAudit({
    entityType: "Saga",
    entityId: saga.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, name, campaignId: params.campaignId },
  });
  return saga;
}

export async function updateSaga(params: {
  id: string;
  name?: string;
  description?: string | null;
  definitionOfDone?: string | null;
  discipline?: string;
  status?: string;
  priority?: string;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number;
}) {
  return prisma.saga.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.definitionOfDone !== undefined
        ? { definitionOfDone: params.definitionOfDone }
        : {}),
      ...(params.discipline
        ? { discipline: params.discipline.toUpperCase() }
        : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.priority ? { priority: params.priority.toUpperCase() } : {}),
      ...(params.ownerId !== undefined ? { ownerId: params.ownerId || null } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.estimatedHours !== undefined
        ? { estimatedHours: params.estimatedHours }
        : {}),
      ...(params.storyPoints !== undefined
        ? { storyPoints: params.storyPoints }
        : {}),
    },
  });
}

// ── Tasks ─────────────────────────────────────────────────────

export async function createEngTask(params: {
  projectId?: string | null;
  productId?: string | null;
  sagaId?: string | null;
  campaignId?: string | null;
  parentId?: string | null;
  name: string;
  description?: string | null;
  kind?: string;
  discipline?: string | null;
  priority?: string;
  assigneeId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number | null;
  productionIssueId?: string | null;
  /** Task IDs this new task depends on (predecessors) */
  dependsOnTaskIds?: string[];
  /** Saga IDs this new task depends on */
  dependsOnSagaIds?: string[];
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Task name required");

  let campaignId = params.campaignId || null;
  const sagaId = params.sagaId || null;
  let projectId = params.projectId || null;
  let productId = params.productId || null;
  let discipline = params.discipline?.toUpperCase() || null;

  if (sagaId) {
    const saga = await prisma.saga.findUnique({ where: { id: sagaId } });
    if (!saga) throw new Error("Saga not found");
    campaignId = saga.campaignId;
    projectId = projectId || saga.projectId;
    if (!discipline) discipline = saga.discipline;
  }

  if (!projectId && !productId && !sagaId) {
    throw new Error("Task needs a project, product, or saga");
  }

  // Inherit product from project when not set
  if (projectId && !productId) {
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { productId: true },
    });
    productId = proj?.productId || null;
  }

  const count = await prisma.engTask.count();
  const number = `TSK-${String(count + 1).padStart(4, "0")}`;
  const kind = (
    params.kind ||
    (params.parentId
      ? "SUBTASK"
      : productId && !projectId
        ? "SUSTAINMENT"
        : "TASK")
  ).toUpperCase();

  const task = await prisma.engTask.create({
    data: {
      projectId,
      productId,
      campaignId,
      sagaId,
      parentId: params.parentId || null,
      productionIssueId: params.productionIssueId || null,
      number,
      name,
      description: params.description?.trim() || null,
      kind,
      discipline,
      status: "TODO",
      priority: (params.priority || "NORMAL").toUpperCase(),
      assigneeId: params.assigneeId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      dueDate: params.dueDate || null,
      estimatedHours: params.estimatedHours ?? 0,
      storyPoints: params.storyPoints ?? null,
    },
  });

  // Dependencies at create time
  for (const src of params.dependsOnTaskIds || []) {
    if (src)
      await addEngDependency({
        sourceTaskId: src,
        targetTaskId: task.id,
        type: "FINISH_TO_START",
      });
  }
  for (const src of params.dependsOnSagaIds || []) {
    if (src)
      await addEngDependency({
        sourceSagaId: src,
        targetTaskId: task.id,
        type: "FINISH_TO_START",
      });
  }

  await logAudit({
    entityType: "EngTask",
    entityId: task.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, name, sagaId, campaignId, productId, projectId },
  });
  return task;
}

export async function updateEngTask(params: {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number;
  storyPoints?: number | null;
  percentComplete?: number;
  engSprintId?: string | null;
}) {
  const data: Record<string, unknown> = {};
  if (params.name !== undefined) data.name = params.name.trim();
  if (params.description !== undefined) data.description = params.description;
  if (params.status) {
    data.status = params.status.toUpperCase();
    if (params.status.toUpperCase() === "DONE") data.percentComplete = 100;
  }
  if (params.priority) data.priority = params.priority.toUpperCase();
  if (params.assigneeId !== undefined) data.assigneeId = params.assigneeId || null;
  if (params.startDate !== undefined) data.startDate = params.startDate;
  if (params.endDate !== undefined) data.endDate = params.endDate;
  if (params.dueDate !== undefined) data.dueDate = params.dueDate;
  if (params.estimatedHours !== undefined)
    data.estimatedHours = params.estimatedHours;
  if (params.storyPoints !== undefined) data.storyPoints = params.storyPoints;
  if (params.percentComplete !== undefined)
    data.percentComplete = params.percentComplete;
  if (params.engSprintId !== undefined)
    data.engSprintId = params.engSprintId || null;

  // Block status advance if unfinished predecessors
  if (params.status && !["BACKLOG", "TODO", "CANCELLED"].includes(params.status.toUpperCase())) {
    const blocked = await getUnresolvedBlockersForTask(params.id);
    if (blocked.length > 0 && params.status.toUpperCase() === "IN_PROGRESS") {
      // Allow start but flag — only hard-block DONE
    }
    if (params.status.toUpperCase() === "DONE" && blocked.length > 0) {
      throw new Error(
        `Cannot complete: blocked by ${blocked.map((b) => b.label).join(", ")}`
      );
    }
  }

  const task = await prisma.engTask.update({
    where: { id: params.id },
    data,
  });
  await rollupHoursFromTask(task.id);
  return task;
}

/** Break a complex task into a child subtask. */
export async function breakDownTask(params: {
  parentTaskId: string;
  name: string;
  description?: string | null;
  assigneeId?: string | null;
  estimatedHours?: number;
  storyPoints?: number | null;
  dueDate?: Date | null;
  userId?: string | null;
}) {
  const parent = await prisma.engTask.findUnique({
    where: { id: params.parentTaskId },
  });
  if (!parent) throw new Error("Parent task not found");
  return createEngTask({
    projectId: parent.projectId,
    productId: parent.productId,
    sagaId: parent.sagaId,
    campaignId: parent.campaignId,
    parentId: parent.id,
    name: params.name,
    description: params.description,
    kind: "SUBTASK",
    discipline: parent.discipline,
    assigneeId: params.assigneeId,
    estimatedHours: params.estimatedHours,
    storyPoints: params.storyPoints,
    dueDate: params.dueDate,
    userId: params.userId,
  });
}

// ── Production → MFG Engineering issues ───────────────────────

export async function createProductionEngIssue(params: {
  title: string;
  description?: string | null;
  category?: string;
  priority?: string;
  reportedById?: string | null;
  reportedByName?: string | null;
  workOrderId?: string | null;
  partId?: string | null;
  productId?: string | null;
  projectId?: string | null;
  sourceArea?: string | null;
  workCenter?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Issue title required");
  const count = await prisma.productionEngIssue.count();
  const number = `PEI-${String(count + 1).padStart(5, "0")}`;

  // Infer product from part / WO when possible
  let productId = params.productId || null;
  let partId = params.partId || null;
  let projectId = params.projectId || null;
  if (params.workOrderId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: params.workOrderId },
      select: { partId: true, projectId: true, part: { select: { partNumber: true } } },
    });
    if (wo) {
      partId = partId || wo.partId;
      projectId = projectId || wo.projectId;
    }
  }
  if (!productId && partId) {
    const link = await prisma.productPart.findFirst({
      where: { partId },
      select: { productId: true },
    });
    productId = link?.productId || null;
    if (!productId) {
      const asTop = await prisma.product.findFirst({
        where: { topLevelPartId: partId },
        select: { id: true },
      });
      productId = asTop?.id || null;
    }
  }

  const issue = await prisma.productionEngIssue.create({
    data: {
      number,
      title,
      description: params.description?.trim() || null,
      category: (params.category || "PROCESS").toUpperCase(),
      priority: (params.priority || "NORMAL").toUpperCase(),
      status: "OPEN",
      reportedById: params.reportedById || null,
      reportedByName: params.reportedByName || null,
      workOrderId: params.workOrderId || null,
      partId,
      productId,
      projectId,
      sourceArea: params.sourceArea?.trim().toUpperCase() || null,
      workCenter: params.workCenter?.trim() || null,
    },
  });

  // Auto-hold the linked work order until MFG Eng resolves the request
  if (params.workOrderId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: params.workOrderId },
    });
    if (wo && !["COMPLETED", "CANCELLED", "CLOSED", "ON_HOLD"].includes(wo.status)) {
      await prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          status: "ON_HOLD",
          statusHistory: {
            create: {
              fromStatus: wo.status,
              toStatus: "ON_HOLD",
              userId: params.reportedById || undefined,
              notes: `Auto-hold: MFG Eng request ${number} opened`,
            },
          },
        },
      });
      await logAudit({
        entityType: "WorkOrder",
        entityId: wo.id,
        action: "AUTO_HOLD_MFG_ENG",
        userId: params.reportedById || undefined,
        changes: { from: wo.status, to: "ON_HOLD", issueNumber: number },
      });
    }
  }

  await logAudit({
    entityType: "ProductionEngIssue",
    entityId: issue.id,
    action: "CREATE",
    userId: params.reportedById || undefined,
    metadata: { number, title, category: issue.category },
  });
  return issue;
}

/** ME accepts production issue → creates MFG_ENG task (optionally product-linked). */
export async function acceptProductionIssueAsTask(params: {
  issueId: string;
  assigneeId?: string | null;
  userId?: string | null;
}) {
  const issue = await prisma.productionEngIssue.findUnique({
    where: { id: params.issueId },
  });
  if (!issue) throw new Error("Production eng issue not found");
  const existing = await prisma.engTask.findFirst({
    where: { productionIssueId: issue.id },
  });
  if (existing) return { issue, task: existing };

  const task = await createEngTask({
    projectId: issue.projectId,
    productId: issue.productId,
    name: `[Prod] ${issue.title}`,
    description: [
      issue.description,
      issue.workOrderId ? `WO linked: ${issue.workOrderId}` : null,
      `Category: ${issue.category}`,
      issue.workCenter ? `Station: ${issue.workCenter}` : null,
      "Raised by production — clarify process or open ECR if docs/hardware need change.",
    ]
      .filter(Boolean)
      .join("\n"),
    kind: "PROD_SUPPORT",
    discipline: "MFG_ENG",
    priority: issue.priority,
    assigneeId: params.assigneeId,
    productionIssueId: issue.id,
    userId: params.userId,
  });

  const updated = await prisma.productionEngIssue.update({
    where: { id: issue.id },
    data: { status: "IN_PROGRESS" },
  });

  return { issue: updated, task };
}

export async function updateProductionEngIssue(params: {
  id: string;
  status?: string;
  resolution?: string | null;
  changeRequestId?: string | null;
  priority?: string;
  userId?: string | null;
}) {
  const existing = await prisma.productionEngIssue.findUnique({
    where: { id: params.id },
  });
  if (!existing) throw new Error("Production eng issue not found");

  const data: Record<string, unknown> = {};
  const newStatus = params.status?.toUpperCase();
  if (newStatus) {
    data.status = newStatus;
    if (["RESOLVED", "CLOSED", "REJECTED"].includes(newStatus)) {
      data.resolvedAt = new Date();
    }
  }
  if (params.resolution !== undefined) data.resolution = params.resolution;
  if (params.changeRequestId !== undefined)
    data.changeRequestId = params.changeRequestId;
  if (params.priority) data.priority = params.priority.toUpperCase();

  const updated = await prisma.productionEngIssue.update({
    where: { id: params.id },
    data,
  });

  // When MFG Eng request is resolved, release WO hold if no other open issues
  if (
    newStatus &&
    ["RESOLVED", "CLOSED", "REJECTED"].includes(newStatus) &&
    existing.workOrderId
  ) {
    const openOthers = await prisma.productionEngIssue.count({
      where: {
        workOrderId: existing.workOrderId,
        id: { not: existing.id },
        status: {
          in: ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ECR"],
        },
      },
    });
    if (openOthers === 0) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: existing.workOrderId },
      });
      if (wo && wo.status === "ON_HOLD") {
        // Prefer last non-hold status from history
        const prior = await prisma.workOrderStatusHistory.findFirst({
          where: {
            workOrderId: wo.id,
            toStatus: "ON_HOLD",
          },
          orderBy: { createdAt: "desc" },
        });
        const restoreTo =
          prior?.fromStatus && prior.fromStatus !== "ON_HOLD"
            ? prior.fromStatus
            : "IN_PROGRESS";
        await prisma.workOrder.update({
          where: { id: wo.id },
          data: {
            status: restoreTo,
            statusHistory: {
              create: {
                fromStatus: "ON_HOLD",
                toStatus: restoreTo,
                userId: params.userId || undefined,
                notes: `Hold released: MFG Eng ${existing.number} ${newStatus}`,
              },
            },
          },
        });
      }
    }
  }

  return updated;
}

export async function listProductionEngIssues(params?: {
  status?: string;
  openOnly?: boolean;
}) {
  return prisma.productionEngIssue.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.openOnly
        ? {
            status: {
              in: ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ECR"],
            },
          }
        : {}),
    },
    include: {
      workOrder: { select: { id: true, number: true, status: true } },
      part: { select: { id: true, partNumber: true, description: true } },
      product: { select: { id: true, code: true, name: true } },
      engTask: {
        select: { id: true, number: true, name: true, status: true },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function listProductEngTasks(productId: string) {
  return prisma.engTask.findMany({
    where: { productId, parentId: null },
    include: {
      children: true,
      project: { select: { id: true, number: true, name: true } },
      productionIssue: {
        select: { id: true, number: true, category: true, status: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ── Dependencies (cross-lane must-have) ───────────────────────

export async function addEngDependency(params: {
  type?: string;
  notes?: string | null;
  sourceTaskId?: string | null;
  sourceSagaId?: string | null;
  targetTaskId?: string | null;
  targetSagaId?: string | null;
  notifyPm?: boolean;
}) {
  const hasSource = !!(params.sourceTaskId || params.sourceSagaId);
  const hasTarget = !!(params.targetTaskId || params.targetSagaId);
  if (!hasSource || !hasTarget) {
    throw new Error("Dependency needs a source and a target (task and/or saga)");
  }
  if (
    params.sourceTaskId &&
    params.targetTaskId &&
    params.sourceTaskId === params.targetTaskId
  ) {
    throw new Error("A task cannot depend on itself");
  }
  if (
    params.sourceSagaId &&
    params.targetSagaId &&
    params.sourceSagaId === params.targetSagaId
  ) {
    throw new Error("A saga cannot depend on itself");
  }

  const dep = await prisma.engDependency.create({
    data: {
      type: (params.type || "FINISH_TO_START").toUpperCase(),
      notes: params.notes?.trim() || null,
      sourceTaskId: params.sourceTaskId || null,
      sourceSagaId: params.sourceSagaId || null,
      targetTaskId: params.targetTaskId || null,
      targetSagaId: params.targetSagaId || null,
    },
    include: {
      sourceTask: { select: { number: true, name: true, projectId: true } },
      targetTask: { select: { number: true, name: true, projectId: true } },
      sourceSaga: { select: { number: true, name: true, projectId: true } },
      targetSaga: { select: { number: true, name: true, projectId: true } },
    },
  });

  // Alert PM so they can monitor / coordinate team leads
  if (params.notifyPm !== false) {
    const projectId =
      dep.targetTask?.projectId ||
      dep.sourceTask?.projectId ||
      dep.targetSaga?.projectId ||
      dep.sourceSaga?.projectId ||
      null;
    const src =
      dep.sourceTask?.number || dep.sourceSaga?.number || "source";
    const tgt =
      dep.targetTask?.number || dep.targetSaga?.number || "target";
    await prisma.engAlert.create({
      data: {
        type: "DEPENDENCY_CREATED",
        title: `Dependency: ${src} → ${tgt}`,
        body:
          params.notes ||
          `${src} must finish before ${tgt} can complete. Review with team leads.`,
        projectId,
        engTaskId: params.targetTaskId || params.sourceTaskId || null,
        sagaId: params.targetSagaId || params.sourceSagaId || null,
        dependencyId: dep.id,
      },
    });
  }

  return dep;
}

// ── Swim lane admin ───────────────────────────────────────────

export async function ensureDefaultSwimLanes() {
  for (const lane of DEFAULT_ENG_LANES) {
    await prisma.engSwimLane.upsert({
      where: { code: lane.code },
      create: {
        code: lane.code,
        name: lane.name,
        description: "description" in lane ? (lane as { description?: string }).description : null,
        sortOrder: lane.sortOrder,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function listSwimLanes(activeOnly = true) {
  await ensureDefaultSwimLanes();
  return prisma.engSwimLane.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createSwimLane(params: {
  code: string;
  name: string;
  description?: string | null;
  color?: string | null;
}) {
  const code = params.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const name = params.name.trim();
  if (!code || !name) throw new Error("Lane code and name required");
  const max = await prisma.engSwimLane.aggregate({ _max: { sortOrder: true } });
  return prisma.engSwimLane.create({
    data: {
      code,
      name,
      description: params.description?.trim() || null,
      color: params.color || null,
      sortOrder: (max._max.sortOrder || 0) + 1,
      isSystem: false,
      isActive: true,
    },
  });
}

/** Soft-delete (deactivate). System lanes may be deactivated but not hard-deleted. */
export async function removeSwimLane(params: {
  id?: string;
  code?: string;
  hardDelete?: boolean;
}) {
  const lane = params.id
    ? await prisma.engSwimLane.findUnique({ where: { id: params.id } })
    : await prisma.engSwimLane.findUnique({
        where: { code: params.code!.toUpperCase() },
      });
  if (!lane) throw new Error("Swim lane not found");
  if (params.hardDelete && !lane.isSystem) {
    return prisma.engSwimLane.delete({ where: { id: lane.id } });
  }
  return prisma.engSwimLane.update({
    where: { id: lane.id },
    data: { isActive: false },
  });
}

export async function listPmAlerts(params?: {
  projectId?: string;
  unreadOnly?: boolean;
}) {
  return prisma.engAlert.findMany({
    where: {
      ...(params?.projectId ? { projectId: params.projectId } : {}),
      ...(params?.unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markAlertRead(id: string) {
  return prisma.engAlert.update({
    where: { id },
    data: { isRead: true },
  });
}

export async function removeEngDependency(id: string) {
  return prisma.engDependency.delete({ where: { id } });
}

export async function listDependenciesForDiscipline(discipline: string) {
  // All deps where source or target involves this discipline's work
  const sagas = await prisma.saga.findMany({
    where: { discipline },
    select: { id: true },
  });
  const sagaIds = sagas.map((s) => s.id);
  const tasks = await prisma.engTask.findMany({
    where: {
      OR: [{ discipline }, { sagaId: { in: sagaIds } }],
    },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);

  return prisma.engDependency.findMany({
    where: {
      OR: [
        { sourceTaskId: { in: taskIds } },
        { targetTaskId: { in: taskIds } },
        { sourceSagaId: { in: sagaIds } },
        { targetSagaId: { in: sagaIds } },
      ],
    },
    include: {
      sourceTask: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          discipline: true,
        },
      },
      targetTask: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          discipline: true,
        },
      },
      sourceSaga: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          discipline: true,
        },
      },
      targetSaga: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          discipline: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getUnresolvedBlockersForTask(taskId: string) {
  const deps = await prisma.engDependency.findMany({
    where: { targetTaskId: taskId },
    include: {
      sourceTask: { select: { number: true, name: true, status: true } },
      sourceSaga: { select: { number: true, name: true, status: true } },
    },
  });
  const out: { label: string }[] = [];
  for (const d of deps) {
    if (d.sourceTask && d.sourceTask.status !== "DONE") {
      out.push({
        label: `${d.sourceTask.number} ${d.sourceTask.name} (${d.sourceTask.status})`,
      });
    }
    if (d.sourceSaga && d.sourceSaga.status !== "DONE") {
      out.push({
        label: `${d.sourceSaga.number} ${d.sourceSaga.name} (${d.sourceSaga.status})`,
      });
    }
  }
  return out;
}

// ── Sprints ───────────────────────────────────────────────────

export async function createEngSprint(params: {
  name: string;
  goal?: string | null;
  discipline?: string | null;
  projectId?: string | null;
  quarterId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  createdByPmo?: boolean;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Sprint name required");
  return prisma.engSprint.create({
    data: {
      name,
      goal: params.goal?.trim() || null,
      discipline: params.discipline?.toUpperCase() || null,
      projectId: params.projectId || null,
      quarterId: params.quarterId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      status: "PLANNED",
      createdByPmo: params.createdByPmo !== false,
    },
  });
}

export async function updateEngSprint(params: {
  id: string;
  status?: string;
  name?: string;
  goal?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}) {
  return prisma.engSprint.update({
    where: { id: params.id },
    data: {
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.goal !== undefined ? { goal: params.goal } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
    },
  });
}

export async function listEngSprints(params?: {
  discipline?: string;
  projectId?: string;
  quarterId?: string;
}) {
  return prisma.engSprint.findMany({
    where: {
      ...(params?.discipline
        ? {
            OR: [{ discipline: params.discipline }, { discipline: null }],
          }
        : {}),
      ...(params?.projectId ? { projectId: params.projectId } : {}),
      ...(params?.quarterId ? { quarterId: params.quarterId } : {}),
    },
    include: {
      _count: { select: { engTasks: true, sagas: true } },
      quarter: { select: { id: true, code: true, name: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });
}

export async function assignTaskToSprint(params: {
  engTaskId: string;
  engSprintId: string | null;
}) {
  return prisma.engTask.update({
    where: { id: params.engTaskId },
    data: { engSprintId: params.engSprintId },
  });
}

export async function assignSagaToSprint(params: {
  sagaId: string;
  engSprintId: string | null;
}) {
  return prisma.saga.update({
    where: { id: params.sagaId },
    data: { engSprintId: params.engSprintId },
  });
}

/** Full board payload for one swim lane. */
export async function getDisciplineBoard(discipline: string) {
  const d = discipline.toUpperCase();
  await ensureDefaultSwimLanes();
  const lane = await prisma.engSwimLane.findUnique({ where: { code: d } });
  if (!lane || !lane.isActive) {
    throw new Error(`Unknown or inactive swim lane: ${discipline}`);
  }

  const [sagas, tasks, sprints, dependencies, openScans, productionIssues] =
    await Promise.all([
      prisma.saga.findMany({
        where: { discipline: d },
        include: {
          campaign: {
            select: { id: true, number: true, name: true, projectId: true },
          },
          project: { select: { id: true, number: true, name: true } },
          engSprint: { select: { id: true, name: true, status: true } },
          engTasks: {
            where: { parentId: null },
            include: {
              children: {
                orderBy: { number: "asc" },
              },
              product: { select: { id: true, code: true, name: true } },
              requirementTraces: {
                select: {
                  requirement: { select: { number: true, status: true } },
                },
              },
              productionIssue: {
                select: {
                  id: true,
                  number: true,
                  category: true,
                  status: true,
                  workOrder: { select: { number: true } },
                },
              },
              blockedBy: {
                include: {
                  sourceTask: {
                    select: {
                      id: true,
                      number: true,
                      name: true,
                      status: true,
                      discipline: true,
                    },
                  },
                  sourceSaga: {
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
            orderBy: { number: "asc" },
          },
          blockedBy: {
            include: {
              sourceTask: {
                select: {
                  id: true,
                  number: true,
                  name: true,
                  status: true,
                  discipline: true,
                },
              },
              sourceSaga: {
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
        orderBy: { updatedAt: "desc" },
      }),
      prisma.engTask.findMany({
        where: {
          parentId: null,
          OR: [{ discipline: d }, { saga: { discipline: d } }],
        },
        include: {
          children: { orderBy: { number: "asc" } },
          product: { select: { id: true, code: true, name: true } },
          productionIssue: {
            select: {
              id: true,
              number: true,
              category: true,
              status: true,
              workOrder: { select: { number: true } },
            },
          },
          saga: {
            select: {
              id: true,
              number: true,
              name: true,
              discipline: true,
            },
          },
          campaign: { select: { id: true, number: true, name: true } },
          engSprint: { select: { id: true, name: true, status: true } },
          blockedBy: {
            include: {
              sourceTask: {
                select: {
                  id: true,
                  number: true,
                  name: true,
                  status: true,
                  discipline: true,
                },
              },
              sourceSaga: {
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
        orderBy: { updatedAt: "desc" },
      }),
      listEngSprints({ discipline: d }),
      listDependenciesForDiscipline(d),
      prisma.workTimeScan.findMany({
        where: {
          status: "OPEN",
          engTask: {
            OR: [{ discipline: d }, { saga: { discipline: d } }],
          },
        },
        include: {
          engTask: {
            select: {
              id: true,
              number: true,
              name: true,
              discipline: true,
              status: true,
            },
          },
        },
      }),
      d === "MFG_ENG"
        ? listProductionEngIssues({ openOnly: true })
        : Promise.resolve([]),
    ]);

  // Attach user names for scanners
  const userIds = [...new Set(openScans.map((s) => s.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const openScansNamed = openScans.map((s) => ({
    ...s,
    userName: userMap[s.userId] || "Engineer",
  }));

  return {
    discipline: d,
    laneName: lane.name,
    sagas,
    tasks,
    sprints,
    dependencies,
    openScans: openScansNamed,
    productionIssues,
  };
}

// ── Scan-in / scan-out time ───────────────────────────────────

export async function scanIntoTask(params: {
  engTaskId: string;
  userId: string;
  notes?: string | null;
}) {
  const task = await prisma.engTask.findUnique({
    where: { id: params.engTaskId },
  });
  if (!task) throw new Error("Task not found");

  // Close any open scan for this user on *other* tasks (one focus task per person)
  const openOther = await prisma.workTimeScan.findMany({
    where: {
      userId: params.userId,
      status: "OPEN",
      engTaskId: { not: params.engTaskId },
    },
  });
  for (const s of openOther) {
    await scanOutOfTask({ scanId: s.id, userId: params.userId });
  }

  // Already scanned into this task?
  const already = await prisma.workTimeScan.findFirst({
    where: {
      engTaskId: params.engTaskId,
      userId: params.userId,
      status: "OPEN",
    },
  });
  if (already) return already;

  // Multiple people may scan into the same task
  const scan = await prisma.workTimeScan.create({
    data: {
      engTaskId: params.engTaskId,
      userId: params.userId,
      notes: params.notes?.trim() || null,
      status: "OPEN",
    },
  });

  // Auto-move to In Progress when anyone scans in (from backlog/todo)
  const nextStatus =
    task.status === "TODO" ||
    task.status === "BACKLOG" ||
    task.status === "PLANNED"
      ? "IN_PROGRESS"
      : task.status;

  await prisma.engTask.update({
    where: { id: params.engTaskId },
    data: {
      // Keep denormalized "first scanner" for quick UI; multi-user via WorkTimeScan
      activeScanUserId: task.activeScanUserId || params.userId,
      activeScanAt: task.activeScanAt || new Date(),
      status: nextStatus,
    },
  });

  // If saga is still backlog, nudge to in progress
  if (task.sagaId) {
    const saga = await prisma.saga.findUnique({ where: { id: task.sagaId } });
    if (saga && ["BACKLOG", "TODO", "PLANNED"].includes(saga.status)) {
      await prisma.saga.update({
        where: { id: task.sagaId },
        data: { status: "IN_PROGRESS" },
      });
    }
  }

  return scan;
}

export async function scanOutOfTask(params: {
  scanId?: string;
  engTaskId?: string;
  userId: string;
  notes?: string | null;
}) {
  let scan = params.scanId
    ? await prisma.workTimeScan.findUnique({ where: { id: params.scanId } })
    : await prisma.workTimeScan.findFirst({
        where: {
          engTaskId: params.engTaskId,
          userId: params.userId,
          status: "OPEN",
        },
      });
  if (!scan) throw new Error("No open scan session found");
  if (scan.userId !== params.userId) throw new Error("Not your scan session");
  if (scan.status !== "OPEN") throw new Error("Scan already closed");

  const out = new Date();
  const ms = out.getTime() - new Date(scan.scannedInAt).getTime();
  const hours = Math.max(0.01, Math.round((ms / 3600000) * 100) / 100);

  scan = await prisma.workTimeScan.update({
    where: { id: scan.id },
    data: {
      scannedOutAt: out,
      hours,
      status: "CLOSED",
      notes: params.notes?.trim() || scan.notes,
    },
  });

  const task = await prisma.engTask.findUnique({
    where: { id: scan.engTaskId },
  });
  if (!task) return scan;

  // Post time entry + cost
  const laborRate = DEFAULT_LABOR_RATE;
  const costAmount = hours * laborRate;
  let productId = task.productId;
  if (!productId && task.projectId) {
    productId =
      (
        await prisma.project.findUnique({
          where: { id: task.projectId },
          select: { productId: true },
        })
      )?.productId || null;
  }

  const scanEntry = await prisma.timeEntry.create({
    data: {
      userId: params.userId,
      projectId: task.projectId,
      campaignId: task.campaignId,
      sagaId: task.sagaId,
      engTaskId: task.id,
      date: out,
      hours,
      type: "ENG_SCAN",
      description: `Scan: ${task.number} ${task.name}`,
      status: "APPROVED",
      laborRate,
      costAmount,
    },
  });
  // Scanning a job auto-opens the current period's timesheet and files
  // the time there (timesheets only open once their period starts).
  {
    const { attachEntryToTimesheet } = await import(
      "@/lib/services/timesheets"
    );
    await attachEntryToTimesheet(scanEntry.id);
  }

  // Cost entry for project/product NRE (requires a project for ProjectCostEntry)
  if (task.projectId) {
    await prisma.projectCostEntry.create({
      data: {
        projectId: task.projectId,
        productId,
        category: "LABOR",
        description: `Eng scan ${task.number}: ${task.name}`,
        amount: costAmount,
        hours,
        entryDate: out,
        source: "ENG_SCAN",
      },
    });
  } else if (productId) {
    // Product-only sustainment: roll cost directly onto product actuals
    await prisma.product.update({
      where: { id: productId },
      data: { developmentActual: { increment: costAmount } },
    });
  }

  // Clear denormalized active scan only when no one else is still scanned in
  const stillOpen = await prisma.workTimeScan.count({
    where: { engTaskId: task.id, status: "OPEN" },
  });
  const remaining = stillOpen
    ? await prisma.workTimeScan.findFirst({
        where: { engTaskId: task.id, status: "OPEN" },
        orderBy: { scannedInAt: "asc" },
      })
    : null;

  await prisma.engTask.update({
    where: { id: task.id },
    data: {
      actualHours: { increment: hours },
      activeScanUserId: remaining?.userId || null,
      activeScanAt: remaining?.scannedInAt || null,
    },
  });

  await rollupHoursFromTask(task.id);

  // Refresh product/project development actuals
  try {
    const { recomputeProjectDevelopmentCost, recomputeProductDevelopmentCost } =
      await import("@/lib/services/pmo");
    if (task.projectId) await recomputeProjectDevelopmentCost(task.projectId);
    if (productId) await recomputeProductDevelopmentCost(productId);
  } catch {
    /* optional */
  }

  return scan;
}

async function rollupHoursFromTask(engTaskId: string) {
  const task = await prisma.engTask.findUnique({
    where: { id: engTaskId },
  });
  if (!task) return;

  if (task.sagaId) {
    const sum = await prisma.engTask.aggregate({
      where: { sagaId: task.sagaId },
      _sum: { actualHours: true, estimatedHours: true, storyPoints: true },
    });
    const done = await prisma.engTask.count({
      where: { sagaId: task.sagaId, status: "DONE" },
    });
    const total = await prisma.engTask.count({
      where: { sagaId: task.sagaId },
    });
    await prisma.saga.update({
      where: { id: task.sagaId },
      data: {
        actualHours: sum._sum.actualHours || 0,
        percentComplete: total ? Math.round((done / total) * 100) : 0,
      },
    });
  }

  if (task.campaignId) {
    const sum = await prisma.engTask.aggregate({
      where: { campaignId: task.campaignId },
      _sum: { actualHours: true },
    });
    const done = await prisma.engTask.count({
      where: { campaignId: task.campaignId, status: "DONE" },
    });
    const total = await prisma.engTask.count({
      where: { campaignId: task.campaignId },
    });
    await prisma.campaign.update({
      where: { id: task.campaignId },
      data: {
        actualHours: sum._sum.actualHours || 0,
        percentComplete: total ? Math.round((done / total) * 100) : 0,
      },
    });
  }
}

// ── WBS ───────────────────────────────────────────────────────

export async function createWbsElement(params: {
  projectId: string;
  parentId?: string | null;
  code: string;
  name: string;
  kind?: string;
  description?: string | null;
  deliverables?: string | null;
  acceptanceCriteria?: string | null;
  assumptions?: string | null;
  constraints?: string | null;
  resources?: string | null;
  budgetCost?: number;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  sortOrder?: number;
}) {
  const code = params.code.trim().toUpperCase();
  const name = params.name.trim();
  if (!code || !name) throw new Error("WBS code and name required");

  let level = 0;
  if (params.parentId) {
    const parent = await prisma.wbsElement.findUnique({
      where: { id: params.parentId },
    });
    if (!parent) throw new Error("Parent WBS not found");
    level = parent.level + 1;
  }

  const siblings = await prisma.wbsElement.count({
    where: {
      projectId: params.projectId,
      parentId: params.parentId || null,
    },
  });

  return prisma.wbsElement.create({
    data: {
      projectId: params.projectId,
      parentId: params.parentId || null,
      code,
      name,
      kind: (params.kind || "WORK_PACKAGE").toUpperCase(),
      description: params.description?.trim() || null,
      deliverables: params.deliverables?.trim() || null,
      acceptanceCriteria: params.acceptanceCriteria?.trim() || null,
      assumptions: params.assumptions?.trim() || null,
      constraints: params.constraints?.trim() || null,
      resources: params.resources?.trim() || null,
      budgetCost: params.budgetCost ?? 0,
      ownerId: params.ownerId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      level,
      sortOrder: params.sortOrder ?? siblings,
    },
  });
}

export async function updateWbsElement(params: {
  id: string;
  name?: string;
  code?: string;
  kind?: string;
  description?: string | null;
  deliverables?: string | null;
  acceptanceCriteria?: string | null;
  assumptions?: string | null;
  constraints?: string | null;
  resources?: string | null;
  notes?: string | null;
  status?: string;
  budgetCost?: number;
  actualCost?: number;
  percentComplete?: number;
  ownerId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}) {
  return prisma.wbsElement.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.code !== undefined ? { code: params.code.trim().toUpperCase() } : {}),
      ...(params.kind ? { kind: params.kind.toUpperCase() } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.deliverables !== undefined
        ? { deliverables: params.deliverables }
        : {}),
      ...(params.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: params.acceptanceCriteria }
        : {}),
      ...(params.assumptions !== undefined
        ? { assumptions: params.assumptions }
        : {}),
      ...(params.constraints !== undefined
        ? { constraints: params.constraints }
        : {}),
      ...(params.resources !== undefined ? { resources: params.resources } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.budgetCost !== undefined ? { budgetCost: params.budgetCost } : {}),
      ...(params.actualCost !== undefined ? { actualCost: params.actualCost } : {}),
      ...(params.percentComplete !== undefined
        ? { percentComplete: params.percentComplete }
        : {}),
      ...(params.ownerId !== undefined ? { ownerId: params.ownerId || null } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
    },
  });
}

export async function getWbsTree(projectId: string) {
  return prisma.wbsElement.findMany({
    where: { projectId },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    include: {
      campaigns: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          percentComplete: true,
        },
      },
      _count: { select: { children: true, campaigns: true, tasks: true } },
    },
  });
}

export async function getWbsDetail(id: string) {
  return prisma.wbsElement.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, number: true, name: true } },
      parent: true,
      children: {
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        include: {
          _count: { select: { children: true, campaigns: true } },
          campaigns: {
            select: { id: true, number: true, name: true, status: true },
          },
        },
      },
      campaigns: {
        include: {
          sagas: {
            include: {
              _count: { select: { engTasks: true } },
            },
          },
        },
        orderBy: { number: "asc" },
      },
      tasks: { orderBy: { name: "asc" }, take: 50 },
    },
  });
}

// ── Board / reports queries ───────────────────────────────────

export async function listCampaignsForProject(projectId: string) {
  return prisma.campaign.findMany({
    where: { projectId },
    include: {
      wbsElement: { select: { id: true, code: true, name: true } },
      sagas: {
        include: {
          engTasks: {
            where: { parentId: null },
            include: { children: true },
            orderBy: { number: "asc" },
          },
        },
        orderBy: { number: "asc" },
      },
      _count: { select: { sagas: true, engTasks: true } },
    },
    orderBy: { number: "asc" },
  });
}

export async function listSagasByDiscipline(params?: {
  projectId?: string;
  discipline?: string;
}) {
  return prisma.saga.findMany({
    where: {
      ...(params?.projectId ? { projectId: params.projectId } : {}),
      ...(params?.discipline ? { discipline: params.discipline } : {}),
    },
    include: {
      campaign: {
        select: { id: true, number: true, name: true, projectId: true },
      },
      engTasks: {
        where: { parentId: null },
        include: {
          children: true,
        },
        orderBy: { number: "asc" },
      },
      project: { select: { id: true, number: true, name: true } },
      engSprint: { select: { id: true, name: true, status: true } },
      _count: { select: { engTasks: true } },
    },
    orderBy: [{ discipline: "asc" }, { updatedAt: "desc" }],
  });
}

/** Counts per discipline for the engineering hub. */
export async function getDisciplineSummaries() {
  const lanes = await listSwimLanes(true);
  const sagas = await prisma.saga.groupBy({
    by: ["discipline", "status"],
    _count: true,
  });
  const tasks = await prisma.engTask.groupBy({
    by: ["discipline", "status"],
    _count: true,
  });

  return lanes.map((lane) => {
    const d = lane.code;
    const sagaRows = sagas.filter((s) => s.discipline === d);
    const taskRows = tasks.filter((t) => t.discipline === d);
    const sagaTotal = sagaRows.reduce((a, r) => a + r._count, 0);
    const sagaDone = sagaRows
      .filter((r) => r.status === "DONE")
      .reduce((a, r) => a + r._count, 0);
    const sagaInProgress = sagaRows
      .filter((r) => r.status === "IN_PROGRESS")
      .reduce((a, r) => a + r._count, 0);
    const sagaBlocked = sagaRows
      .filter((r) => r.status === "BLOCKED")
      .reduce((a, r) => a + r._count, 0);
    const taskTotal = taskRows.reduce((a, r) => a + r._count, 0);
    const taskTodo = taskRows
      .filter((r) => ["TODO", "BACKLOG"].includes(r.status))
      .reduce((a, r) => a + r._count, 0);
    return {
      discipline: d,
      name: lane.name,
      sagaTotal,
      sagaDone,
      sagaInProgress,
      sagaBlocked,
      taskTotal,
      taskTodo,
    };
  });
}

export async function getBurndownData(projectId: string) {
  const [campaigns, sagas, tasks, costEntries] = await Promise.all([
    prisma.campaign.findMany({ where: { projectId } }),
    prisma.saga.findMany({ where: { projectId } }),
    prisma.engTask.findMany({ where: { projectId } }),
    prisma.projectCostEntry.findMany({
      where: { projectId },
      orderBy: { entryDate: "asc" },
    }),
  ]);

  const totalPoints =
    campaigns.reduce((s, c) => s + (c.storyPoints || 0), 0) ||
    tasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const donePoints = tasks
    .filter((t) => t.status === "DONE")
    .reduce((s, t) => s + (t.storyPoints || 0), 0);
  const remainingPoints = Math.max(0, totalPoints - donePoints);

  const totalEstHours =
    tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0) ||
    campaigns.reduce((s, c) => s + (c.estimatedHours || 0), 0);
  const totalActHours = tasks.reduce((s, t) => s + (t.actualHours || 0), 0);

  // Ideal burndown: linear from start to end of project
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  const start = project?.startDate
    ? new Date(project.startDate)
    : new Date(Date.now() - 30 * 86400000);
  const end = project?.endDate
    ? new Date(project.endDate)
    : new Date(Date.now() + 30 * 86400000);
  const days = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / 86400000)
  );
  const today = new Date();
  const dayIndex = Math.min(
    days,
    Math.max(0, Math.ceil((today.getTime() - start.getTime()) / 86400000))
  );

  // Build cumulative done points by day from task updates (approx using updatedAt when DONE)
  const doneTasks = tasks
    .filter((t) => t.status === "DONE")
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
  const burnSeries: { day: number; date: string; remaining: number; ideal: number }[] =
    [];
  let burned = 0;
  for (let d = 0; d <= days; d++) {
    const date = new Date(start.getTime() + d * 86400000);
    const dateStr = date.toISOString().slice(0, 10);
    while (
      doneTasks.length &&
      new Date(doneTasks[0].updatedAt) <=
        new Date(date.getTime() + 86400000 - 1)
    ) {
      const t = doneTasks.shift()!;
      burned += t.storyPoints || 0;
    }
    const ideal = totalPoints * (1 - d / days);
    burnSeries.push({
      day: d,
      date: dateStr,
      remaining: Math.max(0, totalPoints - burned),
      ideal: Math.max(0, ideal),
    });
  }

  // Cost burn
  let costRun = 0;
  const costSeries = costEntries.map((e) => {
    costRun += e.amount;
    return {
      date: new Date(e.entryDate).toISOString().slice(0, 10),
      cumulative: costRun,
      amount: e.amount,
      category: e.category,
    };
  });

  const byDiscipline: Record<
    string,
    { total: number; done: number; inProgress: number; blocked: number }
  > = {};
  for (const s of sagas) {
    const d = s.discipline || "OTHER";
    if (!byDiscipline[d]) {
      byDiscipline[d] = { total: 0, done: 0, inProgress: 0, blocked: 0 };
    }
    byDiscipline[d].total++;
    if (s.status === "DONE") byDiscipline[d].done++;
    if (s.status === "IN_PROGRESS") byDiscipline[d].inProgress++;
    if (s.status === "BLOCKED") byDiscipline[d].blocked++;
  }

  return {
    totalPoints,
    donePoints,
    remainingPoints,
    totalEstHours,
    totalActHours,
    dayIndex,
    days,
    burnSeries,
    costSeries,
    byDiscipline,
    campaignCount: campaigns.length,
    sagaCount: sagas.length,
    taskCount: tasks.length,
    tasksDone: tasks.filter((t) => t.status === "DONE").length,
    tasksBlocked: tasks.filter((t) => t.status === "BLOCKED").length,
    developmentBudget: project?.developmentBudget || 0,
    developmentActual: project?.developmentActual || 0,
  };
}

export async function listOpenScans(userId?: string) {
  return prisma.workTimeScan.findMany({
    where: {
      status: "OPEN",
      ...(userId ? { userId } : {}),
    },
    include: {
      engTask: {
        select: {
          id: true,
          number: true,
          name: true,
          projectId: true,
          project: { select: { number: true, name: true } },
        },
      },
    },
  });
}
