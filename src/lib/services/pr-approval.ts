"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Configurable PR approval:
 * - Company defines ApprovalPolicy with ordered steps + minAmount thresholds
 * - When a PR is submitted, only steps where totalEstimate >= minAmount apply
 * - Sequential: step N must be approved before step N+1 becomes PENDING
 */

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
    // No policy configured → auto-approve (demo-friendly)
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

  // Project / SO owner first (if PR is charged to a project with a PM member)
  let projectOwnerId: string | null = null;
  if (pr.projectId) {
    const pm = await prisma.projectMember.findFirst({
      where: {
        projectId: pr.projectId,
        role: { in: ["PM", "OWNER", "MANAGER"] },
      },
    });
    projectOwnerId = pm?.userId || null;
    if (!projectOwnerId) {
      const any = await prisma.projectMember.findFirst({
        where: { projectId: pr.projectId },
      });
      projectOwnerId = any?.userId || null;
    }
  }

  // Steps that apply for this dollar amount
  let applicable = policy.steps
    .filter((s) => pr.totalEstimate >= s.minAmount)
    .sort((a, b) => a.stepOrder - b.stepOrder);

  // Buyer processing is always first policy step after optional project owner
  // (project owner step injected as synthetic order 0 when present)

  if (applicable.length === 0) {
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
        reason: "Below all thresholds",
        amount: pr.totalEstimate,
        policyId: policy.id,
      },
    });
    return { status: "APPROVED" as const, approvals: [] };
  }

  // Clear prior approvals for re-submit cases
  await prisma.approval.deleteMany({
    where: { entityType: "PurchaseRequest", entityId: pr.id },
  });

  const approvals = [];
  // Inject project owner as step order 0 when PR is project-charged
  let stepOffset = 0;
  if (projectOwnerId) {
    stepOffset = 1;
    const ownerAp = await prisma.approval.create({
      data: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        stage: "Project owner",
        stepOrder: 0,
        minAmount: 0,
        status: "PENDING",
        approverId: projectOwnerId,
      },
    });
    approvals.push(ownerAp);
  }

  for (let i = 0; i < applicable.length; i++) {
    const step = applicable[i];
    const ap = await prisma.approval.create({
      data: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        stage: step.name,
        stepOrder: step.stepOrder + stepOffset,
        minAmount: step.minAmount,
        policyStepId: step.id,
        status: "PENDING",
        approverId: step.approverUserId || undefined,
      },
    });
    approvals.push(ap);
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
      steps: applicable.map((s) => ({
        order: s.stepOrder,
        name: s.name,
        minAmount: s.minAmount,
      })),
      amount: pr.totalEstimate,
    },
  });

  return {
    status: "SUBMITTED" as const,
    approvals,
    currentStepOrder: firstOrder,
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

  const step = approval.policyStep;
  if (!step) {
    // Legacy / free-form — any purchasing-ish role
    return ["ADMIN", "PURCHASING"].includes(params.userRole || "");
  }

  if (step.approverUserId) {
    return step.approverUserId === params.userId || params.userRole === "ADMIN";
  }
  if (step.approverRole) {
    return (
      params.userRole === step.approverRole ||
      params.userRole === "ADMIN"
    );
  }
  return params.userRole === "ADMIN" || params.userRole === "PURCHASING";
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
  if (pr.status !== "SUBMITTED") {
    throw new Error(`PR is ${pr.status}, not awaiting approval`);
  }

  // Legacy PRs without workflow rows — start policy now
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
    throw new Error(
      `You are not authorized for step "${current.stage}". Need role ${current.policyStep?.approverRole || "ADMIN"} or assigned approver.`
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

  // Find next pending step by order
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

  // All steps done
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
    metadata: { finalStage: current.stage, comments: params.comments },
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

  if (params.id) {
    await prisma.approvalPolicyStep.deleteMany({ where: { policyId: params.id } });
    const policy = await prisma.approvalPolicy.update({
      where: { id: params.id },
      data: {
        name: params.name,
        description: params.description,
        isDefault: params.isDefault ?? false,
        isActive: params.isActive ?? true,
        steps: {
          create: params.steps.map((s) => ({
            stepOrder: s.stepOrder,
            name: s.name,
            minAmount: s.minAmount,
            approverRole: s.approverRole || null,
            approverUserId: s.approverUserId || null,
            required: s.required ?? true,
          })),
        },
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
      steps: {
        create: params.steps.map((s) => ({
          stepOrder: s.stepOrder,
          name: s.name,
          minAmount: s.minAmount,
          approverRole: s.approverRole || null,
          approverUserId: s.approverUserId || null,
          required: s.required ?? true,
        })),
      },
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

export async function ensureDefaultPrApprovalPolicy() {
  const existing = await prisma.approvalPolicy.findFirst({
    where: { entityType: "PurchaseRequest" },
  });
  if (existing) return existing;

  return prisma.approvalPolicy.create({
    data: {
      name: "Standard PR approval",
      entityType: "PurchaseRequest",
      description:
        "Buyer reviews all PRs; controller above $5k; ops admin above $25k.",
      isActive: true,
      isDefault: true,
      steps: {
        create: [
          {
            stepOrder: 1,
            name: "Buyer review",
            minAmount: 0,
            approverRole: "PURCHASING",
          },
          {
            stepOrder: 2,
            name: "Finance / controller",
            minAmount: 5000,
            approverRole: "ACCOUNTING",
          },
          {
            stepOrder: 3,
            name: "Operations admin",
            minAmount: 25000,
            approverRole: "ADMIN",
          },
        ],
      },
    },
    include: { steps: true },
  });
}
