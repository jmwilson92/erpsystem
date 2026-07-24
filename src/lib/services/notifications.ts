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

  // Purchase-request work waiting on this specific user
  let prApprovals = 0;
  let buyerAssigned = 0;
  try {
    const { countPrApprovalsForUser } = await import(
      "@/lib/services/pr-approval"
    );
    prApprovals = await countPrApprovalsForUser({
      userId: user.id,
      userRole: user.role,
    });
    const { listPoAmendmentsForUser } = await import(
      "@/lib/services/po-amend"
    );
    prApprovals += (
      await listPoAmendmentsForUser({ userId: user.id, userRole: user.role })
    ).length;
    buyerAssigned = await prisma.purchaseRequest.count({
      where: {
        status: "SUBMITTED",
        assignedBuyerId: user.id,
        buyerConfirmedPrices: false,
      },
    });
  } catch {
    // advisory — never break the shell
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
  if (prApprovals > 0) {
    items.push({
      label: "Purchasing approvals waiting on your decision",
      count: prApprovals,
      href: "/approvals",
    });
  }
  if (buyerAssigned > 0) {
    items.push({
      label: "PRs assigned to you to package",
      count: buyerAssigned,
      href: "/purchasing?tab=prs",
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

  // Platform support badges only (dogfood) — never customer/demo instances
  try {
    const { isPlatformSupportEnabled } = await import("@/lib/platform");
    if (await isPlatformSupportEnabled()) {
      const {
        countOpenSupportForStaff,
        countUnreadRepliesForUser,
      } = await import("@/lib/services/support");
      if (user.role === "ADMIN") {
        const openSupport = await countOpenSupportForStaff();
        if (openSupport > 0) {
          items.push({
            label: "Support tickets awaiting reply",
            count: openSupport,
            href: "/admin/support",
          });
        }
      } else {
        const replies = await countUnreadRepliesForUser(user.id);
        if (replies > 0) {
          items.push({
            label: "Support replies waiting for you",
            count: replies,
            href: "/support",
          });
        }
      }
    }
  } catch {
    // advisory
  }

  // Several items can point at the same href (e.g. general + purchasing
  // approvals both land on /approvals). Sum them so sidebar/dashboard
  // badges reflect the combined count instead of the last one written.
  const badges: Record<string, number> = {};
  for (const i of items) {
    badges[i.href] = (badges[i.href] ?? 0) + i.count;
  }

  return {
    total: items.reduce((s, i) => s + i.count, 0),
    items,
    badges,
  };
}
