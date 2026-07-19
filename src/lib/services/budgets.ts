/**
 * Operational budgets — forecast / project-WBS / standalone.
 *
 * DIRECT  = forecast or project WBS job cost
 * INDIRECT = standalone (facility, company pocketbook) — no project link
 *
 * Owner approves: timesheet hours charged to this code, and PRs buying against it.
 * User picks charge code; project default is `{projectName}-{wbsCode}`.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type BudgetSourceType = "FORECAST" | "PROJECT" | "STANDALONE";
export type BudgetCostClass = "DIRECT" | "INDIRECT";
export type BudgetStatus = "DRAFT" | "ENACTED" | "CLOSED" | "CANCELLED";

const DEFAULT_LABOR_RATE = 65;

async function nextBudgetNumber(): Promise<string> {
  const rows = await prisma.budget.findMany({
    where: { number: { startsWith: "BDGT-" } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `BDGT-${String(max + 1).padStart(5, "0")}`;
}

function deriveCostClass(sourceType: BudgetSourceType): BudgetCostClass {
  return sourceType === "STANDALONE" ? "INDIRECT" : "DIRECT";
}

/** Sanitize user-facing charge code tokens. */
export function sanitizeChargeCode(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._/-]/g, "")
    .slice(0, 48);
}

/**
 * Charge code = budget name (sanitized).
 * Same name wins for both create and enact defaults.
 */
export function chargeCodeFromBudgetName(name: string): string {
  const code = sanitizeChargeCode(name);
  if (!code) throw new Error("Budget name must produce a usable charge code");
  return code;
}

/**
 * Scheme: ProjectName-1.0-1.1-1.1.2 (root → leaf WBS codes).
 * Dots kept so sub-levels stay readable.
 */
export function projectWbsChargeCode(
  projectName: string,
  wbsCodePath: string[]
): string {
  const proj = projectName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 32);
  const path = wbsCodePath
    .map((c) => c.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, ""))
    .filter(Boolean)
    .join("-");
  return chargeCodeFromBudgetName(path ? `${proj}-${path}` : proj);
}

/** Walk parent chain root→leaf and return codes for charge-code path. */
export async function wbsCodePathFromLeaf(wbsElementId: string): Promise<string[]> {
  const codes: string[] = [];
  let id: string | null = wbsElementId;
  const guard = new Set<string>();
  while (id && !guard.has(id)) {
    guard.add(id);
    const node: { code: string; parentId: string | null } | null =
      await prisma.wbsElement.findUnique({
        where: { id },
        select: { code: true, parentId: true },
      });
    if (!node) break;
    codes.unshift(node.code);
    id = node.parentId;
  }
  return codes;
}

/** @deprecated use projectWbsChargeCode */
export function defaultProjectWbsChargeCode(
  projectName: string,
  wbsCode: string
): string {
  return projectWbsChargeCode(projectName, [wbsCode]);
}

/**
 * Ensure every WBS element on a project has an enacted DIRECT budget / charge code.
 * Scheme: [projectname]-[wbs]-[sub-wbs…]
 */
