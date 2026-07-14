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
  kind:
    | "REVIEW_OVERDUE"
    | "REVIEW_DUE_SOON"
    | "TRAINING_EXPIRED"
    | "TRAINING_EXPIRING"
    | "TRAINING_MISSING"
    | "TRAINING_OVERDUE";
  userId: string;
  employeeName: string;
  label: string;
  dueDate: Date | null;
  daysOut: number; // negative = overdue/expired
  href: string;
};

export type TrainingGapStatus = "MISSING" | "OVERDUE" | "DUE_SOON" | "CURRENT";

export type TrainingGap = {
  requirementId: string;
  requirementName: string;
  requirementType: string;
  frequencyMonths: number;
  userId: string;
  employeeName: string;
  department: string | null;
  status: TrainingGapStatus;
  /** Next completion due (null for MISSING / one-time CURRENT) */
  dueDate: Date | null;
  daysOut: number | null;
  /** True when the due date came from the record's own expiresAt (already
   *  surfaced by the expiring-training query — used to dedupe alerts) */
  fromRecordExpiry: boolean;
};

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

/**
 * Recurring-training compliance matrix: every active TrainingRequirement ×
 * every applicable active employee, matched (by name, case-insensitive)
 * against their latest completed TrainingRecord.
 */
export async function getTrainingMatrix(
  scopeUserIds?: string[]
): Promise<TrainingGap[]> {
  const [requirements, employees] = await Promise.all([
    prisma.trainingRequirement.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        ...(scopeUserIds ? { id: { in: scopeUserIds } } : {}),
      },
      select: { id: true, name: true, department: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (requirements.length === 0 || employees.length === 0) return [];

  const records = await prisma.trainingRecord.findMany({
    where: {
      status: { in: ["COMPLETED", "EXPIRED"] },
      ...(scopeUserIds ? { userId: { in: scopeUserIds } } : {}),
    },
    select: {
      userId: true,
      name: true,
      completedAt: true,
      expiresAt: true,
    },
    orderBy: { completedAt: "desc" },
  });
  // Latest record per (user, training name)
  const latest = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    const key = `${r.userId}:${r.name.trim().toLowerCase()}`;
    if (!latest.has(key)) latest.set(key, r);
  }

  const now = Date.now();
  const soon = 30 * 86_400_000;
  const gaps: TrainingGap[] = [];

  for (const req of requirements) {
    const reqKey = req.name.trim().toLowerCase();
    const applicable = req.department
      ? employees.filter(
          (e) =>
            (e.department || "").toLowerCase() ===
            req.department!.toLowerCase()
        )
      : employees;

    for (const emp of applicable) {
      const rec = latest.get(`${emp.id}:${reqKey}`);
      const base = {
        requirementId: req.id,
        requirementName: req.name,
        requirementType: req.type,
        frequencyMonths: req.frequencyMonths,
        userId: emp.id,
        employeeName: emp.name,
        department: emp.department,
      };
      if (!rec || !rec.completedAt) {
        gaps.push({
          ...base,
          status: "MISSING",
          dueDate: null,
          daysOut: null,
          fromRecordExpiry: false,
        });
        continue;
      }
      const due =
        rec.expiresAt ||
        (req.frequencyMonths > 0
          ? addMonths(rec.completedAt, req.frequencyMonths)
          : null);
      if (!due) {
        gaps.push({
          ...base,
          status: "CURRENT",
          dueDate: null,
          daysOut: null,
          fromRecordExpiry: false,
        });
        continue;
      }
      const daysOut = Math.floor((due.getTime() - now) / 86_400_000);
      gaps.push({
        ...base,
        status:
          daysOut < 0 ? "OVERDUE" : daysOut * 86_400_000 < soon ? "DUE_SOON" : "CURRENT",
        dueDate: due,
        daysOut,
        fromRecordExpiry: !!rec.expiresAt,
      });
    }
  }

  // Worst first: MISSING, then most-overdue
  const rank: Record<TrainingGapStatus, number> = {
    MISSING: 0,
    OVERDUE: 1,
    DUE_SOON: 2,
    CURRENT: 3,
  };
  gaps.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.daysOut ?? 0) - (b.daysOut ?? 0) ||
      a.employeeName.localeCompare(b.employeeName)
  );
  return gaps;
}

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

  // Recurring-requirement gaps: never-completed + overdue cycles. Items whose
  // due date came from a record's own expiresAt are already covered above.
  try {
    const gaps = await getTrainingMatrix(scope);
    for (const g of gaps) {
      if (g.status === "MISSING") {
        items.push({
          kind: "TRAINING_MISSING",
          userId: g.userId,
          employeeName: g.employeeName,
          label: `${g.requirementName} — required, never completed`,
          dueDate: null,
          daysOut: -1,
          href: `/hr/person/${g.userId}`,
        });
      } else if (g.status === "OVERDUE" && !g.fromRecordExpiry) {
        items.push({
          kind: "TRAINING_OVERDUE",
          userId: g.userId,
          employeeName: g.employeeName,
          label: `${g.requirementName} — cycle overdue (every ${g.frequencyMonths} mo)`,
          dueDate: g.dueDate,
          daysOut: g.daysOut ?? -1,
          href: `/hr/person/${g.userId}`,
        });
      }
    }
  } catch {
    /* matrix is best-effort — never break compliance list */
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
  decisionNotes?: string | null;
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  if (params.decision === "REJECTED" && !params.decisionNotes?.trim()) {
    throw new Error("A rejection reason is required");
  }
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
      decisionNotes: params.decisionNotes?.trim() || null,
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
  decisionNotes?: string | null;
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  if (params.decision === "REJECTED" && !params.decisionNotes?.trim()) {
    throw new Error("A rejection reason is required");
  }
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
      decisionNotes: params.decisionNotes?.trim() || null,
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
  decisionNotes?: string | null;
  userId?: string | null;
  approver?: { id: string; role: string } | null;
}) {
  if (params.status === "REJECTED" && !params.decisionNotes?.trim()) {
    throw new Error("A rejection reason is required");
  }
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
      decisionNotes:
        params.status === "REJECTED"
          ? params.decisionNotes?.trim() || null
          : existing.decisionNotes,
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
  ratingRationale?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  careerNotes?: string | null;
}) {
  // A rating without a written justification isn't allowed.
  if (
    params.overallRating != null &&
    !params.ratingRationale?.trim()
  ) {
    throw new Error("Explain the rating — a written rationale is required.");
  }
  const data = {
    period: params.period.trim(),
    status: params.status || "DRAFT",
    overallRating: params.overallRating ?? null,
    ratingRationale: params.ratingRationale?.trim() || null,
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
