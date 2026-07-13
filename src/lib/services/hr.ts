/**
 * HR / Workforce workflows — PTO decisions, time approval with labor cost
 * posting, expense report lifecycle, and goal progress.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { userHasPermission } from "@/lib/auth";

export type HrPersona = {
  /** Full HR administration (sees every employee). */
  isHrAdmin: boolean;
  /** Has direct reports (sees "My Team"). */
  isManager: boolean;
  reportIds: string[];
};

export type ComplianceItem = {
  kind: "REVIEW_OVERDUE" | "REVIEW_DUE_SOON" | "TRAINING_EXPIRED" | "TRAINING_EXPIRING";
  userId: string;
  employeeName: string;
  label: string;
  dueDate: Date | null;
  daysOut: number; // negative = overdue/expired
  href: string;
};

/**
 * People-compliance engine: surfaces overdue/soon-due performance
 * reviews and expired/expiring training. Scoped to the viewer — HR
 * admins see everyone, managers see their reports. Feeds the HR
 * report and the notification bell.
 */
export async function getComplianceItems(user: {
  id: string;
  role: string;
}): Promise<ComplianceItem[]> {
  const persona = await getHrPersona(user);
  if (!persona.isHrAdmin && !persona.isManager) return [];
  const scope = persona.isHrAdmin ? undefined : persona.reportIds;
  const now = Date.now();
  const soon = 30 * 86_400_000;

  const [reviews, training] = await Promise.all([
    prisma.performanceReview.findMany({
      where: {
        status: { not: "COMPLETED" },
        dueDate: { not: null, lte: new Date(now + soon) },
        ...(scope ? { employeeId: { in: scope } } : {}),
      },
      include: { employee: { select: { name: true } } },
    }),
    prisma.trainingRecord.findMany({
      where: {
        expiresAt: { not: null, lte: new Date(now + soon) },
        status: { not: "IN_PROGRESS" },
        ...(scope ? { userId: { in: scope } } : {}),
      },
      include: { user: { select: { name: true } } },
    }),
  ]);

  const items: ComplianceItem[] = [];
  for (const r of reviews) {
    if (!r.dueDate) continue;
    const days = Math.floor((r.dueDate.getTime() - now) / 86_400_000);
    items.push({
      kind: days < 0 ? "REVIEW_OVERDUE" : "REVIEW_DUE_SOON",
      userId: r.employeeId,
      employeeName: r.employee.name,
      label: `${r.period} review — ${r.status.replace(/_/g, " ").toLowerCase()}`,
      dueDate: r.dueDate,
      daysOut: days,
      href: `/hr/person/${r.employeeId}`,
    });
  }
  for (const t of training) {
    if (!t.expiresAt) continue;
    const days = Math.floor((t.expiresAt.getTime() - now) / 86_400_000);
    items.push({
      kind: days < 0 ? "TRAINING_EXPIRED" : "TRAINING_EXPIRING",
      userId: t.userId,
      employeeName: t.user.name,
      label: `${t.name} (${t.type.replace(/_/g, " ").toLowerCase()})`,
      dueDate: t.expiresAt,
      daysOut: days,
      href: `/hr/person/${t.userId}`,
    });
  }
  // Most-overdue first
  items.sort((a, b) => a.daysOut - b.daysOut);
  return items;
}

/** Resolve what the current user may see in the HR module. */
export async function getHrPersona(user: {
  id: string;
  role: string;
}): Promise<HrPersona> {
  const [reports, hrAdmin] = await Promise.all([
    prisma.user.findMany({
      where: { managerId: user.id, isActive: true },
      select: { id: true },
    }),
    userHasPermission(user.id, "hr.admin"),
  ]);
  return {
    isHrAdmin: hrAdmin,
    isManager: reports.length > 0,
    reportIds: reports.map((r) => r.id),
  };
}

/**
 * May `approver` decide HR items for `targetUserId`?
 * Yes if they are the target's direct manager, or hold hr.admin /
 * the specific decide permission via role, group, or grant.
 */
export async function canDecideFor(
  approver: { id: string; role: string },
  targetUserId: string,
  decidePermission: string
): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { managerId: true },
  });
  if (target?.managerId === approver.id) return true;
  if (await userHasPermission(approver.id, "hr.admin")) return true;
  return userHasPermission(approver.id, decidePermission);
}

