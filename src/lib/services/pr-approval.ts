"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * PR approval — charge-code routing + configurable thresholds.
 *
 * Policy steps (minAmount = kicks in at this $):
 *  - CHARGE_OWNER: WBS owner / project PM, or production mgr for SO product line
 *  - CHARGE_ESCALATION: program owner (project path) or product owner / exec (SO)
 *  - ROLE / USER: classic role or fixed user (e.g. Finance ≥ $25k)
 *
 * No more fake “Sales order owner” step-0. Sequential: step N before N+1.
 */

export type RoutingKey =
  | "CHARGE_OWNER"
  | "CHARGE_ESCALATION"
  | "ROLE"
  | "USER";

export async function getDefaultApprovalPolicy(entityType = "PurchaseRequest") {
  return (
    (await prisma.approvalPolicy.findFirst({
      where: { entityType, isDefault: true, isActive: true },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    })) ||
    (await prisma.approvalPolicy.findFirst({
      where: { entityType, isActive: true },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    }))
  );
}

export async function listApprovalPolicies() {
  return prisma.approvalPolicy.findMany({
    where: { entityType: "PurchaseRequest" },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

type ChargeContext = {
  kind: "PROJECT" | "SALES_ORDER" | "GENERAL";
  projectId?: string | null;
  projectNumber?: string | null;
  wbsId?: string | null;
  wbsCode?: string | null;
  programId?: string | null;
  programCode?: string | null;
  salesOrderId?: string | null;
  salesOrderNumber?: string | null;
  productName?: string | null;
  /** First-line charge approver */
  ownerUserId?: string | null;
  ownerLabel: string;
  /** Escalation above threshold */
  escalationUserId?: string | null;
  escalationLabel: string;
};

/** Resolve project / WBS / SO ownership for charge-based routing. */
async function resolveChargeContext(
  purchaseRequestId: string
): Promise<ChargeContext> {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: purchaseRequestId },
    include: {
      project: {
        select: {
          id: true,
          number: true,
          name: true,
          projectManagerId: true,
          sponsorId: true,
          programId: true,
          program: { select: { id: true, code: true, name: true, ownerId: true } },
        },
      },
      wbsElement: {
        select: {
          id: true,
          code: true,
          name: true,
          ownerId: true,
          projectId: true,
        },
      },
      workOrder: {
        select: {
          projectId: true,
          wbsElementId: true,
          salesOrderId: true,
          project: {
            select: {
              id: true,
              number: true,
              name: true,
              projectManagerId: true,
              sponsorId: true,
              programId: true,
              program: {
                select: { id: true, code: true, name: true, ownerId: true },
              },
            },
          },
          wbsElement: {
            select: { id: true, code: true, name: true, ownerId: true },
          },
          salesOrder: { select: { id: true, number: true } },
        },
      },
    },
  });

  if (!pr) {
    return {
      kind: "GENERAL",
      ownerLabel: "Buyer / purchasing",
      escalationLabel: "Operations admin",
    };
  }

  // Resolve WBS (direct or via WO)
  type WbsSlice = {
    id: string;
    code: string;
    name: string;
    ownerId: string | null;
    projectId?: string;
  } | null;
  let wbs: WbsSlice = pr.wbsElement;
  if (!wbs && pr.workOrder?.wbsElement) {
    wbs = {
      ...pr.workOrder.wbsElement,
      projectId: pr.workOrder.projectId || undefined,
    };
  }

  // Resolve project (direct, WBS, or WO)
  type ProjectSlice = {
    id: string;
    number: string;
    name: string;
    projectManagerId: string | null;
    sponsorId: string | null;
    programId: string | null;
    program: {
      id: string;
      code: string;
      name: string;
      ownerId: string | null;
    } | null;
  } | null;
  let project: ProjectSlice = pr.project;
  if (!project && pr.workOrder?.project) project = pr.workOrder.project;
  if (!project && wbs?.projectId) {
    project = await prisma.project.findUnique({
      where: { id: wbs.projectId },
      select: {
        id: true,
        number: true,
        name: true,
        projectManagerId: true,
        sponsorId: true,
        programId: true,
        program: { select: { id: true, code: true, name: true, ownerId: true } },
      },
    });
  }

  const salesOrderId =
    pr.salesOrderId || pr.workOrder?.salesOrderId || null;

  // ── Project / WBS path ─────────────────────────────────────
  if (project || wbs) {
    const ownerUserId =
      wbs?.ownerId ||
      project?.projectManagerId ||
      project?.sponsorId ||
      null;
    const ownerLabel = wbs
      ? `WBS ${wbs.code} owner${ownerUserId ? "" : " (unassigned → purchasing)"}`
      : `Project ${project?.number || ""} PM${
          ownerUserId ? "" : " (unassigned → purchasing)"
        }`;

    const escalationUserId = project?.program?.ownerId || null;
    const escalationLabel = project?.program
      ? `Program ${project.program.code} owner${
          escalationUserId ? "" : " (unassigned → exec/admin)"
        }`
      : "Program / executive escalation";

    return {
      kind: "PROJECT",
      projectId: project?.id,
      projectNumber: project?.number,
      wbsId: wbs?.id,
      wbsCode: wbs?.code,
      programId: project?.program?.id,
      programCode: project?.program?.code,
      ownerUserId,
      ownerLabel,
      escalationUserId,
      escalationLabel,
    };
  }

  // ── Sales order / product-line path ────────────────────────
  if (salesOrderId) {
    const so = await prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        number: true,
        lines: { select: { partId: true }, take: 40 },
      },
    });
    const partIds = (so?.lines || [])
      .map((l) => l.partId)
      .filter((id): id is string => !!id);

    let product: {
      id: string;
      name: string;
      productLine: string | null;
      productOwnerId: string | null;
      engineeringLeadId: string | null;
    } | null = null;

    if (partIds.length) {
      product = await prisma.product.findFirst({
        where: {
          OR: [
            { topLevelPartId: { in: partIds } },
            { partLinks: { some: { partId: { in: partIds } } } },
          ],
        },
        select: {
          id: true,
          name: true,
          productLine: true,
          productOwnerId: true,
          engineeringLeadId: true,
        },
      });
    }

    // Production manager: product owner, else eng lead, else PRODUCTION role
    let ownerUserId =
      product?.productOwnerId || product?.engineeringLeadId || null;
    if (!ownerUserId) {
      const prodMgr = await prisma.user.findFirst({
        where: {
          isActive: true,
          OR: [
            { role: "PRODUCTION", title: { contains: "Manager" } },
            { role: "PRODUCTION" },
            { title: { contains: "Production Manager" } },
          ],
        },
        orderBy: { name: "asc" },
      });
      ownerUserId = prodMgr?.id || null;
    }

    const lineLabel =
      product?.productLine || product?.name || so?.number || "product line";
    const ownerLabel = `Production manager · ${lineLabel}`;

    // Escalation: product owner if different, else EXECUTIVE
    let escalationUserId: string | null = null;
    if (
      product?.productOwnerId &&
      product.productOwnerId !== ownerUserId
    ) {
      escalationUserId = product.productOwnerId;
    }
    if (!escalationUserId) {
      const exec = await prisma.user.findFirst({
        where: {
          isActive: true,
          role: { in: ["EXECUTIVE", "ADMIN"] },
        },
        orderBy: { role: "desc" },
      });
      escalationUserId = exec?.id || null;
    }

    return {
      kind: "SALES_ORDER",
      salesOrderId: so?.id,
      salesOrderNumber: so?.number,
      productName: product?.name,
      ownerUserId,
      ownerLabel,
      escalationUserId,
      escalationLabel: product
        ? `Product owner / exec · ${product.name}`
        : "Executive escalation (SO)",
    };
  }

  // ── General / stock / kanban ───────────────────────────────
  const buyer = await prisma.user.findFirst({
    where: { isActive: true, role: "PURCHASING" },
  });
  const admin = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ["ADMIN", "EXECUTIVE"] } },
  });
  return {
    kind: "GENERAL",
    ownerUserId: buyer?.id || null,
    ownerLabel: "Buyer / purchasing",
    escalationUserId: admin?.id || null,
    escalationLabel: "Operations / admin",
  };
}