export async function ensureProjectWbsChargeCodes(params: {
  projectId: string;
  userId?: string;
  ownerId?: string | null;
}): Promise<{ created: number; skipped: number }> {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: {
      id: true,
      name: true,
      number: true,
      projectManagerId: true,
      productId: true,
    },
  });
  if (!project) throw new Error("Project not found");

  let ownerId =
    params.ownerId || project.projectManagerId || params.userId || null;
  if (!ownerId) {
    // Fall back so project create still mints codes even without a PM assigned
    const anyUser = await prisma.user.findFirst({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    ownerId = anyUser?.id || null;
  }
  if (!ownerId) {
    return { created: 0, skipped: 0 };
  }

  const elements = await prisma.wbsElement.findMany({
    where: { projectId: project.id },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  });

  let created = 0;
  let skipped = 0;
  for (const el of elements) {
    const existing = await prisma.budget.findFirst({
      where: {
        projectId: project.id,
        wbsElementId: el.id,
        status: { notIn: ["CANCELLED"] },
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const path = await wbsCodePathFromLeaf(el.id);
    const code = projectWbsChargeCode(project.name || project.number, path);
    const name = `${project.name} · ${path.join("-")} · ${el.name}`;
    try {
      await createBudget({
        name,
        sourceType: "PROJECT",
        projectId: project.id,
        wbsElementId: el.id,
        productId: project.productId,
        ownerId,
        chargeCode: code,
        totalAmount: el.budgetCost > 0 ? el.budgetCost : 0,
        laborBudget: 0,
        materialBudget: 0,
        laborHoursBudget: 0,
        userId: params.userId,
        enact: true,
      });
      created += 1;
    } catch (e) {
      console.error(
        `ensureProjectWbsChargeCodes: failed for WBS ${el.code}`,
        e
      );
      skipped += 1;
    }
  }
  return { created, skipped };
}

async function ensureUniqueChargeCode(
  desired: string,
  excludeBudgetId?: string
): Promise<string> {
  let code = sanitizeChargeCode(desired);
  if (!code) throw new Error("Charge code is required");
  let n = 0;
  while (n < 20) {
    const clash = await prisma.budget.findFirst({
      where: {
        chargeCode: code,
        ...(excludeBudgetId ? { id: { not: excludeBudgetId } } : {}),
      },
    });
    if (!clash) return code;
    n += 1;
    code = sanitizeChargeCode(`${desired}-${n}`);
  }
  throw new Error(`Charge code "${desired}" is already in use`);
}

export async function createBudget(params: {
  name: string;
  sourceType?: BudgetSourceType;
  /** One or many forecasts — budget can span multiple */
  forecastIds?: string[];
  /** @deprecated use forecastIds */
  forecastId?: string | null;
  projectId?: string | null;
  wbsElementId?: string | null;
  productId?: string | null;
  ownerId?: string | null;
  /** User-chosen charge code (required for enact; optional on draft) */
  chargeCode?: string | null;
  totalAmount?: number;
  laborBudget?: number;
  materialBudget?: number;
  otherBudget?: number;
  laborHoursBudget?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
  userId?: string;
  enact?: boolean;
}) {
  const name = params.name?.trim();
  if (!name) throw new Error("Budget name is required");

  let sourceType: BudgetSourceType = params.sourceType || "STANDALONE";
  let projectId = params.projectId || null;
  let wbsElementId = params.wbsElementId || null;
  let productId = params.productId || null;
  const forecastIds = [
    ...new Set(
      [
        ...(params.forecastIds || []),
        ...(params.forecastId ? [params.forecastId] : []),
      ]
        .map((id) => id?.trim())
        .filter((id): id is string => !!id)
    ),
  ];

  // Standalone never carries project
  if (sourceType === "STANDALONE") {
    projectId = null;
    wbsElementId = null;
  }

  let forecasts: { id: string; number: string; name: string }[] = [];
  if (forecastIds.length) {
    forecasts = await prisma.forecast.findMany({
      where: { id: { in: forecastIds } },
      select: { id: true, number: true, name: true },
    });
    if (forecasts.length !== forecastIds.length) {
      throw new Error("One or more forecasts not found");
    }
    sourceType = "FORECAST";
    projectId = null;
    wbsElementId = null;
  }

  let wbsPath: string[] = [];
  let projectLabel = "";
  if (projectId || wbsElementId) {
    if (wbsElementId) {
      const wbs = await prisma.wbsElement.findUnique({
        where: { id: wbsElementId },
        include: {
          project: {
            select: { id: true, number: true, name: true, productId: true },
          },
        },
      });
      if (!wbs) throw new Error("WBS not found");
      projectId = wbs.projectId;
      projectLabel = wbs.project.name || wbs.project.number;
      if (!productId && wbs.project.productId) productId = wbs.project.productId;
      wbsPath = await wbsCodePathFromLeaf(wbsElementId);
    } else if (projectId) {
      const pr = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, number: true, name: true, productId: true },
      });
      if (!pr) throw new Error("Project not found");
      projectLabel = pr.name || pr.number;
      if (!productId && pr.productId) productId = pr.productId;
    }
    sourceType = "PROJECT";
    // Project budgets don't share forecast links
    forecasts = [];
  }

  const costClass = deriveCostClass(sourceType);
  const labor = Math.max(0, params.laborBudget ?? 0);
  const material = Math.max(0, params.materialBudget ?? 0);
  const other = Math.max(0, params.otherBudget ?? 0);
  const laborHours = Math.max(0, params.laborHoursBudget ?? 0);
  let total = Math.max(0, params.totalAmount ?? 0);
  if (total <= 0) total = labor + material + other;

  const number = await nextBudgetNumber();

  // WBS scheme: ProjectName-1.0-1.1 · non-WBS contract: ProjectName-BudgetName · else name
  let rawCode = params.chargeCode?.trim()
    ? sanitizeChargeCode(params.chargeCode)
    : "";
  if (!rawCode && sourceType === "PROJECT" && projectLabel && wbsPath.length) {
    rawCode = projectWbsChargeCode(projectLabel, wbsPath);
  }
  if (!rawCode && sourceType === "PROJECT" && projectLabel) {
    rawCode = chargeCodeFromBudgetName(`${projectLabel}-${name}`);
  }
  if (!rawCode) {
    rawCode = chargeCodeFromBudgetName(name);
  }
  const chargeCode = await ensureUniqueChargeCode(rawCode);

  if (!params.ownerId) {
    throw new Error(
      "Assign a responsible owner (approves time + material against this budget)"
    );
  }

  const budget = await prisma.budget.create({
    data: {
      number,
      name,
      sourceType,
      costClass,
      status: "DRAFT",
      chargeCode,
      projectId,
      wbsElementId,
      productId,
      ownerId: params.ownerId,
      totalAmount: total,
      laborBudget: labor,
      materialBudget: material,
      otherBudget: other,
      laborHoursBudget: laborHours,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      notes: params.notes || null,
      createdById: params.userId || null,
      forecastLinks: forecasts.length
        ? {
            create: forecasts.map((f) => ({ forecastId: f.id })),
          }
        : undefined,
    },
  });

  await logAudit({
    entityType: "Budget",
    entityId: budget.id,
    action: "CREATED",
    userId: params.userId,
    metadata: {
      number,
      sourceType,
      costClass,
      chargeCode,
      total,
      laborHours,
      ownerId: params.ownerId,
      forecastIds: forecasts.map((f) => f.id),
      forecastNumbers: forecasts.map((f) => f.number),
    },
  });

  if (params.enact) {
    return enactBudget({ budgetId: budget.id, userId: params.userId });
  }
  return budget;
}

/** Edit draft (full) or enacted (amounts/owner/hours). Forecast links replaceable. */
export async function updateBudget(params: {
  budgetId: string;
  name?: string;
  ownerId?: string | null;
  chargeCode?: string | null;
  totalAmount?: number;
  laborBudget?: number;
  materialBudget?: number;
  otherBudget?: number;
  laborHoursBudget?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
  productId?: string | null;
  /** Replace linked forecasts (multi-select). Pass [] to clear. */
  forecastIds?: string[];
  userId?: string;
}) {
  const existing = await prisma.budget.findUnique({
    where: { id: params.budgetId },
  });
  if (!existing) throw new Error("Budget not found");
  if (["CLOSED", "CANCELLED"].includes(existing.status)) {
    throw new Error(`Budget is ${existing.status}`);
  }

  const nextName =
    params.name !== undefined ? params.name.trim() : existing.name;

  // Explicit charge code wins; else when name changes, charge code follows name
  let chargeCode = existing.chargeCode;
  if (params.chargeCode !== undefined && params.chargeCode !== null && params.chargeCode.trim()) {
    const next = sanitizeChargeCode(params.chargeCode);
    if (!next) throw new Error("Charge code cannot be empty");
    chargeCode = await ensureUniqueChargeCode(next, existing.id);
  } else if (
    params.name !== undefined &&
    params.name.trim() &&
    params.name.trim() !== existing.name
  ) {
    chargeCode = await ensureUniqueChargeCode(
      chargeCodeFromBudgetName(params.name.trim()),
      existing.id
    );
  }

  if (
    existing.status === "ENACTED" &&
    existing.chargeCode &&
    chargeCode &&
    existing.chargeCode !== chargeCode
  ) {
    const acct = await prisma.account.findFirst({
      where: { chargeCode: existing.chargeCode },
    });
    if (acct) {
      await prisma.account.update({
        where: { id: acct.id },
        data: {
          chargeCode,
          name: `Budget ${existing.number} — ${nextName}`,
        },
      });
    }
  }

  const data: Record<string, unknown> = {
    ...(params.name !== undefined ? { name: nextName } : {}),
    ...(params.ownerId !== undefined ? { ownerId: params.ownerId } : {}),
    ...(chargeCode !== existing.chargeCode ? { chargeCode } : {}),
    ...(params.totalAmount !== undefined
      ? { totalAmount: Math.max(0, params.totalAmount) }
      : {}),
    ...(params.laborBudget !== undefined
      ? { laborBudget: Math.max(0, params.laborBudget) }
      : {}),
    ...(params.materialBudget !== undefined
      ? { materialBudget: Math.max(0, params.materialBudget) }
      : {}),
    ...(params.otherBudget !== undefined
      ? { otherBudget: Math.max(0, params.otherBudget) }
      : {}),
    ...(params.laborHoursBudget !== undefined
      ? { laborHoursBudget: Math.max(0, params.laborHoursBudget) }
      : {}),
    ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
    ...(params.endDate !== undefined ? { endDate: params.endDate } : {}),
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
    ...(params.productId !== undefined ? { productId: params.productId } : {}),
  };

  if (
    params.totalAmount === undefined &&
    (params.laborBudget !== undefined ||
      params.materialBudget !== undefined ||
      params.otherBudget !== undefined)
  ) {
    const labor =
      params.laborBudget !== undefined
        ? params.laborBudget
        : existing.laborBudget;
    const material =
      params.materialBudget !== undefined
        ? params.materialBudget
        : existing.materialBudget;
    const other =
      params.otherBudget !== undefined
        ? params.otherBudget
        : existing.otherBudget;
    const sum = labor + material + other;
    if (sum > 0) data.totalAmount = sum;
  }

  // Replace forecast span (not for pure project budgets with WBS)
  if (params.forecastIds !== undefined) {
    if (existing.sourceType === "PROJECT" && existing.wbsElementId) {
      // keep project-only
    } else {
      const ids = [
        ...new Set(params.forecastIds.map((id) => id.trim()).filter(Boolean)),
      ];
      if (ids.length) {
        const found = await prisma.forecast.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
        if (found.length !== ids.length) {
          throw new Error("One or more forecasts not found");
        }
        data.sourceType = "FORECAST";
        data.costClass = "DIRECT";
        data.projectId = null;
        data.wbsElementId = null;
      } else if (existing.sourceType === "FORECAST") {
        // clearing all forecasts → stay FORECAST or demote? keep as FORECAST with no links is odd; keep type
      }
      await prisma.budgetForecast.deleteMany({
        where: { budgetId: existing.id },
      });
      if (ids.length) {
        await prisma.budgetForecast.createMany({
          data: ids.map((forecastId) => ({
            budgetId: existing.id,
            forecastId,
          })),
        });
      }
    }
  }

  const updated = await prisma.budget.update({
    where: { id: existing.id },
    data,
  });

  await logAudit({
    entityType: "Budget",
    entityId: existing.id,
    action: "UPDATED",
    userId: params.userId,
    metadata: {
      ...data,
      forecastIds: params.forecastIds,
    },
  });

  return updated;
}

export async function enactBudget(params: {
  budgetId: string;
  userId?: string;
  /** Override charge code at enact time */
  chargeCode?: string | null;
}) {
  const budget = await prisma.budget.findUnique({
    where: { id: params.budgetId },
    include: {
      forecastLinks: {
        include: { forecast: { select: { number: true } } },
      },
      project: { select: { number: true, name: true } },
      wbsElement: { select: { code: true } },
    },
  });
  if (!budget) throw new Error("Budget not found");
  if (budget.status === "CANCELLED") throw new Error("Budget is cancelled");
  if (budget.status === "CLOSED") throw new Error("Budget is closed");
  if (!budget.ownerId) {
    throw new Error("Assign a responsible owner before enacting");
  }

  let chargeCode =
    (params.chargeCode && sanitizeChargeCode(params.chargeCode)) ||
    budget.chargeCode ||
    chargeCodeFromBudgetName(budget.name);
  chargeCode = await ensureUniqueChargeCode(chargeCode, budget.id);

  const existingAcct = await prisma.account.findFirst({
    where: { OR: [{ chargeCode }, { chargeCode: budget.chargeCode || undefined }] },
  });
  if (!existingAcct) {
    const codePrefix = budget.costClass === "DIRECT" ? "DIR" : "IND";
    const glCode = `${codePrefix}-${budget.number.replace("BDGT-", "")}`;
    const taken = await prisma.account.findUnique({ where: { code: glCode } });
    await prisma.account.create({
      data: {
        code: taken ? `${glCode}-B` : glCode,
        name: `Budget ${budget.number} — ${budget.name}`,
        type: "EXPENSE",
        subtype:
          budget.costClass === "DIRECT" ? "DIRECT_COST" : "INDIRECT_COST",
        chargeCodeType: budget.costClass,
        chargeCode,
        description: `${budget.sourceType} budget · ${budget.costClass} · owner approves time/PR`,
        isActive: true,
      },
    });
  } else {
    await prisma.account.update({
      where: { id: existingAcct.id },
      data: {
        chargeCode,
        chargeCodeType: budget.costClass,
        isActive: true,
        name: `Budget ${budget.number} — ${budget.name}`,
      },
    });
  }

  const updated = await prisma.budget.update({
    where: { id: budget.id },
    data: {
      status: "ENACTED",
      chargeCode,
      enactedAt: new Date(),
    },
  });

  await logAudit({
    entityType: "Budget",
    entityId: budget.id,
    action: "ENACTED",
    userId: params.userId,
    metadata: { chargeCode, costClass: budget.costClass, ownerId: budget.ownerId },
  });

  return updated;
}

export async function closeBudget(params: {
  budgetId: string;
  userId?: string;
}) {
  const b = await prisma.budget.update({
    where: { id: params.budgetId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await logAudit({
    entityType: "Budget",
    entityId: b.id,
    action: "CLOSED",
    userId: params.userId,
  });
  return b;
}

export async function getEnactedChargeCodes(): Promise<
  {
    code: string;
    name: string;
    costClass: string;
    budgetId: string;
    ownerId: string | null;
  }[]
> {
  const rows = await prisma.budget.findMany({
    where: { status: "ENACTED", chargeCode: { not: null } },
    select: {
      id: true,
      chargeCode: true,
      name: true,
      number: true,
      costClass: true,
      ownerId: true,
    },
    orderBy: { chargeCode: "asc" },
  });
  return rows
    .filter((r) => r.chargeCode)
    .map((r) => ({
      code: r.chargeCode!,
      // Charge code is the budget name; show class for clarity on the timesheet
      name: `${r.chargeCode} (${r.costClass})`,
      costClass: r.costClass,
      budgetId: r.id,
      ownerId: r.ownerId,
    }));
}

export async function findBudgetByChargeCode(code: string | null | undefined) {
  if (!code?.trim()) return null;
  return prisma.budget.findFirst({
    where: {
      chargeCode: code.trim(),
      status: "ENACTED",
    },
  });
}

export async function resolveUserLaborRate(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { hourlyRate: true, annualSalary: true },
  });
  if (u?.hourlyRate && u.hourlyRate > 0) return u.hourlyRate;
  if (u?.annualSalary && u.annualSalary > 0) {
    return Math.round((u.annualSalary / 2080) * 100) / 100;
  }
  return DEFAULT_LABOR_RATE;
}

export async function setUserCompensation(params: {
  userId: string;
  hourlyRate?: number | null;
  annualSalary?: number | null;
  actorId?: string;
}) {
  const data: { hourlyRate?: number; annualSalary?: number | null } = {};
  if (params.hourlyRate !== undefined) {
    data.hourlyRate = Math.max(0, Number(params.hourlyRate) || 0);
  }
  if (params.annualSalary !== undefined) {
    data.annualSalary =
      params.annualSalary == null
        ? null
        : Math.max(0, Number(params.annualSalary) || 0);
    if (data.annualSalary && data.annualSalary > 0) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { hourlyRate: true },
      });
      if (
        (!user?.hourlyRate || user.hourlyRate <= 0) &&
        data.hourlyRate === undefined
      ) {
        data.hourlyRate = Math.round((data.annualSalary / 2080) * 100) / 100;
      }
    }
  }
  const updated = await prisma.user.update({
    where: { id: params.userId },
    data,
  });
  await logAudit({
    entityType: "User",
    entityId: params.userId,
    action: "COMPENSATION_UPDATED",
    userId: params.actorId,
    metadata: data,
  });
  return updated;
}