export async function decidePtoRequest(params: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  if (params.approver) {
    const existing = await prisma.ptoRequest.findUniqueOrThrow({
      where: { id: params.id },
      select: { userId: true },
    });
    const ok = await canDecideFor(
      params.approver,
      existing.userId,
      "hr.pto.decide"
    );
    if (!ok) throw new Error("Not authorized to decide this PTO request");
  }
  const pto = await prisma.ptoRequest.update({
    where: { id: params.id },
    data: {
      status: params.decision,
      approvedById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "PtoRequest",
    entityId: pto.id,
    action: `PTO_${params.decision}`,
    userId: params.userId,
    changes: { status: params.decision },
  });
  if (params.decision === "APPROVED") {
    // Drop the approved time onto any already-open timesheets; future
    // periods pick it up when their sheet opens.
    const { pushApprovedPtoToTimesheets } = await import(
      "@/lib/services/timesheets"
    );
    await pushApprovedPtoToTimesheets(pto.id);
  }
  return pto;
}

export async function createPtoRequest(params: {
  userId: string;
  type: string;
  startDate: Date;
  endDate: Date;
  hours: number;
  reason?: string;
}) {
  // Balance gate: can't request more PTO / sick than you've earned
  // (pending requests reserve hours too).
  if (["PTO", "SICK"].includes(params.type)) {
    const { getPtoBalances } = await import("@/lib/services/timesheets");
    const balances = await getPtoBalances(params.userId);
    const available =
      params.type === "PTO" ? balances.pto.available : balances.sick.available;
    if (params.hours > available) {
      throw new Error(
        `Not enough ${params.type} balance: requesting ${params.hours}h with ${available}h available (accrued minus used and pending requests)`
      );
    }
  }
  const pto = await prisma.ptoRequest.create({
    data: {
      userId: params.userId,
      type: params.type,
      startDate: params.startDate,
      endDate: params.endDate,
      hours: params.hours,
      reason: params.reason || null,
      status: "PENDING",
    },
  });
  await logAudit({
    entityType: "PtoRequest",
    entityId: pto.id,
    action: "PTO_REQUESTED",
    userId: params.userId,
    metadata: { type: params.type, hours: params.hours },
  });
  return pto;
}

export async function decideTimeEntry(params: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  const existing = await prisma.timeEntry.findUniqueOrThrow({
    where: { id: params.id },
  });
  if (params.approver) {
    const ok = await canDecideFor(
      params.approver,
      existing.userId,
      "hr.time.decide"
    );
    if (!ok) throw new Error("Not authorized to decide this time entry");
  }
  const entry = await prisma.timeEntry.update({
    where: { id: params.id },
    data: {
      status: params.decision,
      // Labor cost posts to the WO/project rollup only on approval.
      costAmount:
        params.decision === "APPROVED"
          ? existing.hours * existing.laborRate
          : 0,
    },
  });
  await logAudit({
    entityType: "TimeEntry",
    entityId: entry.id,
    action: `TIME_${params.decision}`,
    userId: params.userId,
    changes: { status: params.decision, costAmount: entry.costAmount },
  });
  return entry;
}

const EXPENSE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["PAID"],
  REJECTED: ["SUBMITTED"],
  PAID: [],
};

export async function advanceExpenseReport(params: {
  id: string;
  status: string;
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  const existing = await prisma.expenseReport.findUniqueOrThrow({
    where: { id: params.id },
  });
  // Anyone may submit their own report; decisions need authority.
  if (params.approver && params.status !== "SUBMITTED") {
    const ok = await canDecideFor(
      params.approver,
      existing.userId,
      "hr.expense.decide"
    );
    if (!ok) throw new Error("Not authorized to decide this expense report");
  }
  const allowed = EXPENSE_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(params.status)) {
    throw new Error(
      `Expense ${existing.number}: cannot go ${existing.status} → ${params.status}`
    );
  }
  const report = await prisma.expenseReport.update({
    where: { id: params.id },
    data: {
      status: params.status,
      submittedAt:
        params.status === "SUBMITTED" ? new Date() : existing.submittedAt,
    },
  });
  await logAudit({
    entityType: "ExpenseReport",
    entityId: report.id,
    action: `EXPENSE_${params.status}`,
    userId: params.userId,
    changes: { from: existing.status, to: params.status },
  });
  return report;
}

export async function updateGoalProgress(params: {
  id: string;
  progress: number;
  userId?: string | null;
}) {
  const progress = Math.min(100, Math.max(0, params.progress));
  const goal = await prisma.employeeGoal.update({
    where: { id: params.id },
    data: {
      progress,
      status: progress >= 100 ? "COMPLETED" : "ACTIVE",
    },
  });
  await logAudit({
    entityType: "EmployeeGoal",
    entityId: goal.id,
    action: "GOAL_PROGRESS",
    userId: params.userId,
    changes: { progress, status: goal.status },
  });
  return goal;
}

/** Certification expiry buckets for the People tab. */
export function certExpiryTone(expires: string): "expired" | "soon" | "ok" {
  const d = new Date(expires);
  if (Number.isNaN(d.getTime())) return "ok";
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days < 90) return "soon";
  return "ok";
}

