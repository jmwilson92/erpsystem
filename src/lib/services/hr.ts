/**
 * HR / Workforce workflows — PTO decisions, time approval with labor cost
 * posting, expense report lifecycle, and goal progress.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function decidePtoRequest(params: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  userId?: string | null;
}) {
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
}) {
  const existing = await prisma.timeEntry.findUniqueOrThrow({
    where: { id: params.id },
  });
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
}) {
  const existing = await prisma.expenseReport.findUniqueOrThrow({
    where: { id: params.id },
  });
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