async function fallbackUserForRole(role: string): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: { isActive: true, role },
    orderBy: { name: "asc" },
  });
  return u?.id || null;
}

/** After PR is created as SUBMITTED, wire approvals from the active policy. */
export async function startPrApprovalWorkflow(params: {
  purchaseRequestId: string;
  userId?: string;
  policyId?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
    include: { lines: true },
  });
  if (!pr) throw new Error("Purchase request not found");

  const policy = params.policyId
    ? await prisma.approvalPolicy.findUnique({
        where: { id: params.policyId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      })
    : await getDefaultApprovalPolicy();

  if (!policy || !policy.isActive || policy.steps.length === 0) {
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: {
        status: "APPROVED",
        currentStepOrder: 0,
        approvedById: params.userId,
        approvedAt: new Date(),
      },
    });
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "AUTO_APPROVED",
      userId: params.userId,
      metadata: { reason: "No active approval policy" },
    });
    return { status: "APPROVED" as const, approvals: [] };
  }

  const charge = await resolveChargeContext(pr.id);
  const amount = pr.totalEstimate || 0;

  // Steps that apply for this dollar amount (threshold)
  const applicable = policy.steps
    .filter((s) => amount >= (s.minAmount || 0))
    .sort((a, b) => a.stepOrder - b.stepOrder);

  await prisma.approval.deleteMany({
    where: { entityType: "PurchaseRequest", entityId: pr.id },
  });

  const approvals: {
    id: string;
    stepOrder: number;
    stage: string;
    approverId: string | null;
  }[] = [];
  let stepOrder = 0;

  for (const step of applicable) {
    const routing = (step.routingKey || "ROLE") as RoutingKey;
    let approverId: string | null | undefined;
    let stage = step.name;

    if (routing === "CHARGE_OWNER") {
      approverId = charge.ownerUserId;
      stage = `${step.name} — ${charge.ownerLabel}`;
      if (!approverId) {
        approverId = await fallbackUserForRole(
          step.approverRole || "PURCHASING"
        );
      }
    } else if (routing === "CHARGE_ESCALATION") {
      // Only meaningful when charge context can escalate
      if (charge.kind === "GENERAL" && !charge.escalationUserId) {
        // Still allow if minAmount hit — admin/exec
        approverId = await fallbackUserForRole(
          step.approverRole || "ADMIN"
        );
        stage = `${step.name} — ${charge.escalationLabel}`;
      } else {
        approverId = charge.escalationUserId;
        stage = `${step.name} — ${charge.escalationLabel}`;
        if (!approverId) {
          approverId = await fallbackUserForRole(
            step.approverRole || "EXECUTIVE"
          );
        }
      }
    } else if (routing === "USER") {
      approverId = step.approverUserId || null;
      stage = step.name;
    } else {
      // ROLE — optional pin specific user still supported
      approverId = step.approverUserId || null;
      if (!approverId && step.approverRole) {
        // Finance pin: prefer CFO title when ACCOUNTING/EXECUTIVE
        if (
          step.approverRole === "ACCOUNTING" ||
          /cfo|finance|controller/i.test(step.name)
        ) {
          const cfo = await prisma.user.findFirst({
            where: {
              isActive: true,
              OR: [
                { title: { contains: "CFO" } },
                { email: { contains: "cfo" } },
                { role: "ACCOUNTING" },
                { role: "EXECUTIVE", department: "Finance" },
              ],
            },
            orderBy: { name: "asc" },
          });
          approverId = cfo?.id || null;
          if (cfo && !step.name.includes("CFO")) {
            stage = `${step.name} (CFO / finance)`;
          }
        }
      }
      if (!approverId && step.approverRole) {
        // Leave unassigned — role-based canUserApproveStep
        stage = step.name;
      }
    }

    // Skip escalation step when same person as charge owner (no double-approve)
    if (
      routing === "CHARGE_ESCALATION" &&
      approverId &&
      approvals.some((a) => a.approverId === approverId)
    ) {
      continue;
    }

    const ap = await prisma.approval.create({
      data: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        stage,
        stepOrder: stepOrder++,
        minAmount: step.minAmount,
        policyStepId: step.id,
        status: "PENDING",
        approverId: approverId || undefined,
      },
    });
    approvals.push({
      id: ap.id,
      stepOrder: ap.stepOrder,
      stage: ap.stage,
      approverId: ap.approverId,
    });
  }

  if (approvals.length === 0) {
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: {
        status: "APPROVED",
        approvalPolicyId: policy.id,
        currentStepOrder: 0,
        approvedById: params.userId,
        approvedAt: new Date(),
      },
    });
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "AUTO_APPROVED",
      userId: params.userId,
      metadata: {
        reason: "No approval steps required for amount",
        amount,
        chargeKind: charge.kind,
        policyId: policy.id,
      },
    });
    return { status: "APPROVED" as const, approvals: [] };
  }

  const firstOrder = approvals[0]?.stepOrder ?? 0;
  await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      status: "SUBMITTED",
      approvalPolicyId: policy.id,
      currentStepOrder: firstOrder,
      approvedById: null,
      approvedAt: null,
    },
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "APPROVAL_STARTED",
    userId: params.userId,
    metadata: {
      policyId: policy.id,
      policyName: policy.name,
      chargeKind: charge.kind,
      amount,
      steps: approvals.map((a) => ({
        order: a.stepOrder,
        stage: a.stage,
        approverId: a.approverId,
      })),
    },
  });

  return {
    status: "SUBMITTED" as const,
    approvals,
    currentStepOrder: firstOrder,
    charge,
  };
}

