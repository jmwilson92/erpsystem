import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const METHODOLOGIES = ["WATERFALL", "AGILE", "HYBRID"] as const;
export const PROJECT_PHASES = [
  "INITIATION",
  "PLANNING",
  "EXECUTION",
  "MONITORING",
  "CLOSURE",
] as const;
export const MILESTONE_KINDS = [
  "PDR",
  "CDR",
  "SRR",
  "TRR",
  "FAI",
  "GATE",
  "RELEASE",
  "OTHER",
] as const;

function riskScore(probability: string, impact: string): number {
  const map: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return (map[probability.toUpperCase()] || 2) * (map[impact.toUpperCase()] || 2);
}

async function nextProgramCode(): Promise<string> {
  const n = await prisma.program.count();
  for (let i = 0; i < 20; i++) {
    const code = `PRG-${String(n + 1 + i).padStart(3, "0")}`;
    if (!(await prisma.program.findUnique({ where: { code } }))) return code;
  }
  return `PRG-${Date.now().toString(36).toUpperCase()}`;
}

async function nextProjectNumber(): Promise<string> {
  const n = await prisma.project.count();
  for (let i = 0; i < 20; i++) {
    const number = `PRJ-${String(n + 1 + i).padStart(4, "0")}`;
    if (!(await prisma.project.findUnique({ where: { number } }))) return number;
  }
  return `PRJ-${Date.now().toString(36).toUpperCase()}`;
}

// ── Programs ──────────────────────────────────────────────────

export async function createProgram(params: {
  code?: string | null;
  name: string;
  description?: string | null;
  portfolio?: string | null;
  ownerId?: string | null;
  budgetCost?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Program name required");
  const code = params.code?.trim().toUpperCase() || (await nextProgramCode());
  const program = await prisma.program.create({
    data: {
      code,
      name,
      description: params.description?.trim() || null,
      portfolio: params.portfolio?.trim() || null,
      ownerId: params.ownerId || null,
      budgetCost: params.budgetCost ?? 0,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Program",
    entityId: program.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { code, name },
  });
  return program;
}

export async function updateProgram(params: {
  id: string;
  name?: string;
  description?: string | null;
  portfolio?: string | null;
  status?: string;
  ownerId?: string | null;
  budgetCost?: number;
  actualCost?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
  userId?: string | null;
}) {
  return prisma.program.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.portfolio !== undefined ? { portfolio: params.portfolio } : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.ownerId !== undefined ? { ownerId: params.ownerId || null } : {}),
      ...(params.budgetCost !== undefined ? { budgetCost: params.budgetCost } : {}),
      ...(params.actualCost !== undefined ? { actualCost: params.actualCost } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });
}

export async function listPrograms() {
  return prisma.program.findMany({
    include: {
      owner: { select: { id: true, name: true } },
      projects: {
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          budgetCost: true,
          actualCost: true,
          percentComplete: true,
          productId: true,
        },
        orderBy: { number: "asc" },
      },
      _count: { select: { projects: true } },
    },
    orderBy: { name: "asc" },
  });
}

// ── Projects ──────────────────────────────────────────────────

