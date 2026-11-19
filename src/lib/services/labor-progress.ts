/**
 * Work-order labor % complete, estimate learning, and project/budget rollups.
 *
 * Allocated hours resolve BOM (if set) then the item card, else the existing
 * WI/traveler minute estimate. The total is snapshotted onto the WO at
 * release (and set at create so planning can use it). % complete is
 * clocked time-entry hours / allocated hours. Crossing 100% notifies the
 * assignee plus configured production/planner roles once per WO.
 * Completing a WO records last-actual hours/unit for the next order,
 * unless the estimate is manually locked.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ROLES, type Role } from "@/lib/auth";

export const DEFAULT_OVERRUN_ROLES: Role[] = ["PRODUCTION", "PM"];

export const WORKED_TIME_TYPES = ["REGULAR", "OT", "ENG_SCAN"] as const;

export type LaborEstimateSource =
  | "BOM"
  | "ITEM"
  | "LAST_ACTUAL"
  | "MANUAL"
  | "OVERRIDE"
  | "WI"
  | "TRAVELER"
  | "DEFAULT";

export type LaborProgress = {
  workOrderId: string;
  number: string;
  status: string;
  quantity: number;
  partId: string | null;
  partNumber: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectName: string | null;
  budgetId: string | null;
  budgetName: string | null;
  allocatedHours: number | null;
  allocatedHoursPerUnit: number | null;
  clockedHours: number;
  remainingHours: number | null;
  percentComplete: number | null;
  overAllocated: boolean;
  laborEstimateSource: string | null;
  laborCost: number;
  assigneeName: string | null;
  dueDate: Date | null;
};

export type LaborRollup = {
  rows: LaborProgress[];
  workOrderCount: number;
  allocatedHours: number;
  clockedHours: number;
  remainingHours: number;
  percentComplete: number | null;
  overAllocatedCount: number;
  laborCost: number;
  laborBudget: number | null;
  laborCostVariance: number | null;
};

export type LaborProgressFilters = {
  projectId?: string | null;
  budgetId?: string | null;
  from?: Date | null;
  to?: Date | null;
  includeCompleted?: boolean;
};

export function laborPercent(
  clockedHours: number,
  allocatedHours: number | null | undefined
): number | null {
  if (allocatedHours == null || allocatedHours <= 0) return null;
  return Math.round((clockedHours / allocatedHours) * 1000) / 10;
}

export function isOverAllocated(
  clockedHours: number,
  allocatedHours: number | null | undefined
): boolean {
  const pct = laborPercent(clockedHours, allocatedHours);
  return pct != null && pct > 100;
}

/** Hours of man-load still to schedule: remaining after clocked when allocated is known. */
export function laborLoadHours(params: {
  allocatedHours?: number | null;
  clockedHours?: number | null;
  estimatedMinutes?: number | null;
  status?: string | null;
}): number {
  const allocated =
    params.allocatedHours != null && params.allocatedHours > 0
      ? params.allocatedHours
      : (params.estimatedMinutes || 0) / 60;
  const clocked = Math.max(0, params.clockedHours || 0);
  const remaining = Math.max(0, allocated - clocked);
  const closed = ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"].includes(
    (params.status || "").toUpperCase()
  );
  if (closed) return 0;
  return Math.round(remaining * 100) / 100;
}