export async function postBudgetCharge(params: {
  budgetId: string;
  category: "LABOR" | "MATERIAL" | "OTHER";
  amount: number;
  hours?: number | null;
  description?: string | null;
  source?: string;
  sourceId?: string | null;
  timeEntryId?: string | null;
  purchaseOrderId?: string | null;
  purchaseRequestId?: string | null;
  userId?: string | null;
  chargeDate?: Date;
  bookJournal?: boolean;
}) {
  const amount = Math.round(Math.max(0, params.amount) * 100) / 100;
  if (amount <= 0 && !(params.hours && params.hours > 0)) {
    throw new Error("Charge amount or hours must be > 0");
  }

  const budget = await prisma.budget.findUnique({
    where: { id: params.budgetId },
  });
  if (!budget) throw new Error("Budget not found");
  if (budget.status !== "ENACTED") {
    throw new Error(
      `Budget is ${budget.status} — only ENACTED budgets accept charges`
    );
  }

  if (params.timeEntryId) {
    const existing = await prisma.budgetCharge.findFirst({
      where: { timeEntryId: params.timeEntryId },
    });
    if (existing) return existing;
  }

  let journalEntryId: string | null = null;
  if (params.bookJournal !== false && amount > 0) {
    try {
      journalEntryId = await bookBudgetExpenseJournal({
        budget,
        category: params.category,
        amount,
        description: params.description || `${params.category} charge`,
        chargeCode: budget.chargeCode,
      });
    } catch {
      /* best-effort */
    }
  }

  const hours = params.hours ?? null;
  const charge = await prisma.budgetCharge.create({
    data: {
      budgetId: budget.id,
      category: params.category,
      amount,
      hours,
      description: params.description || null,
      source: params.source || "MANUAL",
      sourceId: params.sourceId || null,
      timeEntryId: params.timeEntryId || null,
      purchaseOrderId: params.purchaseOrderId || null,
      purchaseRequestId: params.purchaseRequestId || null,
      userId: params.userId || null,
      chargeDate: params.chargeDate || new Date(),
      journalEntryId,
    },
  });

  const labor =
    budget.actualLabor + (params.category === "LABOR" ? amount : 0);
  const material =
    budget.actualMaterial + (params.category === "MATERIAL" ? amount : 0);
  const other =
    budget.actualOther + (params.category === "OTHER" ? amount : 0);
  const laborHours =
    budget.actualLaborHours +
    (params.category === "LABOR" && hours ? hours : 0);

  await prisma.budget.update({
    where: { id: budget.id },
    data: {
      actualLabor: labor,
      actualMaterial: material,
      actualOther: other,
      actualTotal: labor + material + other,
      actualLaborHours: laborHours,
    },
  });

  return charge;
}