export async function createProject(params: {
  number?: string | null;
  name: string;
  description?: string | null;
  programId?: string | null;
  productId?: string | null;
  methodology?: string;
  phase?: string;
  status?: string;
  customerName?: string | null;
  contractValue?: number;
  budgetCost?: number;
  developmentBudget?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  sponsorId?: string | null;
  projectManagerId?: string | null;
  businessCase?: string | null;
  objectives?: string | null;
  scopeIn?: string | null;
  scopeOut?: string | null;
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Project name required");
  const number = params.number?.trim().toUpperCase() || (await nextProjectNumber());
  const methodology = (params.methodology || "HYBRID").toUpperCase();
  if (!METHODOLOGIES.includes(methodology as (typeof METHODOLOGIES)[number])) {
    throw new Error("Invalid methodology");
  }

  const project = await prisma.project.create({
    data: {
      number,
      name,
      description: params.description?.trim() || null,
      programId: params.programId || null,
      productId: params.productId || null,
      methodology,
      phase: (params.phase || "INITIATION").toUpperCase(),
      status: (params.status || "PLANNING").toUpperCase(),
      customerName: params.customerName?.trim() || null,
      contractValue: params.contractValue ?? 0,
      budgetCost: params.budgetCost ?? 0,
      developmentBudget: params.developmentBudget ?? 0,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      sponsorId: params.sponsorId || null,
      projectManagerId: params.projectManagerId || null,
      businessCase: params.businessCase?.trim() || null,
      objectives: params.objectives?.trim() || null,
      scopeIn: params.scopeIn?.trim() || null,
      scopeOut: params.scopeOut?.trim() || null,
      charterStatus: "DRAFT",
      wikiPages: {
        create: [
          {
            slug: "home",
            title: "Home",
            body: `# ${name}\n\nProject wiki home. Use this space like Confluence — meeting notes, decisions, design docs.\n`,
            sortOrder: 0,
          },
          {
            slug: "decisions",
            title: "Decision log",
            body: `# Decision log\n\n| Date | Decision | Owner |\n|------|----------|-------|\n| | | |\n`,
            sortOrder: 1,
          },
        ],
      },
      ...(params.productId
        ? {
            productLinks: {
              create: {
                productId: params.productId,
                role: "PRIMARY",
                syncRequirements: true,
                syncMilestones: true,
                syncCosts: true,
              },
            },
          }
        : {}),
    },
  });

  await logAudit({
    entityType: "Project",
    entityId: project.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, name, programId: params.programId, productId: params.productId },
  });
  return project;
}

export async function updateProjectCharter(params: {
  id: string;
  businessCase?: string | null;
  objectives?: string | null;
  scopeIn?: string | null;
  scopeOut?: string | null;
  successCriteria?: string | null;
  assumptions?: string | null;
  constraints?: string | null;
  deliverables?: string | null;
  stakeholdersSummary?: string | null;
  sponsorId?: string | null;
  projectManagerId?: string | null;
  methodology?: string;
  phase?: string;
  status?: string;
  charterStatus?: string;
  contractValue?: number;
  budgetCost?: number;
  developmentBudget?: number;
  customerName?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  productId?: string | null;
  programId?: string | null;
  name?: string;
  description?: string | null;
  userId?: string | null;
}) {
  const data: Record<string, unknown> = {};
  const strs = [
    "businessCase",
    "objectives",
    "scopeIn",
    "scopeOut",
    "successCriteria",
    "assumptions",
    "constraints",
    "deliverables",
    "stakeholdersSummary",
    "customerName",
    "description",
  ] as const;
  for (const k of strs) {
    if (params[k] !== undefined) data[k] = params[k];
  }
  if (params.name !== undefined) data.name = params.name.trim();
  if (params.sponsorId !== undefined) data.sponsorId = params.sponsorId || null;
  if (params.projectManagerId !== undefined)
    data.projectManagerId = params.projectManagerId || null;
  if (params.methodology)
    data.methodology = params.methodology.toUpperCase();
  if (params.phase) data.phase = params.phase.toUpperCase();
  if (params.status) data.status = params.status.toUpperCase();
  if (params.charterStatus) {
    data.charterStatus = params.charterStatus.toUpperCase();
    if (params.charterStatus.toUpperCase() === "APPROVED") {
      data.charterApprovedAt = new Date();
    }
  }
  if (params.contractValue !== undefined) data.contractValue = params.contractValue;
  if (params.budgetCost !== undefined) data.budgetCost = params.budgetCost;
  if (params.developmentBudget !== undefined)
    data.developmentBudget = params.developmentBudget;
  if (params.startDate !== undefined) data.startDate = params.startDate;
  if (params.endDate !== undefined) data.endDate = params.endDate;
  if (params.productId !== undefined) data.productId = params.productId || null;
  if (params.programId !== undefined) data.programId = params.programId || null;

  const project = await prisma.project.update({
    where: { id: params.id },
    data,
  });

  // Keep primary product link in sync
  if (params.productId !== undefined) {
    if (params.productId) {
      await prisma.projectProduct.upsert({
        where: {
          projectId_productId: {
            projectId: params.id,
            productId: params.productId,
          },
        },
        create: {
          projectId: params.id,
          productId: params.productId,
          role: "PRIMARY",
        },
        update: { role: "PRIMARY" },
      });
    }
  }

  return project;
}

// ── Risks / Issues ────────────────────────────────────────────