export function resolveAllocatedHours(opts: {
  quantity: number;
  bomHoursPerUnit?: number | null;
  itemHoursPerUnit?: number | null;
  itemSource?: string | null;
  bomSource?: string | null;
  wiEstimatedMinutes?: number | null;
  travelerEstimatedMinutes?: number | null;
}): {
  allocatedHours: number | null;
  allocatedHoursPerUnit: number | null;
  source: LaborEstimateSource | null;
} {
  const qty = Math.max(0, opts.quantity || 0) || 1;
  if (opts.bomHoursPerUnit != null && opts.bomHoursPerUnit > 0) {
    const src: LaborEstimateSource =
      opts.bomSource === "LAST_ACTUAL"
        ? "LAST_ACTUAL"
        : opts.bomSource === "OVERRIDE"
          ? "OVERRIDE"
          : "BOM";
    return {
      allocatedHoursPerUnit: opts.bomHoursPerUnit,
      allocatedHours: roundHours(opts.bomHoursPerUnit * qty),
      source: src,
    };
  }
  if (opts.itemHoursPerUnit != null && opts.itemHoursPerUnit > 0) {
    const src: LaborEstimateSource =
      opts.itemSource === "LAST_ACTUAL"
        ? "LAST_ACTUAL"
        : opts.itemSource === "OVERRIDE"
          ? "OVERRIDE"
          : "ITEM";
    return {
      allocatedHoursPerUnit: opts.itemHoursPerUnit,
      allocatedHours: roundHours(opts.itemHoursPerUnit * qty),
      source: src,
    };
  }
  const traveler = opts.travelerEstimatedMinutes;
  if (traveler != null && traveler > 0) {
    const hours = traveler / 60;
    return {
      allocatedHours: roundHours(hours),
      allocatedHoursPerUnit: roundHours(hours / qty),
      source: "TRAVELER",
    };
  }
  const wi = opts.wiEstimatedMinutes;
  if (wi != null && wi > 0) {
    const hours = wi / 60;
    return {
      allocatedHours: roundHours(hours),
      allocatedHoursPerUnit: roundHours(hours / qty),
      source: "WI",
    };
  }
  return { allocatedHours: null, allocatedHoursPerUnit: null, source: null };
}

function roundHours(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function sumClocked(workOrderId: string): Promise<{ hours: number; cost: number }> {
  const entries = await prisma.timeEntry.findMany({
    where: {
      workOrderId,
      type: { in: [...WORKED_TIME_TYPES] },
    },
    select: { hours: true, costAmount: true, laborRate: true },
  });
  let hours = 0;
  let cost = 0;
  for (const e of entries) {
    hours += e.hours || 0;
    cost += e.costAmount || (e.laborRate || 0) * (e.hours || 0);
  }
  return { hours: roundHours(hours), cost: Math.round(cost * 100) / 100 };
}

async function resolveFromMasters(params: {
  partId?: string | null;
  bomHeaderId?: string | null;
  quantity: number;
  estimatedMinutes?: number | null;
}): Promise<{
  allocatedHours: number | null;
  allocatedHoursPerUnit: number | null;
  source: LaborEstimateSource | null;
}> {
  const [part, bom] = await Promise.all([
    params.partId
      ? prisma.part.findUnique({
          where: { id: params.partId },
          select: {
            allocatedHoursPerUnit: true,
            laborEstimateSource: true,
          },
        })
      : Promise.resolve(null),
    params.bomHeaderId
      ? prisma.bomHeader.findUnique({
          where: { id: params.bomHeaderId },
          select: {
            allocatedHoursPerUnit: true,
            laborEstimateSource: true,
          },
        })
      : Promise.resolve(null),
  ]);
  return resolveAllocatedHours({
    quantity: params.quantity,
    bomHoursPerUnit: bom?.allocatedHoursPerUnit,
    bomSource: bom?.laborEstimateSource,
    itemHoursPerUnit: part?.allocatedHoursPerUnit,
    itemSource: part?.laborEstimateSource,
    wiEstimatedMinutes: params.estimatedMinutes,
  });
}

/**
 * Snapshot allocated hours onto the WO. At release the snapshot is frozen
 * unless the WO is unlocked. Safe to call on create / refresh too.
 */
export async function snapshotWorkOrderAllocatedHours(params: {
  workOrderId: string;
  userId?: string;
  force?: boolean;
  freeze?: boolean;
}): Promise<{
  allocatedHours: number | null;
  allocatedHoursPerUnit: number | null;
  source: LaborEstimateSource | null;
}> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");

  const frozen =
    wo.laborEstimateLocked ||
    (!params.force &&
      wo.allocatedHours != null &&
      [
        "RELEASED",
        "IN_PROGRESS",
        "COMPLETED",
        "CLOSED",
        "READY_FOR_PUTAWAY",
      ].includes(wo.status));

  if (frozen && wo.allocatedHours != null) {
    return {
      allocatedHours: wo.allocatedHours,
      allocatedHoursPerUnit: wo.allocatedHoursPerUnit,
      source: (wo.laborEstimateSource as LaborEstimateSource) || null,
    };
  }

  const resolved = await resolveFromMasters({
    partId: wo.partId,
    bomHeaderId: wo.bomHeaderId,
    quantity: wo.quantity,
    estimatedMinutes: wo.estimatedMinutes,
  });

  const estimatedMinutes =
    resolved.allocatedHours != null
      ? Math.round(resolved.allocatedHours * 60)
      : wo.estimatedMinutes;

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      allocatedHours: resolved.allocatedHours,
      allocatedHoursPerUnit: resolved.allocatedHoursPerUnit,
      laborEstimateSource: resolved.source,
      estimatedMinutes,
      ...(resolved.source &&
      !["WI", "TRAVELER", "DEFAULT"].includes(resolved.source)
        ? { estimateSource: resolved.source, estimateUpdatedAt: new Date() }
        : {}),
    },
  });

  await prisma.laborEstimateHistory.create({
    data: {
      workOrderId: wo.id,
      partId: wo.partId,
      bomHeaderId: wo.bomHeaderId,
      source: params.freeze ? "SNAPSHOT" : resolved.source || "SNAPSHOT",
      hoursPerUnit: resolved.allocatedHoursPerUnit ?? 0,
      totalHours: resolved.allocatedHours,
      quantity: wo.quantity,
      userId: params.userId,
      notes: params.freeze ? "Snapshotted at release" : "Allocated hours set",
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "LABOR_ALLOCATION_SNAPSHOT",
    userId: params.userId,
    metadata: resolved,
  });

  return resolved;
}