async function bookBudgetExpenseJournal(params: {
  budget: {
    id: string;
    number: string;
    name: string;
    costClass: string;
    chargeCode: string | null;
  };
  category: string;
  amount: number;
  description: string;
  chargeCode: string | null;
}): Promise<string | null> {
  const expense = await prisma.account.findFirst({
    where: {
      isActive: true,
      OR: [
        { chargeCode: params.chargeCode || undefined },
        {
          type: "EXPENSE",
          subtype:
            params.budget.costClass === "DIRECT"
              ? "DIRECT_COST"
              : "INDIRECT_COST",
        },
        { type: "EXPENSE" },
      ],
    },
    orderBy: { code: "asc" },
  });
  const clearing = await prisma.account.findFirst({
    where: {
      isActive: true,
      OR: [{ type: "LIABILITY" }, { type: "ASSET" }],
    },
    orderBy: { code: "asc" },
  });
  if (!expense || !clearing || expense.id === clearing.id) return null;

  const count = await prisma.journalEntry.count();
  const number = `JE-B-${String(count + 1).padStart(5, "0")}`;
  const je = await prisma.journalEntry.create({
    data: {
      number,
      description: `${params.budget.number} ${params.category}: ${params.description}`,
      status: "POSTED",
      source: "BUDGET",
      sourceId: params.budget.id,
      chargeCode: params.chargeCode,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: expense.id,
            debit: params.amount,
            credit: 0,
            memo: params.budget.name,
            chargeCode: params.chargeCode,
          },
          {
            accountId: clearing.id,
            debit: 0,
            credit: params.amount,
            memo: `Clearing ${params.category}`,
            chargeCode: params.chargeCode,
          },
        ],
      },
    },
  });
  await prisma.account.update({
    where: { id: expense.id },
    data: { balance: { increment: params.amount } },
  });
  await prisma.account.update({
    where: { id: clearing.id },
    data: { balance: { decrement: params.amount } },
  });
  return je.id;
}