export async function addProjectRisk(params: {
  projectId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  probability?: string;
  impact?: string;
  mitigation?: string | null;
  contingency?: string | null;
  residualRisk?: string | null;
  ownerId?: string | null;
  targetDate?: Date | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Risk title required");
  const probability = (params.probability || "MEDIUM").toUpperCase();
  const impact = (params.impact || "MEDIUM").toUpperCase();
  const count = await prisma.projectRisk.count({
    where: { projectId: params.projectId },
  });
  return prisma.projectRisk.create({
    data: {
      projectId: params.projectId,
      number: `RSK-${String(count + 1).padStart(3, "0")}`,
      title,
      description: params.description?.trim() || null,
      category: params.category?.trim().toUpperCase() || null,
      probability,
      impact,
      score: riskScore(probability, impact),
      mitigation: params.mitigation?.trim() || null,
      contingency: params.contingency?.trim() || null,
      residualRisk: params.residualRisk?.trim() || null,
      ownerId: params.ownerId || null,
      targetDate: params.targetDate || null,
      status: "OPEN",
    },
  });
}

export async function updateProjectRisk(params: {
  id: string;
  status?: string;
  mitigation?: string | null;
  contingency?: string | null;
  residualRisk?: string | null;
  probability?: string;
  impact?: string;
  title?: string;
}) {
  const existing = await prisma.projectRisk.findUnique({ where: { id: params.id } });
  if (!existing) throw new Error("Risk not found");
  const probability = params.probability?.toUpperCase() || existing.probability;
  const impact = params.impact?.toUpperCase() || existing.impact;
  return prisma.projectRisk.update({
    where: { id: params.id },
    data: {
      ...(params.title !== undefined ? { title: params.title.trim() } : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.mitigation !== undefined ? { mitigation: params.mitigation } : {}),
      ...(params.contingency !== undefined
        ? { contingency: params.contingency }
        : {}),
      ...(params.residualRisk !== undefined
        ? { residualRisk: params.residualRisk }
        : {}),
      probability,
      impact,
      score: riskScore(probability, impact),
    },
  });
}

export async function addProjectIssue(params: {
  projectId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: string;
  ownerId?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Issue title required");
  const count = await prisma.projectIssue.count({
    where: { projectId: params.projectId },
  });
  return prisma.projectIssue.create({
    data: {
      projectId: params.projectId,
      number: `ISS-${String(count + 1).padStart(3, "0")}`,
      title,
      description: params.description?.trim() || null,
      category: params.category?.trim() || null,
      priority: (params.priority || "NORMAL").toUpperCase(),
      ownerId: params.ownerId || null,
      status: "OPEN",
    },
  });
}

export async function updateProjectIssue(params: {
  id: string;
  status?: string;
  resolution?: string | null;
  priority?: string;
  title?: string;
}) {
  const data: Record<string, unknown> = {};
  if (params.title !== undefined) data.title = params.title.trim();
  if (params.status) {
    data.status = params.status.toUpperCase();
    if (["RESOLVED", "CLOSED"].includes(params.status.toUpperCase())) {
      data.resolvedAt = new Date();
    }
  }
  if (params.resolution !== undefined) data.resolution = params.resolution;
  if (params.priority) data.priority = params.priority.toUpperCase();
  return prisma.projectIssue.update({ where: { id: params.id }, data });
}

// ── RACI / Communications ─────────────────────────────────────

export async function upsertRaciEntry(params: {
  id?: string;
  projectId: string;
  activity: string;
  responsible?: string | null;
  accountable?: string | null;
  consulted?: string | null;
  informed?: string | null;
  notes?: string | null;
}) {
  const activity = params.activity.trim();
  if (!activity) throw new Error("Activity required");
  if (params.id) {
    return prisma.projectRaciEntry.update({
      where: { id: params.id },
      data: {
        activity,
        responsible: params.responsible?.trim() || null,
        accountable: params.accountable?.trim() || null,
        consulted: params.consulted?.trim() || null,
        informed: params.informed?.trim() || null,
        notes: params.notes?.trim() || null,
      },
    });
  }
  const count = await prisma.projectRaciEntry.count({
    where: { projectId: params.projectId },
  });
  return prisma.projectRaciEntry.create({
    data: {
      projectId: params.projectId,
      activity,
      responsible: params.responsible?.trim() || null,
      accountable: params.accountable?.trim() || null,
      consulted: params.consulted?.trim() || null,
      informed: params.informed?.trim() || null,
      notes: params.notes?.trim() || null,
      sortOrder: count,
    },
  });
}

export async function deleteRaciEntry(id: string) {
  return prisma.projectRaciEntry.delete({ where: { id } });
}

export async function addCommunication(params: {
  projectId: string;
  audience: string;
  purpose?: string | null;
  frequency?: string | null;
  channel?: string | null;
  ownerName?: string | null;
  notes?: string | null;
}) {
  const audience = params.audience.trim();
  if (!audience) throw new Error("Audience required");
  const count = await prisma.projectCommunication.count({
    where: { projectId: params.projectId },
  });
  return prisma.projectCommunication.create({
    data: {
      projectId: params.projectId,
      audience,
      purpose: params.purpose?.trim() || null,
      frequency: params.frequency?.trim().toUpperCase() || null,
      channel: params.channel?.trim().toUpperCase() || null,
      ownerName: params.ownerName?.trim() || null,
      notes: params.notes?.trim() || null,
      sortOrder: count,
    },
  });
}

export async function deleteCommunication(id: string) {
  return prisma.projectCommunication.delete({ where: { id } });
}

// ── Tasks / Milestones / Schedule ─────────────────────────────

export async function addProjectTask(params: {
  projectId: string;
  name: string;
  description?: string | null;
  status?: string;
  priority?: string;
  kind?: string;
  storyPoints?: number | null;
  sprintLabel?: string | null;
  piIncrementId?: string | null;
  assigneeId?: string | null;
  wbsElementId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  estimatedHours?: number | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Task name required");
  return prisma.projectTask.create({
    data: {
      projectId: params.projectId,
      name,
      description: params.description?.trim() || null,
      status: (params.status || "TODO").toUpperCase(),
      priority: (params.priority || "NORMAL").toUpperCase(),
      kind: (params.kind || "TASK").toUpperCase(),
      storyPoints: params.storyPoints ?? null,
      sprintLabel: params.sprintLabel?.trim() || null,
      piIncrementId: params.piIncrementId || null,
      assigneeId: params.assigneeId || null,
      wbsElementId: params.wbsElementId || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      estimatedHours: params.estimatedHours ?? null,
    },
  });
}

export async function updateProjectTask(params: {
  id: string;
  status?: string;
  percentComplete?: number;
  actualHours?: number;
  name?: string;
  sprintLabel?: string | null;
  storyPoints?: number | null;
}) {
  return prisma.projectTask.update({
    where: { id: params.id },
    data: {
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.percentComplete !== undefined
        ? { percentComplete: params.percentComplete }
        : {}),
      ...(params.actualHours !== undefined ? { actualHours: params.actualHours } : {}),
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.sprintLabel !== undefined ? { sprintLabel: params.sprintLabel } : {}),
      ...(params.storyPoints !== undefined ? { storyPoints: params.storyPoints } : {}),
      ...(params.status?.toUpperCase() === "DONE" ? { percentComplete: 100 } : {}),
    },
  });
}

export async function addProjectMilestone(params: {
  projectId: string;
  name: string;
  kind?: string;
  dueDate?: Date | null;
  description?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Milestone name required");
  return prisma.milestone.create({
    data: {
      projectId: params.projectId,
      name,
      kind: (params.kind || "GATE").toUpperCase(),
      dueDate: params.dueDate || null,
      description: params.description?.trim() || null,
      status: "PENDING",
    },
  });
}

export async function updateProjectMilestone(params: {
  id: string;
  status?: string;
  actualDate?: Date | null;
  dueDate?: Date | null;
  name?: string;
}) {
  const ms = await prisma.milestone.update({
    where: { id: params.id },
    data: {
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.actualDate !== undefined ? { actualDate: params.actualDate } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.status?.toUpperCase() === "ACHIEVED" && !params.actualDate
        ? { actualDate: new Date() }
        : {}),
    },
  });
  return ms;
}

// ── Wiki ──────────────────────────────────────────────────────

export async function saveWikiPage(params: {
  id?: string;
  projectId: string;
  slug?: string;
  title: string;
  body?: string;
  parentId?: string | null;
  userId?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Page title required");
  const slug =
    params.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") ||
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) ||
    "page";

  if (params.id) {
    return prisma.projectWikiPage.update({
      where: { id: params.id },
      data: {
        title,
        body: params.body ?? "",
        parentId: params.parentId !== undefined ? params.parentId : undefined,
        updatedById: params.userId || null,
      },
    });
  }

  return prisma.projectWikiPage.create({
    data: {
      projectId: params.projectId,
      slug,
      title,
      body: params.body ?? "",
      parentId: params.parentId || null,
      updatedById: params.userId || null,
    },
  });
}

export async function deleteWikiPage(id: string) {
  return prisma.projectWikiPage.delete({ where: { id } });
}

// ── PI Planning ───────────────────────────────────────────────

export async function createPiIncrement(params: {
  projectId: string;
  name: string;
  number?: number;
  goals?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  capacityPoints?: number | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("PI name required");
  let number = params.number;
  if (number == null) {
    const max = await prisma.piIncrement.aggregate({
      where: { projectId: params.projectId },
      _max: { number: true },
    });
    number = (max._max.number || 0) + 1;
  }
  return prisma.piIncrement.create({
    data: {
      projectId: params.projectId,
      name,
      number,
      goals: params.goals?.trim() || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      capacityPoints: params.capacityPoints ?? null,
      status: "PLANNED",
    },
  });
}

export async function updatePiIncrement(params: {
  id: string;
  status?: string;
  goals?: string | null;
  committedPoints?: number | null;
  name?: string;
}) {
  return prisma.piIncrement.update({
    where: { id: params.id },
    data: {
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.goals !== undefined ? { goals: params.goals } : {}),
      ...(params.committedPoints !== undefined
        ? { committedPoints: params.committedPoints }
        : {}),
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
    },
  });
}

export async function addPiFeature(params: {
  piId: string;
  name: string;
  description?: string | null;
  storyPoints?: number | null;
  ownerName?: string | null;
  status?: string;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Feature name required");
  const count = await prisma.piFeature.count({ where: { piId: params.piId } });
  return prisma.piFeature.create({
    data: {
      piId: params.piId,
      name,
      description: params.description?.trim() || null,
      storyPoints: params.storyPoints ?? null,
      ownerName: params.ownerName?.trim() || null,
      status: (params.status || "BACKLOG").toUpperCase(),
      sortOrder: count,
    },
  });
}

// ── Cost tracking + product rollup ────────────────────────────

export async function addCostEntry(params: {
  projectId: string;
  productId?: string | null;
  category?: string;
  description?: string | null;
  amount: number;
  hours?: number | null;
  entryDate?: Date | null;
  source?: string | null;
}) {
  if (!Number.isFinite(params.amount)) throw new Error("Amount required");
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
  });
  if (!project) throw new Error("Project not found");

  const productId = params.productId || project.productId || null;
  const entry = await prisma.projectCostEntry.create({
    data: {
      projectId: params.projectId,
      productId,
      category: (params.category || "LABOR").toUpperCase(),
      description: params.description?.trim() || null,
      amount: params.amount,
      hours: params.hours ?? null,
      entryDate: params.entryDate || new Date(),
      source: params.source?.trim() || "MANUAL",
    },
  });

  await recomputeProjectDevelopmentCost(params.projectId);
  if (productId) await recomputeProductDevelopmentCost(productId);
  return entry;
}

