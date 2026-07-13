/**
 * Cross-module notification summary for the header bell and sidebar
 * badges. Everything is scoped to the current user: approvals to their
 * reports (or company-wide for HR admins), module alerts to modules
 * they can view.
 */
import { prisma } from "@/lib/db";
import { userCanView } from "@/lib/auth";
import { getHrPersona } from "@/lib/services/hr";

export type NotificationItem = {
  label: string;
  count: number;
  href: string;
};

export type NotificationSummary = {
  total: number;
  items: NotificationItem[];
  /** nav href → count, for sidebar badges */
  badges: Record<string, number>;
};

export async function getNotificationSummary(user: {
  id: string;
  role: string;
}): Promise<NotificationSummary> {
  const persona = await getHrPersona(user);
  const scope = persona.isHrAdmin ? undefined : { in: persona.reportIds };

  const [pto, time, expenses, pmAlerts, mrbOpen, canPmo, canMrb, myReviews, theirReviews, canInventory] =
    await Promise.all([
      prisma.ptoRequest.count({
        where: { status: "PENDING", ...(scope ? { userId: scope } : {}) },
      }),
      prisma.timesheetApproval.count({
        where: {
          status: "PENDING",
          timesheet: { status: "SUBMITTED" },
          ...(persona.isHrAdmin ? {} : { approverId: user.id }),
        },
      }),
      prisma.expenseReport.count({
        where: {
          status: { in: ["SUBMITTED", "APPROVED"] },
          ...(scope ? { userId: scope } : {}),
        },
      }),
      prisma.engAlert.count({ where: { isRead: false } }),
      prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
      userCanView(user.id, "pmo"),
      userCanView(user.id, "mrb"),
      prisma.performanceReview.count({
        where: {
          employeeId: user.id,
          OR: [
            { status: "SELF_REVIEW" },
            { status: "AWAITING_SIGNOFF", employeeSignedAt: null },
          ],
        },
      }),
      prisma.performanceReview.count({
        where: {
          reviewerId: user.id,
          OR: [
            { status: "IN_PROGRESS" },
            { status: "AWAITING_SIGNOFF", managerSignedAt: null },
          ],
        },
      }),
      userCanView(user.id, "inventory"),
    ]);

  // Kanban stockout risk: parts at/below min with nothing on order yet
  let shortageCount = 0;
  if (canInventory) {
    try {
      const { findKanbanShortages } = await import(
        "@/lib/services/kanban-replenishment"
      );
      shortageCount = (await findKanbanShortages()).length;
    } catch {
      // shortage scan is advisory — never break the shell over it
    }
  }

  const approvals = pto + time + expenses;
  const items: NotificationItem[] = [];
  if (approvals > 0) {
    items.push({
      label: "Approvals waiting on you",
      count: approvals,
      href: "/approvals",
    });
  }
  if (canPmo && pmAlerts > 0) {
    items.push({ label: "PM alerts", count: pmAlerts, href: "/pmo/alerts" });
  }
  if (canMrb && mrbOpen > 0) {
    items.push({ label: "Open MRB cases", count: mrbOpen, href: "/mrb" });
  }
  if (shortageCount > 0) {
    items.push({
      label: "Kanban parts below min (no PR yet)",
      count: shortageCount,
      href: "/inventory",
    });
  }
  const reviewActions = myReviews + theirReviews;
  if (reviewActions > 0) {
    items.push({
      label: "Reviews needing your input",
      count: reviewActions,
      href: "/hr",
    });
  }

  // Overdue/expiring reviews & training for HR admins and managers
  if (persona.isHrAdmin || persona.isManager) {
    try {
      const { getComplianceItems } = await import("@/lib/services/hr");
      const compliance = await getComplianceItems(user);
      const overdue = compliance.filter((c) => c.daysOut < 0).length;
      if (overdue > 0) {
        items.push({
          label: "Overdue reviews / expired training",
          count: overdue,
          href: "/hr?tab=compliance",
        });
      }
    } catch {
      // advisory — never break the shell
    }
  }

  return {
    total: items.reduce((s, i) => s + i.count, 0),
    items,
    badges: Object.fromEntries(items.map((i) => [i.href, i.count])),
  };
}