export async function postTimesheetBudgetCharges(timesheetId: string) {
  const sheet = await prisma.timesheet.findUnique({
    where: { id: timesheetId },
    include: { entries: true },
  });
  if (!sheet) return { posted: 0 };

  let posted = 0;
  for (const e of sheet.entries) {
    let budgetId = e.budgetId;
    if (!budgetId && e.chargeCode) {
      const b = await findBudgetByChargeCode(e.chargeCode);
      budgetId = b?.id || null;
    }
    if (!budgetId) continue;

    const amount =
      e.costAmount > 0
        ? e.costAmount
        : e.hours * (e.laborRate || (await resolveUserLaborRate(sheet.userId)));

    try {
      await postBudgetCharge({
        budgetId,
        category: "LABOR",
        amount,
        hours: e.hours,
        description:
          e.description || `Labor ${e.date.toISOString().slice(0, 10)}`,
        source: "TIME_ENTRY",
        sourceId: e.id,
        timeEntryId: e.id,
        userId: sheet.userId,
        chargeDate: e.date,
        bookJournal: true,
      });
      if (!e.budgetId) {
        await prisma.timeEntry.update({
          where: { id: e.id },
          data: { budgetId },
        });
      }
      posted += 1;
    } catch {
      /* skip */
    }
  }
  return { posted };
}