export async function recomputeProjectDevelopmentCost(projectId: string) {
  const sum = await prisma.projectCostEntry.aggregate({
    where: { projectId },
    _sum: { amount: true },
  });
  const actual = sum._sum.amount || 0;
  return prisma.project.update({
    where: { id: projectId },
    data: {
      developmentActual: actual,
    },
  });
}

export async function recomputeProductDevelopmentCost(productId: string) {
  const [fromEntries, fromProjects] = await Promise.all([
    prisma.projectCostEntry.aggregate({
      where: { productId },
      _sum: { amount: true },
    }),
    prisma.project.aggregate({
      where: { productId },
      _sum: { developmentBudget: true, developmentActual: true },
    }),
  ]);
  // Prefer cost entry rollup; fall back to project developmentActual sum
  const actual =
    fromEntries._sum.amount || fromProjects._sum.developmentActual || 0;
  const budget = fromProjects._sum.developmentBudget || 0;
  return prisma.product.update({
    where: { id: productId },
    data: {
      developmentActual: actual,
      developmentBudget: budget,
    },
  });
}

// ── Sync project → product ────────────────────────────────────

/** Push project requirements into the primary (or linked) product PLM. */
export async function syncRequirementsToProduct(params: {
  projectId: string;
  productId?: string | null;
  userId?: string | null;
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: { requirements: true, productLinks: true },
  });
  if (!project) throw new Error("Project not found");
  const productId =
    params.productId || project.productId || project.productLinks[0]?.productId;
  if (!productId) throw new Error("No product linked to this project");

  let created = 0;
  for (const req of project.requirements) {
    if (req.productRequirementId) continue;
    const existing = await prisma.productRequirement.findUnique({
      where: {
        productId_number: { productId, number: req.number },
      },
    });
    if (existing) {
      await prisma.projectRequirement.update({
        where: { id: req.id },
        data: { productRequirementId: existing.id },
      });
      continue;
    }
    const pr = await prisma.productRequirement.create({
      data: {
        productId,
        number: req.number,
        title: req.title,
        description: req.description,
        category: req.category,
        status: req.status,
        priority: req.priority,
        source: req.source || `Project ${project.number}`,
        verificationMethod: req.verificationMethod,
      },
    });
    await prisma.projectRequirement.update({
      where: { id: req.id },
      data: { productRequirementId: pr.id },
    });
    created++;
  }

  await logAudit({
    entityType: "Project",
    entityId: project.id,
    action: "SYNC_REQUIREMENTS",
    userId: params.userId,
    metadata: { productId, created },
  });
  return { productId, created };
}