export async function getWorkOrderLaborProgress(
  workOrderId: string
): Promise<LaborProgress> {
  const map = await getWorkOrderLaborProgressMany([workOrderId]);
  const row = map.get(workOrderId);
  if (!row) throw new Error("Work order not found");
  return row;
}

export async function getWorkOrderLaborProgressMany(
  workOrderIds: string[]
): Promise<Map<string, LaborProgress>> {
  const out = new Map<string, LaborProgress>();
  if (workOrderIds.length === 0) return out;

  const wos = await prisma.workOrder.findMany({
    where: { id: { in: workOrderIds } },
    include: {
      part: { select: { partNumber: true } },
      project: { select: { number: true, name: true } },
      assignee: { select: { name: true } },
    },
  });

  const grouped = await prisma.timeEntry.groupBy({
    by: ["workOrderId"],
    where: {
      workOrderId: { in: workOrderIds },
      type: { in: [...WORKED_TIME_TYPES] },
    },
    _sum: { hours: true, costAmount: true },
  });
  const clock = new Map<string, { hours: number; cost: number }>();
  for (const g of grouped) {
    if (!g.workOrderId) continue;
    clock.set(g.workOrderId, {
      hours: roundHours(g._sum.hours || 0),
      cost: Math.round((g._sum.costAmount || 0) * 100) / 100,
    });
  }

  // Labor cost fallback when costAmount is 0 but laborRate * hours was not posted
  const needRate = wos
    .filter((w) => (clock.get(w.id)?.cost || 0) === 0)
    .map((w) => w.id);
  if (needRate.length) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        workOrderId: { in: needRate },
        type: { in: [...WORKED_TIME_TYPES] },
      },
      select: { workOrderId: true, hours: true, laborRate: true, costAmount: true },
    });
    const extra = new Map<string, number>();
    for (const e of entries) {
      if (!e.workOrderId) continue;
      const add = e.costAmount || (e.laborRate || 0) * (e.hours || 0);
      extra.set(e.workOrderId, (extra.get(e.workOrderId) || 0) + add);
    }
    for (const [id, cost] of extra) {
      const cur = clock.get(id) || { hours: 0, cost: 0 };
      clock.set(id, { ...cur, cost: Math.round(cost * 100) / 100 });
    }
  }

  // A WO may have time charged to a budget even without a project budget link
  const budgetLinks = await prisma.timeEntry.findMany({
    where: {
      workOrderId: { in: workOrderIds },
      budgetId: { not: null },
    },
    select: {
      workOrderId: true,
      budgetId: true,
      budget: { select: { name: true } },
    },
    distinct: ["workOrderId"],
  });
  const budgetByWo = new Map<
    string,
    { id: string; name: string | null }
  >();
  for (const b of budgetLinks) {
    if (b.workOrderId && b.budgetId) {
      budgetByWo.set(b.workOrderId, {
        id: b.budgetId,
        name: b.budget?.name || null,
      });
    }
  }

  for (const wo of wos) {
    const c = clock.get(wo.id) || { hours: 0, cost: 0 };
    const allocated = wo.allocatedHours;
    const remaining =
      allocated != null ? roundHours(Math.max(0, allocated - c.hours)) : null;
    const pct = laborPercent(c.hours, allocated);
    const bud = budgetByWo.get(wo.id);
    out.set(wo.id, {
      workOrderId: wo.id,
      number: wo.number,
      status: wo.status,
      quantity: wo.quantity,
      partId: wo.partId,
      partNumber: wo.part?.partNumber || null,
      projectId: wo.projectId,
      projectNumber: wo.project?.number || null,
      projectName: wo.project?.name || null,
      budgetId: bud?.id || null,
      budgetName: bud?.name || null,
      allocatedHours: allocated,
      allocatedHoursPerUnit: wo.allocatedHoursPerUnit,
      clockedHours: c.hours,
      remainingHours: remaining,
      percentComplete: pct,
      overAllocated: isOverAllocated(c.hours, allocated),
      laborEstimateSource: wo.laborEstimateSource,
      laborCost: c.cost,
      assigneeName: wo.assignee?.name || null,
      dueDate: wo.dueDate,
    });
  }
  return out;
}

