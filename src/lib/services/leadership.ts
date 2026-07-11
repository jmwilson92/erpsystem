import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function listBusinessPriorities(params?: {
  publishedOnly?: boolean;
}) {
  return prisma.businessPriority.findMany({
    where: params?.publishedOnly
      ? { status: "PUBLISHED" }
      : undefined,
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
  });
}

export async function upsertBusinessPriority(params: {
  id?: string;
  title: string;
  description?: string | null;
  category?: string;
  priority?: number;
  ownerRole?: string | null;
  status?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  userId?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Title required");
  const status = (params.status || "DRAFT").toUpperCase();

  if (params.id) {
    return prisma.businessPriority.update({
      where: { id: params.id },
      data: {
        title,
        description: params.description?.trim() || null,
        category: (params.category || "STRATEGIC").toUpperCase(),
        priority: params.priority ?? 1,
        ownerRole: params.ownerRole?.trim() || null,
        status,
        effectiveFrom: params.effectiveFrom || null,
        effectiveTo: params.effectiveTo || null,
        updatedById: params.userId || null,
        publishedAt:
          status === "PUBLISHED" ? new Date() : undefined,
      },
    });
  }

  const count = await prisma.businessPriority.count();
  const number = `BP-${String(count + 1).padStart(3, "0")}`;
  const created = await prisma.businessPriority.create({
    data: {
      number,
      title,
      description: params.description?.trim() || null,
      category: (params.category || "STRATEGIC").toUpperCase(),
      priority: params.priority ?? 1,
      ownerRole: params.ownerRole?.trim() || null,
      status,
      effectiveFrom: params.effectiveFrom || null,
      effectiveTo: params.effectiveTo || null,
      createdById: params.userId || null,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
  await logAudit({
    entityType: "BusinessPriority",
    entityId: created.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, title, status },
  });
  return created;
}

export async function setPriorityStatus(params: {
  id: string;
  status: string;
  userId?: string | null;
}) {
  const status = params.status.toUpperCase();
  return prisma.businessPriority.update({
    where: { id: params.id },
    data: {
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : undefined,
      updatedById: params.userId || null,
    },
  });
}

/**
 * Cross-module KPI rollup for the executive view: financials from the
 * chart of accounts, program EVM health, quality and operations pulse.
 */
export async function getExecutiveKpis() {
  const [accounts, projects, workOrders, ncrs, mrbOpen, poOpen, inspections] =
    await Promise.all([
      prisma.account.findMany({
        where: { type: { in: ["REVENUE", "COGS", "EXPENSE"] } },
      }),
      prisma.project.findMany({
        where: { status: { in: ["ACTIVE", "EXECUTION"] } },
        select: {
          plannedValue: true,
          earnedValue: true,
          actualCost: true,
        },
      }),
      prisma.workOrder.findMany({
        where: { status: { in: ["PLANNED", "RELEASED", "IN_PROGRESS", "ON_HOLD"] } },
        select: { status: true, standardCost: true },
      }),
      prisma.nonConformance.count({ where: { status: { notIn: ["CLOSED"] } } }),
      prisma.mrbCase.count({ where: { status: { notIn: ["CLOSED"] } } }),
      prisma.purchaseOrder.findMany({
        where: { status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"] } },
        select: { totalAmount: true },
      }),
      prisma.inspection.findMany({
        where: { status: { in: ["PASSED", "FAILED"] } },
        select: { status: true },
      }),
    ]);

  const sumBy = (type: string) =>
    accounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0);
  const revenue = sumBy("REVENUE");
  const netIncome = revenue - sumBy("COGS") - sumBy("EXPENSE");

  const pv = projects.reduce((s, p) => s + p.plannedValue, 0);
  const ev = projects.reduce((s, p) => s + p.earnedValue, 0);
  const ac = projects.reduce((s, p) => s + p.actualCost, 0);

  const passed = inspections.filter((i) => i.status === "PASSED").length;

  return {
    revenue,
    netIncome,
    portfolioSpi: pv > 0 ? ev / pv : null,
    portfolioCpi: ac > 0 ? ev / ac : null,
    activeProjects: projects.length,
    openWorkOrders: workOrders.length,
    onHoldWorkOrders: workOrders.filter((w) => w.status === "ON_HOLD").length,
    wipValue: workOrders.reduce((s, w) => s + w.standardCost, 0),
    openNcrs: ncrs,
    openMrb: mrbOpen,
    firstPassYield:
      inspections.length > 0 ? (passed / inspections.length) * 100 : null,
    openPoCommitments: poOpen.reduce((s, p) => s + p.totalAmount, 0),
  };
}