export async function canUserApproveStep(params: {
  userId?: string;
  userRole?: string;
  approvalId: string;
}) {
  const approval = await prisma.approval.findUnique({
    where: { id: params.approvalId },
    include: { policyStep: true },
  });
  if (!approval || approval.status !== "PENDING") return false;

  const role = params.userRole || "";
  if (role === "ADMIN") return true;

  // Person pinned on the row (charge owner, program owner, CFO, …)
  if (approval.approverId) {
    return approval.approverId === params.userId;
  }

  const step = approval.policyStep;
  if (!step) {
    return ["PURCHASING", "EXECUTIVE", "PM"].includes(role);
  }

  if (step.approverUserId) {
    return step.approverUserId === params.userId;
  }

  const routing = step.routingKey || "ROLE";
  if (routing === "CHARGE_OWNER" || routing === "CHARGE_ESCALATION") {
    // Unassigned charge step — purchasing / exec can clear so work isn't stuck
    return ["PURCHASING", "EXECUTIVE", "PM", "PRODUCTION"].includes(role);
  }

  if (step.approverRole) {
    if (
      step.approverRole === "ACCOUNTING" ||
      /cfo|finance|controller/i.test(approval.stage)
    ) {
      return role === "ACCOUNTING" || role === "EXECUTIVE";
    }
    return role === step.approverRole;
  }
  return role === "PURCHASING" || role === "EXECUTIVE";
}