async function rollup(rows: LaborProgress[], laborBudget?: number | null): Promise<LaborRollup> {
  const allocatedHours = roundHours(
    rows.reduce((s, r) => s + (r.allocatedHours || 0), 0)
  );
  const clockedHours = roundHours(rows.reduce((s, r) => s + r.clockedHours, 0));
  const remainingHours = roundHours(
    rows.reduce((s, r) => s + (r.remainingHours || 0), 0)
  );
  const laborCost = Math.round(rows.reduce((s, r) => s + r.laborCost, 0) * 100) / 100;
  const budget = laborBudget != null ? laborBudget : null;
  return {
    rows,
    workOrderCount: rows.length,
    allocatedHours,
    clockedHours,
    remainingHours,
    percentComplete: laborPercent(clockedHours, allocatedHours > 0 ? allocatedHours : null),
    overAllocatedCount: rows.filter((r) => r.overAllocated).length,
    laborCost,
    laborBudget: budget,
    laborCostVariance:
      budget != null ? Math.round((laborCost - budget) * 100) / 100 : null,
  };
}

export async function getProjectLaborProgress(projectId: string): Promise<LaborRollup> {
  const [wos, project] = await Promise.all([
    prisma.workOrder.findMany({
      where: { projectId },
      select: { id: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      include: { budgets: { select: { laborBudget: true, status: true } } },
    }),
  ]);
  const map = await getWorkOrderLaborProgressMany(wos.map((w) => w.id));
  const laborBudget = (project?.budgets || [])
    .filter((b) => !b.status || !["CANCELLED", "DRAFT"].includes(b.status))
    .reduce((s, b) => s + (b.laborBudget || 0), 0);
  return rollup([...map.values()].sort((a, b) => a.number.localeCompare(b.number)), laborBudget);
}

export async function getBudgetLaborProgress(budgetId: string): Promise<LaborRollup> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { id: true, projectId: true, laborBudget: true, name: true },
  });
  if (!budget) throw new Error("Budget not found");

  const charged = await prisma.timeEntry.findMany({
    where: { budgetId, workOrderId: { not: null } },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });
  const ids = new Set(charged.map((c) => c.workOrderId!).filter(Boolean));
  if (budget.projectId) {
    const projectWos = await prisma.workOrder.findMany({
      where: { projectId: budget.projectId },
      select: { id: true },
    });
    for (const w of projectWos) ids.add(w.id);
  }
  const map = await getWorkOrderLaborProgressMany([...ids]);
  return rollup([...map.values()].sort((a, b) => a.number.localeCompare(b.number)), budget.laborBudget);
}

export async function queryLaborProgressReport(
  filters: LaborProgressFilters = {}
): Promise<LaborRollup> {
  const where: Record<string, unknown> = {};
  if (filters.projectId) where.projectId = filters.projectId;
  if (!filters.includeCompleted) {
    where.status = { notIn: ["CANCELLED", "SCRAPPED"] };
  }
  if (filters.from || filters.to) {
    where.OR = [
      {
        plannedStart: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      },
      {
        dueDate: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      },
      {
        actualStart: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      },
    ];
  }

  let ids: string[] = (
    await prisma.workOrder.findMany({ where, select: { id: true } })
  ).map((w) => w.id);

  if (filters.budgetId) {
    const roll = await getBudgetLaborProgress(filters.budgetId);
    const allow = new Set(ids);
    const rows = filters.projectId || filters.from || filters.to
      ? roll.rows.filter((r) => allow.has(r.workOrderId))
      : roll.rows;
    return rollup(rows, roll.laborBudget);
  }

  const map = await getWorkOrderLaborProgressMany(ids);
  return rollup([...map.values()].sort((a, b) => a.number.localeCompare(b.number)));
}