/** Pending approvals for a manager: their reports' PTO / time / expenses. */
export async function getPendingApprovals(user: {
  id: string;
  role: string;
}) {
  const persona = await getHrPersona(user);
  // HR admins see the whole company; managers see their reports.
  const scope = persona.isHrAdmin
    ? undefined
    : { in: persona.reportIds };

  const [ptoRequests, timesheetApprovals, expenses] = await Promise.all([
    prisma.ptoRequest.findMany({
      where: { status: "PENDING", ...(scope ? { userId: scope } : {}) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.timesheetApproval.findMany({
      where: {
        status: "PENDING",
        timesheet: { status: "SUBMITTED" },
        ...(persona.isHrAdmin ? {} : { approverId: user.id }),
      },
      include: {
        timesheet: { include: { user: true, entries: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expenseReport.findMany({
      where: {
        status: { in: ["SUBMITTED", "APPROVED"] },
        ...(scope ? { userId: scope } : {}),
      },
      include: { user: true, lines: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { persona, ptoRequests, timesheetApprovals, expenses };
}

/** Everything an employee sees on their own HR profile. */
export async function getEmployeeProfile(userId: string) {
  const [user, ptoRequests, timeEntries, expenses, reviews, goals, documents] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { manager: { select: { id: true, name: true, title: true } } },
      }),
      prisma.ptoRequest.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.timeEntry.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 10,
        include: { workOrder: true, project: true },
      }),
      prisma.expenseReport.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { lines: true },
      }),
      prisma.performanceReview.findMany({
        where: { employeeId: userId },
        include: { reviewer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.employeeGoal.findMany({
        where: { userId },
        orderBy: [{ status: "asc" }, { targetDate: "asc" }],
        include: {
          checkIns: {
            orderBy: { createdAt: "desc" },
            include: { author: { select: { name: true } } },
          },
        },
      }),
      prisma.employeeDocument.findMany({
        where: { userId },
        orderBy: { uploadedAt: "desc" },
      }),
    ]);
  const [training, feedback] = await Promise.all([
    prisma.trainingRecord.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { completedAt: "desc" }],
    }),
    // Employees see only feedback shared with them
    prisma.feedbackNote.findMany({
      where: { aboutUserId: userId, visibility: "SHARED" },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true, title: true } } },
    }),
  ]);
  const { getPtoBalances } = await import("@/lib/services/timesheets");
  const balances = await getPtoBalances(userId);
  return {
    user,
    ptoRequests,
    timeEntries,
    expenses,
    reviews,
    goals,
    documents,
    training,
    feedback,
    balances,
  };
}

/** A manager's view of their direct reports. */
export async function getTeamOverview(managerId: string) {
  const reports = await prisma.user.findMany({
    where: { managerId, isActive: true },
    orderBy: { name: "asc" },
    include: {
      performanceReviews: {
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { reviewer: { select: { name: true } } },
      },
      goals: {
        where: { status: "ACTIVE" },
        orderBy: { targetDate: "asc" },
      },
      ptoRequests: { where: { status: "PENDING" } },
      timeEntries: { where: { status: "SUBMITTED" } },
    },
  });
  return reports;
}

export async function upsertPerformanceReview(params: {
  id?: string;
  employeeId: string;
  reviewerId: string;
  period: string;
  status?: string;
  overallRating?: number | null;
  strengths?: string | null;
  improvements?: string | null;
  careerNotes?: string | null;
}) {
  const data = {
    period: params.period.trim(),
    status: params.status || "DRAFT",
    overallRating: params.overallRating ?? null,
    strengths: params.strengths?.trim() || null,
    improvements: params.improvements?.trim() || null,
    careerNotes: params.careerNotes?.trim() || null,
    completedAt: params.status === "COMPLETED" ? new Date() : null,
  };
  const review = params.id
    ? await prisma.performanceReview.update({
        where: { id: params.id },
        data,
      })
    : await prisma.performanceReview.create({
        data: {
          ...data,
          employeeId: params.employeeId,
          reviewerId: params.reviewerId,
        },
      });
  await logAudit({
    entityType: "PerformanceReview",
    entityId: review.id,
    action: params.id ? "REVIEW_UPDATED" : "REVIEW_CREATED",
    userId: params.reviewerId,
    changes: { period: review.period, status: review.status },
  });
  return review;
}

export async function createEmployeeGoal(params: {
  userId: string;
  title: string;
  category?: string;
  targetDate?: Date | null;
  description?: string | null;
  alignedTo?: string | null;
  createdById?: string | null;
}) {
  const goal = await prisma.employeeGoal.create({
    data: {
      userId: params.userId,
      title: params.title.trim(),
      category: params.category || "SKILL",
      targetDate: params.targetDate || null,
      description: params.description?.trim() || null,
      alignedTo: params.alignedTo?.trim() || null,
      status: "ACTIVE",
      progress: 0,
    },
  });
  await logAudit({
    entityType: "EmployeeGoal",
    entityId: goal.id,
    action: "GOAL_CREATED",
    userId: params.createdById,
    metadata: { for: params.userId, title: goal.title },
  });
  return goal;
}