/** Push achieved PDR/CDR/etc. gates into product milestones + optional lifecycle. */
export async function syncMilestonesToProduct(params: {
  projectId: string;
  productId?: string | null;
  userId?: string | null;
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: { milestones: true },
  });
  if (!project) throw new Error("Project not found");
  const productId = params.productId || project.productId;
  if (!productId) throw new Error("No product linked to this project");

  let synced = 0;
  for (const m of project.milestones) {
    if (m.productMilestoneId) continue;
    const pm = await prisma.productMilestone.create({
      data: {
        productId,
        name: m.name,
        kind: m.kind === "OTHER" ? "GATE" : m.kind,
        targetDate: m.dueDate,
        actualDate: m.actualDate,
        status:
          m.status === "ACHIEVED"
            ? "COMPLETE"
            : m.status === "MISSED"
              ? "MISSED"
              : "PLANNED",
        notes: m.description || `From project ${project.number}`,
      },
    });
    await prisma.milestone.update({
      where: { id: m.id },
      data: { productMilestoneId: pm.id },
    });
    synced++;
  }

  // Roll cost to product
  await recomputeProductDevelopmentCost(productId);

  await logAudit({
    entityType: "Project",
    entityId: project.id,
    action: "SYNC_MILESTONES",
    userId: params.userId,
    metadata: { productId, synced },
  });
  return { productId, synced };
}