export function laborProgressToCsv(rollup: LaborRollup): string {
  const headers = [
    "Work Order",
    "Status",
    "Part",
    "Project",
    "Budget",
    "Qty",
    "Allocated Hours",
    "Clocked Hours",
    "Remaining Hours",
    "% Complete",
    "Over Allocated",
    "Estimate Source",
    "Labor Cost",
    "Assignee",
    "Due Date",
  ];
  const lines = [headers.join(",")];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const r of rollup.rows) {
    lines.push(
      [
        r.number,
        r.status,
        r.partNumber,
        r.projectNumber || r.projectName,
        r.budgetName,
        r.quantity,
        r.allocatedHours,
        r.clockedHours,
        r.remainingHours,
        r.percentComplete,
        r.overAllocated ? "YES" : "NO",
        r.laborEstimateSource,
        r.laborCost,
        r.assigneeName,
        r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "",
      ]
        .map(esc)
        .join(",")
    );
  }
  lines.push("");
  lines.push(
    [
      "TOTALS",
      "",
      "",
      "",
      "",
      "",
      rollup.allocatedHours,
      rollup.clockedHours,
      rollup.remainingHours,
      rollup.percentComplete,
      rollup.overAllocatedCount,
      "",
      rollup.laborCost,
      rollup.laborBudget != null ? `budget ${rollup.laborBudget}` : "",
      rollup.laborCostVariance != null ? `variance ${rollup.laborCostVariance}` : "",
    ]
      .map(esc)
      .join(",")
  );
  return lines.join("\n");
}

export async function getLaborOverrunNotifyRoles(): Promise<string[]> {
  const row = await prisma.companySettings.findUnique({
    where: { id: "default" },
    select: { laborOverrunNotifyRoles: true },
  });
  if (!row?.laborOverrunNotifyRoles) return [...DEFAULT_OVERRUN_ROLES];
  try {
    const parsed = JSON.parse(row.laborOverrunNotifyRoles);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const allowed = new Set<string>(ROLES);
      const roles = parsed.map((x) => String(x).toUpperCase()).filter((r) => allowed.has(r));
      return roles.length ? roles : [...DEFAULT_OVERRUN_ROLES];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_OVERRUN_ROLES];
}

export async function setLaborOverrunNotifyRoles(params: {
  roles: string[];
  userId?: string;
}): Promise<string[]> {
  const allowed = new Set<string>(ROLES);
  const roles = [
    ...new Set(params.roles.map((r) => r.toUpperCase()).filter((r) => allowed.has(r))),
  ];
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      laborOverrunNotifyRoles: JSON.stringify(roles),
      updatedById: params.userId,
    },
    update: {
      laborOverrunNotifyRoles: JSON.stringify(roles),
      updatedById: params.userId,
    },
  });
  return roles;
}

export async function onWorkOrderTimeChanged(workOrderId: string): Promise<{
  notified: boolean;
  progress: LaborProgress;
}> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (wo && wo.allocatedHours == null) {
    await snapshotWorkOrderAllocatedHours({ workOrderId });
  }
  const progress = await getWorkOrderLaborProgress(workOrderId);
  const notified = await notifyIfOverAllocated(workOrderId, progress);
  return { notified, progress };
}

