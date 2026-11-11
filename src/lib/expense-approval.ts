/** Internal expense approval evidence. Never an actor-id server-action surface. */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type Expense = { id: string; userId: string; title: string; lines: { id: string; amount: number; date: Date; category: string; description: string; receiptUrl: string | null }[] };
export function expenseFingerprint(report: Expense): string {
  return createHash("sha256").update(JSON.stringify({ userId: report.userId, title: report.title,
    lines: [...report.lines].sort((a, b) => a.id.localeCompare(b.id)).map(line => ({ id: line.id, amount: line.amount, date: line.date.toISOString(), category: line.category, description: line.description, receiptUrl: line.receiptUrl })),
  })).digest("hex");
}
export function reimbursementAmount(report: Expense): number {
  if (!report.lines.length || report.lines.some(line => !Number.isFinite(line.amount) || line.amount < 0)) {
    throw new Error("Reimbursement requires finite nonnegative expense lines");
  }
  const amount = Math.round(report.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Reimbursement amount must be finite and positive");
  return amount;
}
export async function expenseSubmission(db: Prisma.TransactionClient, reportId: string) {
  const submission = await db.auditLog.findFirst({ where: { entityType: "ExpenseReport", entityId: reportId, action: "EXPENSE_SUBMITTED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!submission?.userId) throw new Error("Submission identity is missing; return the report and re-submit it for independent approval");
  return submission;
}
export async function assertIndependentExpenseActor(db: Prisma.TransactionClient, report: { id: string; userId: string }, actorId: string) {
  const submission = await expenseSubmission(db, report.id);
  const submittedByActor = await db.auditLog.findFirst({ where: { entityType: "ExpenseReport", entityId: report.id, action: "EXPENSE_SUBMITTED", userId: actorId }, select: { id: true } });
  if (actorId === report.userId || submittedByActor) throw new Error("Expense submitter cannot approve or authorize their own reimbursement, including administrators");
  return submission;
}
export async function independentExpenseApproval(db: Prisma.TransactionClient, report: Expense, actorId: string) {
  const submission = await assertIndependentExpenseActor(db, report, actorId);
  const fingerprint = expenseFingerprint(report);
  const approvals = await db.auditLog.findMany({ where: { entityType: "ExpenseReport", entityId: report.id, action: "EXPENSE_APPROVED", userId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const submissions = await db.auditLog.findMany({ where: { entityType: "ExpenseReport", entityId: report.id, action: "EXPENSE_SUBMITTED" }, select: { userId: true } });
  const submitters = new Set(submissions.map(row => row.userId));
  const approval = approvals.find(row => {
    let evidence: Record<string, unknown>; try { evidence = JSON.parse(row.metadata || "{}"); } catch { return false; }
    return row.userId !== report.userId && !submitters.has(row.userId) && evidence.submissionAuditId === submission.id && evidence.expenseFingerprint === fingerprint;
  });
  if (!approval?.userId) throw new Error("Independent expense approval is missing or stale; return the report and re-submit it for approval");
  return approval;
}