export async function decidePrApproval(params: {
  purchaseRequestId: string;
  decision: "APPROVED" | "REJECTED";
  comments?: string;
  userId?: string;
  userRole?: string;
}) {
  let pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr) throw new Error("Purchase request not found");
  if (
    params.decision === "APPROVED" &&
    pr.requestedById &&
    pr.requestedById === params.userId &&
    params.userRole !== "ADMIN"
  ) {
    throw new Error("You cannot approve a purchase request you submitted");
  }
  if (pr.status !== "SUBMITTED") {
    throw new Error(`PR is ${pr.status}, not awaiting approval`);
  }

  let current = await prisma.approval.findFirst({
    where: {
      entityType: "PurchaseRequest",
      entityId: pr.id,
      status: "PENDING",
      ...(pr.currentStepOrder > 0
        ? { stepOrder: pr.currentStepOrder }
        : {}),
    },
    include: { policyStep: true },
    orderBy: { stepOrder: "asc" },
  });

  if (!current) {
    const started = await startPrApprovalWorkflow({
      purchaseRequestId: pr.id,
      userId: params.userId,
    });
    if (started.status === "APPROVED") {
      return { status: "APPROVED" as const };
    }
    pr = (await prisma.purchaseRequest.findUnique({
      where: { id: params.purchaseRequestId },
    }))!;
    current = await prisma.approval.findFirst({
      where: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        stepOrder: pr.currentStepOrder,
        status: "PENDING",
      },
      include: { policyStep: true },
    });
  }
  if (!current) throw new Error("No pending approval step found");

  const allowed = await canUserApproveStep({
    userId: params.userId,
    userRole: params.userRole,
    approvalId: current.id,
  });
  if (!allowed) {
    const who = current.approverId
      ? "the assigned charge owner / manager (or ADMIN)"
      : current.policyStep?.approverRole
        ? `role ${current.policyStep.approverRole} (or ADMIN)`
        : "an authorized approver (or ADMIN)";
    throw new Error(
      `You are not authorized for step "${current.stage}". Need ${who}.`
    );
  }

  await prisma.approval.update({
    where: { id: current.id },
    data: {
      status: params.decision,
      approverId: params.userId,
      comments: params.comments,
      decidedAt: new Date(),
    },
  });

  if (params.decision === "REJECTED") {
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: {
        status: "REJECTED",
        currentStepOrder: 0,
      },
    });
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "REJECTED",
      userId: params.userId,
      metadata: { stage: current.stage, comments: params.comments },
    });
    return { status: "REJECTED" as const };
  }

  const next = await prisma.approval.findFirst({
    where: {
      entityType: "PurchaseRequest",
      entityId: pr.id,
      status: "PENDING",
      stepOrder: { gt: current.stepOrder },
    },
    orderBy: { stepOrder: "asc" },
  });

  if (next) {
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: { currentStepOrder: next.stepOrder },
    });
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "STEP_APPROVED",
      userId: params.userId,
      metadata: {
        stage: current.stage,
        nextStage: next.stage,
        comments: params.comments,
      },
    });
    return { status: "SUBMITTED" as const, nextStep: next.stage };
  }

  await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      status: "APPROVED",
      currentStepOrder: 0,
      approvedById: params.userId,
      approvedAt: new Date(),
    },
  });
  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "APPROVED",
    userId: params.userId,
    metadata: { stage: current.stage, comments: params.comments },
  });
  return { status: "APPROVED" as const };
}