export async function chargeBudgetMaterialFromPr(params: {
  purchaseRequestId: string;
  amount?: number;
  userId?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
    include: { lines: true },
  });
  if (!pr) throw new Error("PR not found");

  let budgetId = pr.budgetId;
  if (!budgetId && pr.chargeCode) {
    const b = await findBudgetByChargeCode(pr.chargeCode);
    budgetId = b?.id || null;
  }
  if (!budgetId) throw new Error("PR has no budget / charge code");

  const amount =
    params.amount ??
    pr.totalEstimate ??
    pr.lines.reduce((s, l) => s + l.quantity * l.estimatedUnitCost, 0);

  return postBudgetCharge({
    budgetId,
    category: "MATERIAL",
    amount,
    description: `PR ${pr.number} material`,
    source: "PR",
    sourceId: pr.id,
    purchaseRequestId: pr.id,
    userId: params.userId,
    bookJournal: true,
  });
}

export async function listBudgets(params?: {
  status?: string;
  costClass?: string;
  forecastId?: string;
  productId?: string;
  projectId?: string;
}) {
  return prisma.budget.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.costClass ? { costClass: params.costClass } : {}),
      ...(params?.forecastId
        ? { forecastLinks: { some: { forecastId: params.forecastId } } }
        : {}),
      ...(params?.productId ? { productId: params.productId } : {}),
      ...(params?.projectId ? { projectId: params.projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      forecastLinks: {
        include: {
          forecast: { select: { id: true, number: true, name: true } },
        },
      },
      project: { select: { id: true, number: true, name: true } },
      product: { select: { id: true, code: true, name: true } },
      wbsElement: { select: { id: true, code: true, name: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { charges: true } },
    },
    take: 100,
  });
}

export async function getBudgetDetail(id: string) {
  return prisma.budget.findUnique({
    where: { id },
    include: {
      forecastLinks: {
        include: {
          forecast: {
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
            },
          },
        },
      },
      project: { select: { id: true, number: true, name: true } },
      product: { select: { id: true, code: true, name: true } },
      wbsElement: { select: { id: true, code: true, name: true } },
      owner: { select: { id: true, name: true, email: true } },
      charges: {
        orderBy: { chargeDate: "desc" },
        take: 100,
        include: {
          user: { select: { id: true, name: true } },
        },
      },
      purchaseRequests: {
        select: { id: true, number: true, status: true, totalEstimate: true },
        take: 20,
      },
    },
  });
}