export async function notifyIfOverAllocated(
  workOrderId: string,
  known?: LaborProgress
): Promise<boolean> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      assignee: { select: { id: true, email: true, name: true, isActive: true } },
      createdBy: { select: { id: true, email: true, name: true, isActive: true } },
    },
  });
  if (!wo) return false;
  if (wo.overAllocatedNotifiedAt) return false;

  const progress = known || (await getWorkOrderLaborProgress(workOrderId));
  if (!progress.overAllocated) return false;

  const roles = await getLaborOverrunNotifyRoles();
  const roleUsers = roles.length
    ? await prisma.user.findMany({
        where: { isActive: true, role: { in: roles } },
        select: { id: true, email: true, name: true, isActive: true },
      })
    : [];

  const recipients = new Map<string, { id: string; email: string; name: string }>();
  const consider = [wo.assignee, wo.createdBy, ...roleUsers];
  for (const u of consider) {
    if (u?.id && u.isActive !== false) {
      recipients.set(u.id, { id: u.id, email: u.email, name: u.name });
    }
  }

  const pct = progress.percentComplete ?? 0;
  const title = `${wo.number} is over allocated labor hours`;
  const body =
    `Work order ${wo.number} has exceeded its allocated labor hours ` +
    `(${progress.clockedHours}h clocked / ${progress.allocatedHours}h allocated, ${pct}%). ` +
    `Please check what's happening on the floor.`;
  const href = `/work-orders/${wo.id}`;

  for (const user of recipients.values()) {
    await prisma.userNotification.create({
      data: {
        userId: user.id,
        type: "LABOR_OVERRUN",
        title,
        body,
        href,
        entityType: "WorkOrder",
        entityId: wo.id,
      },
    });
    if (user.email) {
      try {
        const { sendEmail } = await import("@/lib/services/email");
        await sendEmail({
          to: user.email,
          subject: title,
          body,
          entityType: "WorkOrder",
          entityId: wo.id,
          entityLabel: wo.number,
        });
      } catch (err) {
        // Notification already stored in-app; email is best-effort.
        console.warn("labor overrun email failed", err);
      }
    }
  }

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: { overAllocatedNotifiedAt: new Date() },
  });
  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "LABOR_OVERRUN_NOTIFIED",
    metadata: {
      clockedHours: progress.clockedHours,
      allocatedHours: progress.allocatedHours,
      percentComplete: pct,
      recipientIds: [...recipients.keys()],
    },
  });
  return true;
}

export async function recordCompletionActuals(params: {
  workOrderId: string;
  userId?: string;
}): Promise<{ hoursPerUnit: number; updated: boolean } | null> {
  const wo = await prisma.workOrder.findUnique({ where: { id: params.workOrderId } });
  if (!wo) throw new Error("Work order not found");
  if (wo.laborActualRecordedAt) {
    return null;
  }
  const { hours } = await sumClocked(wo.id);
  const qty = Math.max(wo.quantity || 1, 0.0001);
  const hoursPerUnit = roundHours(hours / qty);

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: { laborActualRecordedAt: new Date() },
  });
  await prisma.laborEstimateHistory.create({
    data: {
      workOrderId: wo.id,
      partId: wo.partId,
      bomHeaderId: wo.bomHeaderId,
      source: "COMPLETION",
      hoursPerUnit,
      totalHours: hours,
      quantity: wo.quantity,
      userId: params.userId,
      notes: "Actual hours at completion",
    },
  });

  let updated = false;
  const usedBom =
    wo.laborEstimateSource === "BOM" ||
    wo.laborEstimateSource === "LAST_ACTUAL" && !!wo.bomHeaderId;
  // Prefer updating the master that supplied the snapshot; always store last actual on the part.
  if (wo.bomHeaderId) {
    const bom = await prisma.bomHeader.findUnique({ where: { id: wo.bomHeaderId } });
    if (bom) {
      const data: Record<string, unknown> = {
        lastActualHoursPerUnit: hoursPerUnit,
        laborEstimateUpdatedAt: new Date(),
      };
      if (!bom.laborEstimateLocked) {
        data.allocatedHoursPerUnit = hoursPerUnit;
        data.laborEstimateSource = "LAST_ACTUAL";
        updated = true;
      }
      await prisma.bomHeader.update({ where: { id: bom.id }, data });
      await prisma.laborEstimateHistory.create({
        data: {
          bomHeaderId: bom.id,
          partId: wo.partId,
          workOrderId: wo.id,
          source: bom.laborEstimateLocked ? "COMPLETION" : "LAST_ACTUAL",
          hoursPerUnit,
          totalHours: hours,
          quantity: wo.quantity,
          userId: params.userId,
          notes: bom.laborEstimateLocked
            ? "Last actual recorded; estimate locked"
            : "Estimate updated from last actual",
        },
      });
    }
  }
  if (wo.partId) {
    const part = await prisma.part.findUnique({ where: { id: wo.partId } });
    if (part) {
      const data: Record<string, unknown> = {
        lastActualHoursPerUnit: hoursPerUnit,
        laborEstimateUpdatedAt: new Date(),
      };
      // If the snapshot came from the item (or there is no BOM hours), roll the item estimate forward unless locked.
      const shouldUpdateItem =
        !part.laborEstimateLocked &&
        (!wo.bomHeaderId || wo.laborEstimateSource === "ITEM" || !usedBom);
      if (shouldUpdateItem || !part.laborEstimateLocked && !wo.bomHeaderId) {
        data.allocatedHoursPerUnit = hoursPerUnit;
        data.laborEstimateSource = "LAST_ACTUAL";
        updated = true;
      }
      // Always update last actual; update allocated when not locked and this source was the item or no BOM override
      if (!part.laborEstimateLocked && (wo.laborEstimateSource !== "BOM" || !wo.bomHeaderId)) {
        data.allocatedHoursPerUnit = hoursPerUnit;
        data.laborEstimateSource = "LAST_ACTUAL";
        updated = true;
      }
      await prisma.part.update({ where: { id: part.id }, data });
      await prisma.laborEstimateHistory.create({
        data: {
          partId: part.id,
          bomHeaderId: wo.bomHeaderId,
          workOrderId: wo.id,
          source: part.laborEstimateLocked ? "COMPLETION" : "LAST_ACTUAL",
          hoursPerUnit,
          totalHours: hours,
          quantity: wo.quantity,
          userId: params.userId,
          notes: part.laborEstimateLocked
            ? "Last actual recorded; estimate locked"
            : "Estimate updated from last actual",
        },
      });
    }
  }

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "LABOR_ACTUAL_RECORDED",
    userId: params.userId,
    metadata: { hoursPerUnit, totalHours: hours, quantity: wo.quantity, updated },
  });
  return { hoursPerUnit, updated };
}