export async function addProjectRequirement(params: {
  projectId: string;
  number?: string | null;
  title: string;
  description?: string | null;
  category?: string;
  status?: string;
  priority?: string;
  source?: string | null;
  verificationMethod?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Requirement title required");
  let number = params.number?.trim().toUpperCase() || "";
  if (!number) {
    const c = await prisma.projectRequirement.count({
      where: { projectId: params.projectId },
    });
    number = `PREQ-${String(c + 1).padStart(3, "0")}`;
  }
  return prisma.projectRequirement.create({
    data: {
      projectId: params.projectId,
      number,
      title,
      description: params.description?.trim() || null,
      category: (params.category || "FUNCTIONAL").toUpperCase(),
      status: (params.status || "DRAFT").toUpperCase(),
      priority: (params.priority || "NORMAL").toUpperCase(),
      source: params.source?.trim() || null,
      verificationMethod: params.verificationMethod?.trim().toUpperCase() || null,
    },
  });
}

export async function linkProductToProject(params: {
  projectId: string;
  productId: string;
  role?: string;
}) {
  return prisma.projectProduct.upsert({
    where: {
      projectId_productId: {
        projectId: params.projectId,
        productId: params.productId,
      },
    },
    create: {
      projectId: params.projectId,
      productId: params.productId,
      role: (params.role || "PRIMARY").toUpperCase(),
    },
    update: { role: (params.role || "PRIMARY").toUpperCase() },
  });
}

export async function getProjectDetail(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      program: true,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          lifecyclePhase: true,
          developmentBudget: true,
          developmentActual: true,
        },
      },
      sponsor: { select: { id: true, name: true } },
      projectManager: { select: { id: true, name: true } },
      wbsElements: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: [{ startDate: "asc" }, { name: "asc" }] },
      milestones: { orderBy: { dueDate: "asc" } },
      risks: { orderBy: [{ score: "desc" }, { title: "asc" }] },
      issues: { orderBy: { raisedAt: "desc" } },
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      productLinks: {
        include: {
          product: {
            select: { id: true, code: true, name: true, lifecyclePhase: true },
          },
        },
      },
      requirements: { orderBy: { number: "asc" } },
      raciEntries: { orderBy: { sortOrder: "asc" } },
      communications: { orderBy: { sortOrder: "asc" } },
      wikiPages: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        include: { updatedBy: { select: { name: true } } },
      },
      piIncrements: {
        orderBy: { number: "asc" },
        include: { features: { orderBy: { sortOrder: "asc" } } },
      },
      costEntries: { orderBy: { entryDate: "desc" }, take: 100 },
      workOrders: {
        take: 20,
        include: { part: { select: { partNumber: true } } },
      },
    },
  });
}