export async function getPrApprovals(purchaseRequestId: string) {
  return prisma.approval.findMany({
    where: { entityType: "PurchaseRequest", entityId: purchaseRequestId },
    include: {
      approver: { select: { id: true, name: true, role: true } },
      policyStep: true,
    },
    orderBy: { stepOrder: "asc" },
  });
}

export async function countPrApprovalsForUser(params: {
  userId?: string;
  userRole?: string;
}): Promise<number> {
  if (!params.userId) return 0;
  const prs = await prisma.purchaseRequest.findMany({
    where: { status: "SUBMITTED" },
    select: { id: true, currentStepOrder: true, requestedById: true },
  });
  let count = 0;
  for (const pr of prs) {
    if (pr.requestedById && pr.requestedById === params.userId) continue;
    const current = await prisma.approval.findFirst({
      where: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        status: "PENDING",
        ...(pr.currentStepOrder > 0
          ? { stepOrder: pr.currentStepOrder }
          : {}),
      },
      orderBy: { stepOrder: "asc" },
    });
    if (!current) continue;
    const ok = await canUserApproveStep({
      userId: params.userId,
      userRole: params.userRole,
      approvalId: current.id,
    });
    if (ok) count++;
  }
  return count;
}

export async function saveApprovalPolicy(params: {
  id?: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  steps: {
    id?: string;
    stepOrder: number;
    name: string;
    minAmount: number;
    routingKey?: string | null;
    approverRole?: string | null;
    approverUserId?: string | null;
    required?: boolean;
  }[];
  userId?: string;
}) {
  if (params.isDefault) {
    await prisma.approvalPolicy.updateMany({
      where: { entityType: "PurchaseRequest", isDefault: true },
      data: { isDefault: false },
    });
  }

  const stepCreate = params.steps.map((s) => ({
    stepOrder: s.stepOrder,
    name: s.name,
    minAmount: s.minAmount,
    routingKey: (s.routingKey || "ROLE") as string,
    approverRole: s.approverRole || null,
    approverUserId: s.approverUserId || null,
    required: s.required ?? true,
  }));

  if (params.id) {
    await prisma.approvalPolicyStep.deleteMany({
      where: { policyId: params.id },
    });
    const policy = await prisma.approvalPolicy.update({
      where: { id: params.id },
      data: {
        name: params.name,
        description: params.description,
        isDefault: params.isDefault ?? false,
        isActive: params.isActive ?? true,
        steps: { create: stepCreate },
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    await logAudit({
      entityType: "ApprovalPolicy",
      entityId: policy.id,
      action: "UPDATED",
      userId: params.userId,
    });
    return policy;
  }

  const policy = await prisma.approvalPolicy.create({
    data: {
      name: params.name,
      entityType: "PurchaseRequest",
      description: params.description,
      isDefault: params.isDefault ?? false,
      isActive: params.isActive ?? true,
      steps: { create: stepCreate },
    },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
  await logAudit({
    entityType: "ApprovalPolicy",
    entityId: policy.id,
    action: "CREATED",
    userId: params.userId,
  });
  return policy;
}

const DEFAULT_CHARGE_STEPS = [
  {
    stepOrder: 1,
    name: "Charge owner",
    minAmount: 0,
    routingKey: "CHARGE_OWNER",
    approverRole: "PURCHASING",
  },
  {
    stepOrder: 2,
    name: "Charge escalation",
    minAmount: 10000,
    routingKey: "CHARGE_ESCALATION",
    approverRole: "EXECUTIVE",
  },
  {
    stepOrder: 3,
    name: "Finance / controller",
    minAmount: 25000,
    routingKey: "ROLE",
    approverRole: "ACCOUNTING",
  },
];

export async function ensureDefaultPrApprovalPolicy() {
  const existing = await prisma.approvalPolicy.findFirst({
    where: { entityType: "PurchaseRequest" },
    include: { steps: true },
  });

  if (!existing) {
    return prisma.approvalPolicy.create({
      data: {
        name: "Charge-code PR approval",
        entityType: "PurchaseRequest",
        description:
          "Project/WBS → WBS owner or project PM, then program owner above threshold. Sales order → production manager for the product line, then product owner/exec above threshold. Finance above company $ threshold. Edit amounts on the Approvals settings page.",
        isActive: true,
        isDefault: true,
        steps: { create: DEFAULT_CHARGE_STEPS },
      },
      include: { steps: true },
    });
  }

  // Upgrade legacy “Buyer / Finance / Admin” default to charge-code routing
  const hasCharge = existing.steps.some(
    (s) =>
      s.routingKey === "CHARGE_OWNER" || s.routingKey === "CHARGE_ESCALATION"
  );
  if (!hasCharge && existing.isDefault) {
    await prisma.approvalPolicyStep.deleteMany({
      where: { policyId: existing.id },
    });
    return prisma.approvalPolicy.update({
      where: { id: existing.id },
      data: {
        name: "Charge-code PR approval",
        description:
          "Project/WBS → WBS owner or project PM, then program owner above threshold. Sales order → production manager for the product line, then product owner/exec above threshold. Finance above company $ threshold. Edit amounts on the Approvals settings page.",
        steps: { create: DEFAULT_CHARGE_STEPS },
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
  }

  return existing;
}