export async function setItemLaborEstimate(params: {
  partId: string;
  allocatedHoursPerUnit: number | null;
  lock?: boolean;
  userId?: string;
  notes?: string;
}) {
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  if (!part) throw new Error("Part not found");
  const hours =
    params.allocatedHoursPerUnit != null && params.allocatedHoursPerUnit > 0
      ? params.allocatedHoursPerUnit
      : null;
  const locked = params.lock ?? part.laborEstimateLocked;
  await prisma.part.update({
    where: { id: part.id },
    data: {
      allocatedHoursPerUnit: hours,
      laborEstimateSource: hours == null ? part.laborEstimateSource : locked ? "OVERRIDE" : "MANUAL",
      laborEstimateLocked: locked,
      laborEstimateUpdatedAt: new Date(),
    },
  });
  if (hours != null) {
    await prisma.laborEstimateHistory.create({
      data: {
        partId: part.id,
        source: locked ? "OVERRIDE" : "MANUAL",
        hoursPerUnit: hours,
        userId: params.userId,
        notes: params.notes,
      },
    });
  }
  await logAudit({
    entityType: "Part",
    entityId: part.id,
    action: "LABOR_ESTIMATE_SET",
    userId: params.userId,
    metadata: { allocatedHoursPerUnit: hours, locked },
  });
}

export async function setBomLaborEstimate(params: {
  bomHeaderId: string;
  allocatedHoursPerUnit: number | null;
  lock?: boolean;
  userId?: string;
  notes?: string;
}) {
  const bom = await prisma.bomHeader.findUnique({ where: { id: params.bomHeaderId } });
  if (!bom) throw new Error("BOM not found");
  const hours =
    params.allocatedHoursPerUnit != null && params.allocatedHoursPerUnit > 0
      ? params.allocatedHoursPerUnit
      : null;
  const locked = params.lock ?? bom.laborEstimateLocked;
  await prisma.bomHeader.update({
    where: { id: bom.id },
    data: {
      allocatedHoursPerUnit: hours,
      laborEstimateSource: hours == null ? bom.laborEstimateSource : locked ? "OVERRIDE" : "MANUAL",
      laborEstimateLocked: locked,
      laborEstimateUpdatedAt: new Date(),
    },
  });
  if (hours != null) {
    await prisma.laborEstimateHistory.create({
      data: {
        bomHeaderId: bom.id,
        partId: bom.partId,
        source: locked ? "OVERRIDE" : "MANUAL",
        hoursPerUnit: hours,
        userId: params.userId,
        notes: params.notes,
      },
    });
  }
  await logAudit({
    entityType: "BomHeader",
    entityId: bom.id,
    action: "LABOR_ESTIMATE_SET",
    userId: params.userId,
    metadata: { allocatedHoursPerUnit: hours, locked },
  });
}