export async function listProjects(params?: {
  programId?: string;
  status?: string;
  search?: string;
}) {
  const search = params?.search?.trim();
  return prisma.project.findMany({
    where: {
      ...(params?.programId ? { programId: params.programId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search } },
              { name: { contains: search } },
              { customerName: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      program: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, code: true, name: true } },
      projectManager: { select: { id: true, name: true } },
      _count: {
        select: {
          tasks: true,
          risks: true,
          issues: true,
          milestones: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ── PI planning: quarters & PMO sprints ───────────────────────

export async function listPlanningQuarters() {
  return prisma.planningQuarter.findMany({
    include: {
      sprints: {
        include: { _count: { select: { engTasks: true, sagas: true } } },
        orderBy: { startDate: "asc" },
      },
    },
    orderBy: [{ year: "desc" }, { quarter: "desc" }],
  });
}

export async function createPlanningQuarter(params: {
  year: number;
  quarter: number;
  name?: string;
  startDate: Date;
  endDate: Date;
  goals?: string | null;
  status?: string;
}) {
  if (params.quarter < 1 || params.quarter > 4) {
    throw new Error("Quarter must be 1–4");
  }
  const code = `${params.year}-Q${params.quarter}`;
  const name = params.name?.trim() || `FY${params.year} Q${params.quarter}`;
  return prisma.planningQuarter.create({
    data: {
      code,
      name,
      year: params.year,
      quarter: params.quarter,
      startDate: params.startDate,
      endDate: params.endDate,
      goals: params.goals?.trim() || null,
      status: (params.status || "PLANNED").toUpperCase(),
    },
  });
}

export async function updatePlanningQuarter(params: {
  id: string;
  status?: string;
  goals?: string | null;
  name?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  return prisma.planningQuarter.update({
    where: { id: params.id },
    data: {
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.goals !== undefined ? { goals: params.goals } : {}),
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
    },
  });
}

export async function createPmoSprint(params: {
  quarterId: string;
  name: string;
  goal?: string | null;
  discipline?: string | null;
  projectId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Sprint name required");
  const quarter = await prisma.planningQuarter.findUnique({
    where: { id: params.quarterId },
  });
  if (!quarter) throw new Error("Quarter not found");
  return prisma.engSprint.create({
    data: {
      name,
      goal: params.goal?.trim() || null,
      discipline: params.discipline?.toUpperCase() || null,
      projectId: params.projectId || null,
      quarterId: params.quarterId,
      startDate: params.startDate || quarter.startDate,
      endDate: params.endDate || quarter.endDate,
      status: "PLANNED",
      createdByPmo: true,
    },
  });
}
