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

  // Resolve the specific person who owns Project / Program / Sales Order
  // (not just a generic role title). approverId optional = role-based step.
  let ownerApprovals: {
    stage: string;
    approverId?: string;
  }[] = [];

  // Reload PR with ownership links
  const prFull = await prisma.purchaseRequest.findUnique({
    where: { id: pr.id },
    include: {
      project: {
        select: {
          id: true,
          projectManagerId: true,
          sponsorId: true,
          programId: true,
          program: { select: { ownerId: true } },
        },
      },
      workOrder: {
        select: {
          projectId: true,
          project: {
            select: {
              projectManagerId: true,
              sponsorId: true,
              program: { select: { ownerId: true } },
            },
          },
          salesOrderId: true,
        },
      },
    },
  });

  const project =
    prFull?.project ||
    prFull?.workOrder?.project ||
    null;
  if (project?.projectManagerId) {
    ownerApprovals.push({
      stage: "Project manager",
      approverId: project.projectManagerId,
    });
  } else if (project?.sponsorId) {
    ownerApprovals.push({
      stage: "Project sponsor",
      approverId: project.sponsorId,
    });
  } else if (pr.projectId) {
    // Fallback: first PM/OWNER membership
    const pm = await prisma.projectMember.findFirst({
      where: {
        projectId: pr.projectId,
        role: { in: ["PM", "OWNER", "MANAGER"] },
      },
    });
    if (pm) {
      ownerApprovals.push({
        stage: "Project owner",
        approverId: pm.userId,
      });
    }
  }

  const programOwnerId =
    project && "program" in project
      ? (project as { program?: { ownerId?: string | null } | null }).program
          ?.ownerId
      : null;
  if (programOwnerId) {
    ownerApprovals.push({
      stage: "Program owner",
      approverId: programOwnerId,
    });
  }

  // Sales-order charged PRs: SO has no owner field. Add a commercial review
  // step (not locked to one random ADMIN) so Purchasing/Admin can clear it.
  if (pr.salesOrderId && !ownerApprovals.length) {
    const so = await prisma.salesOrder.findUnique({
      where: { id: pr.salesOrderId },
      select: { id: true, number: true },
    });
    if (so) {
      ownerApprovals.push({
        stage: `Sales order ${so.number} review`,
        // no approverId — any ADMIN / PURCHASING / EXECUTIVE / PM
      });
    }
  }

  // Deduplicate by person (unassigned stages kept once by stage name)
  const seenOwners = new Set<string>();
  const seenStages = new Set<string>();
  ownerApprovals = ownerApprovals.filter((o) => {
    if (o.approverId) {
      if (seenOwners.has(o.approverId)) return false;
      seenOwners.add(o.approverId);
      return true;
    }
    if (seenStages.has(o.stage)) return false;
    seenStages.add(o.stage);
    return true;
  });

  // Steps that apply for this dollar amount
  const applicable = policy.steps
    .filter((s) => pr.totalEstimate >= s.minAmount)
    .sort((a, b) => a.stepOrder - b.stepOrder);

  // Clear prior approvals for re-submit cases
  await prisma.approval.deleteMany({
    where: { entityType: "PurchaseRequest", entityId: pr.id },
  });

  const approvals = [];
  let stepOrder = 0;

  // Owner / commercial review steps first
  for (const o of ownerApprovals) {
    const ownerAp = await prisma.approval.create({
      data: {
        entityType: "PurchaseRequest",
        entityId: pr.id,
        stage: o.stage,
        stepOrder: stepOrder++,
        minAmount: 0,
        status: "PENDING",
        approverId: o.approverId || undefined,
      },
    });
    approvals.push(ownerAp);
  }

  // CFO for any accounting/finance step (role ACCOUNTING or stage name match)
  const cfoUser = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { title: { contains: "CFO" } },
        { email: { contains: "cfo" } },
        { role: "EXECUTIVE", department: "Finance" },
      ],
    },
    orderBy: { name: "asc" },
  });

  for (const step of applicable) {
    const isFinance =
      /finance|controller|accounting|cfo/i.test(step.name) ||
      step.approverRole === "ACCOUNTING" ||
      step.approverRole === "EXECUTIVE";

    let approverId = step.approverUserId || undefined;
    let stage = step.name;

    if (isFinance && cfoUser) {
      // Accounting approval requires the CFO specifically
      approverId = cfoUser.id;
      stage = step.name.includes("CFO") ? step.name : `${step.name} (CFO)`;
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
        approverId,
      },
    });
    approvals.push(ap);
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
        reason: "No approval steps required",
        amount: pr.totalEstimate,
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

  const role = params.userRole || "";
  // Admins can always clear a step (break-glass)
  if (role === "ADMIN") return true;

  // Person pinned on the approval row (PM, sponsor, CFO pin, etc.)
  if (approval.approverId) {
    if (approval.approverId === params.userId) return true;
    // SO / commercial owner steps that were incorrectly pinned to one admin:
    // still let Purchasing clear them so the dock isn't stuck.
    if (
      /sales order/i.test(approval.stage) &&
      ["PURCHASING", "EXECUTIVE", "PM"].includes(role)
    ) {
      return true;
    }
    return false;
  }

  const step = approval.policyStep;
  if (!step) {
    // Free-form / SO review without a named person
    return ["PURCHASING", "EXECUTIVE", "PM"].includes(role);
  }

  if (step.approverUserId) {
    return step.approverUserId === params.userId;
  }
  if (step.approverRole) {
    // CFO / accounting steps: allow EXECUTIVE finance or ACCOUNTING
    if (
      step.approverRole === "ACCOUNTING" ||
      /cfo|finance|controller/i.test(approval.stage)
    ) {
      return (
        role === "ACCOUNTING" ||
        role === "EXECUTIVE"
      );
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
  // Segregation of duties: the requester can't approve their own PR
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
    const who = current.approverId
      ? "the assigned approver (or ADMIN)"
      : current.policyStep?.approverRole
        ? `role ${current.policyStep.approverRole} (or ADMIN)`
        : /sales order/i.test(current.stage)
          ? "ADMIN, PURCHASING, or EXECUTIVE"
          : "ADMIN or PURCHASING";
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

/**
 * PRs actually awaiting THIS user's decision — the current pending step is
 * one they can approve, and they aren't the one who submitted it. Used for
 * the My Approvals count so operators don't see every submitted PR.
 */
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
    // A requester never approves their own PR
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