export async function setWorkOrderAllocatedOverride(params: {
  workOrderId: string;
  allocatedHours: number;
  lock?: boolean;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({ where: { id: params.workOrderId } });
  if (!wo) throw new Error("Work order not found");
  const hours = Math.max(0, params.allocatedHours);
  const perUnit = roundHours(hours / Math.max(wo.quantity || 1, 0.0001));
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      allocatedHours: hours,
      allocatedHoursPerUnit: perUnit,
      laborEstimateSource: "OVERRIDE",
      laborEstimateLocked: params.lock !== false,
      estimatedMinutes: Math.round(hours * 60),
      estimateSource: "MANUAL",
      estimateUpdatedAt: new Date(),
    },
  });
  await prisma.laborEstimateHistory.create({
    data: {
      workOrderId: wo.id,
      partId: wo.partId,
      bomHeaderId: wo.bomHeaderId,
      source: "OVERRIDE",
      hoursPerUnit: perUnit,
      totalHours: hours,
      quantity: wo.quantity,
      userId: params.userId,
    },
  });
}

/** Read-service shape Carina (and the API) can call without voice-layer changes. */
export async function readLaborProgress(params: {
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  projectId?: string | null;
  projectNumber?: string | null;
  budgetId?: string | null;
  from?: Date | null;
  to?: Date | null;
}): Promise<
  | { kind: "work_order"; progress: LaborProgress }
  | { kind: "project"; projectId: string; rollup: LaborRollup }
  | { kind: "budget"; budgetId: string; rollup: LaborRollup }
  | { kind: "report"; rollup: LaborRollup }
> {
  if (params.workOrderId || params.workOrderNumber) {
    let id = params.workOrderId || null;
    if (!id && params.workOrderNumber) {
      const wo = await prisma.workOrder.findFirst({
        where: { number: { equals: params.workOrderNumber, mode: "insensitive" } },
        select: { id: true },
      });
      if (!wo) throw new Error("Work order not found");
      id = wo.id;
    }
    return { kind: "work_order", progress: await getWorkOrderLaborProgress(id!) };
  }
  if (params.projectId || params.projectNumber) {
    let id = params.projectId || null;
    if (!id && params.projectNumber) {
      const project = await prisma.project.findFirst({
        where: {
          OR: [
            { number: { equals: params.projectNumber, mode: "insensitive" } },
            { name: { equals: params.projectNumber, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (!project) throw new Error("Project not found");
      id = project.id;
    }
    return { kind: "project", projectId: id!, rollup: await getProjectLaborProgress(id!) };
  }
  if (params.budgetId) {
    return {
      kind: "budget",
      budgetId: params.budgetId,
      rollup: await getBudgetLaborProgress(params.budgetId),
    };
  }
  return {
    kind: "report",
    rollup: await queryLaborProgressReport({
      from: params.from,
      to: params.to,
    }),
  };
}

export function summarizeLaborProgressForCarina(
  result: Awaited<ReturnType<typeof readLaborProgress>>
): string {
  const fmt = (r: LaborProgress) => {
    const pct =
      r.percentComplete == null ? "no allocation" : `${r.percentComplete}% complete`;
    const flag = r.overAllocated ? " — OVER ALLOCATED" : "";
    return `${r.number} (${r.status}): ${r.clockedHours}h clocked / ${r.allocatedHours ?? "—"}h allocated (${pct}${flag})`;
  };
  if (result.kind === "work_order") return fmt(result.progress);
  const r = result.rollup;
  const overall =
    r.percentComplete == null ? "no allocation" : `${r.percentComplete}% complete`;
  const cost =
    r.laborBudget != null
      ? ` Labor cost ${r.laborCost} vs budget ${r.laborBudget} (variance ${r.laborCostVariance}).`
      : r.laborCost
        ? ` Labor cost ${r.laborCost}.`
        : "";
  const lines = r.rows.slice(0, 12).map(fmt);
  const more = r.rows.length > 12 ? ` …and ${r.rows.length - 12} more.` : "";
  return (
    `${r.workOrderCount} work orders, ${r.clockedHours}h clocked / ${r.allocatedHours}h allocated ` +
    `(${overall}), ${r.overAllocatedCount} over allocated hours.${cost} ` +
    lines.join("; ") +
    more
  );
}
