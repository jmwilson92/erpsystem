import { prisma } from "@/lib/db";
import { computeEvm } from "@/lib/utils";

/**
 * Role/discipline-aware dashboard pulse. Each discipline gets a pie + a bar
 * chart tuned to what that team actually watches, so a buyer sees purchasing
 * health while a QA lead sees quality health — same widget, different lens.
 */

export type PulseSeries = { key: string; name: string; color: string };

export type DisciplinePulse = {
  /** Human label for the lens, e.g. "Quality" */
  discipline: string;
  pie: { title: string; data: { name: string; value: number }[] };
  bar: {
    title: string;
    xKey: string;
    data: Record<string, string | number>[];
    series: PulseSeries[];
    domainMax?: number;
  };
};

const TEAL = "#14b8a6";
const SKY = "#38bdf8";
const AMBER = "#f59e0b";
const VIOLET = "#a78bfa";

export type PulseDiscipline =
  | "PRODUCTION"
  | "QUALITY"
  | "PURCHASING"
  | "ENGINEERING"
  | "PMO"
  | "LEADERSHIP";

/** Map a user's role (then department) onto a pulse discipline. */
export function disciplineForUser(user: {
  role?: string | null;
  department?: string | null;
}): PulseDiscipline {
  const r = (user.role || "").toUpperCase();
  const d = (user.department || "").toUpperCase();
  const hit = (s: string) =>
    ["QUALITY", "QC", "QA", "INSPECT"].some((k) => s.includes(k))
      ? "QUALITY"
      : ["PURCHAS", "BUYER", "PROCURE", "SUPPLY"].some((k) => s.includes(k))
        ? "PURCHASING"
        : ["ENGINEER", "MFG_ENG", "DESIGN", "CM"].some((k) => s.includes(k))
          ? "ENGINEERING"
          : ["PMO", "PROJECT", "PROGRAM"].some((k) => s.includes(k))
            ? "PMO"
            : ["ADMIN", "CEO", "COO", "CFO", "EXEC", "LEAD", "DIRECTOR", "VP"].some(
                  (k) => s.includes(k)
                )
              ? "LEADERSHIP"
              : null;
  return (hit(r) || hit(d) || "PRODUCTION") as PulseDiscipline;
}

export async function getDisciplinePulse(user: {
  role?: string | null;
  department?: string | null;
}): Promise<DisciplinePulse> {
  const discipline = disciplineForUser(user);

  switch (discipline) {
    case "QUALITY": {
      const [ncrs, insp] = await Promise.all([
        prisma.nonConformance.groupBy({
          by: ["severity"],
          where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
          _count: true,
        }),
        prisma.inspection.groupBy({ by: ["status"], _count: true }),
      ]);
      return {
        discipline: "Quality",
        pie: {
          title: "Open NCRs by severity",
          data: ncrs.map((n) => ({
            name: (n.severity || "UNSPEC").replace(/_/g, " "),
            value: n._count,
          })),
        },
        bar: {
          title: "Inspections by outcome",
          xKey: "name",
          data: insp.map((i) => ({
            name: i.status.replace(/_/g, " "),
            count: i._count,
          })),
          series: [{ key: "count", name: "Inspections", color: TEAL }],
        },
      };
    }

    case "PURCHASING": {
      const [pos, suppliers] = await Promise.all([
        prisma.purchaseOrder.groupBy({ by: ["status"], _count: true }),
        prisma.supplier.findMany({ orderBy: { overallScore: "desc" }, take: 6 }),
      ]);
      return {
        discipline: "Purchasing",
        pie: {
          title: "Purchase orders by status",
          data: pos.map((p) => ({
            name: p.status.replace(/_/g, " "),
            value: p._count,
          })),
        },
        bar: {
          title: "Supplier score & on-time delivery",
          xKey: "name",
          domainMax: 100,
          data: suppliers.map((s) => ({
            name: s.code,
            score: s.overallScore,
            otd: s.onTimeDeliveryPct,
          })),
          series: [
            { key: "score", name: "Score", color: TEAL },
            { key: "otd", name: "OTD %", color: SKY },
          ],
        },
      };
    }

    case "ENGINEERING": {
      const [byStatus, byDiscipline] = await Promise.all([
        prisma.engTask.groupBy({
          by: ["status"],
          where: { status: { notIn: ["DONE", "CANCELLED"] } },
          _count: true,
        }),
        prisma.engTask.groupBy({
          by: ["discipline"],
          where: { status: { notIn: ["DONE", "CANCELLED"] } },
          _count: true,
        }),
      ]);
      return {
        discipline: "Engineering",
        pie: {
          title: "Open engineering tasks by status",
          data: byStatus.map((t) => ({
            name: t.status.replace(/_/g, " "),
            value: t._count,
          })),
        },
        bar: {
          title: "Open tasks by discipline",
          xKey: "name",
          data: byDiscipline.map((t) => ({
            name: t.discipline || "Unassigned",
            count: t._count,
          })),
          series: [{ key: "count", name: "Tasks", color: VIOLET }],
        },
      };
    }

    case "PMO": {
      const projects = await prisma.project.findMany({
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { number: "asc" },
        take: 8,
      });
      const byStatus = await prisma.project.groupBy({
        by: ["status"],
        _count: true,
      });
      return {
        discipline: "PMO",
        pie: {
          title: "Projects by status",
          data: byStatus.map((p) => ({
            name: p.status.replace(/_/g, " "),
            value: p._count,
          })),
        },
        bar: {
          title: "Schedule (SPI) & cost (CPI) index",
          xKey: "name",
          domainMax: 2,
          data: projects.map((p) => {
            const { spi, cpi } = computeEvm(
              p.plannedValue,
              p.earnedValue,
              p.actualCost
            );
            return {
              name: p.number,
              spi: Math.round(spi * 100) / 100,
              cpi: Math.round(cpi * 100) / 100,
            };
          }),
          series: [
            { key: "spi", name: "SPI", color: TEAL },
            { key: "cpi", name: "CPI", color: SKY },
          ],
        },
      };
    }

    case "LEADERSHIP": {
      const [wos, priorities, openMrb, openNcr, openPo] = await Promise.all([
        prisma.workOrder.findMany({
          where: { status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] } },
          select: { businessPriorityId: true },
        }),
        prisma.businessPriority.findMany({
          where: { status: "PUBLISHED" },
          orderBy: { priority: "asc" },
          select: { id: true, number: true },
        }),
        prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
        prisma.nonConformance.count({
          where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
        }),
        prisma.purchaseOrder.count({
          where: {
            status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"] },
          },
        }),
      ]);
      const pMap = new Map(priorities.map((p) => [p.id, p.number]));
      const counts = new Map<string, number>();
      for (const wo of wos) {
        const key = wo.businessPriorityId
          ? pMap.get(wo.businessPriorityId) || "Other"
          : "Unrated";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        discipline: "Leadership",
        pie: {
          title: "Active work orders by business priority",
          data: [...counts.entries()].map(([name, value]) => ({ name, value })),
        },
        bar: {
          title: "Open items by area",
          xKey: "name",
          data: [
            { name: "Work Orders", count: wos.length },
            { name: "NCRs", count: openNcr },
            { name: "MRB", count: openMrb },
            { name: "POs", count: openPo },
          ],
          series: [{ key: "count", name: "Open", color: AMBER }],
        },
      };
    }

    default: {
      // PRODUCTION
      const [byStatus, centers] = await Promise.all([
        prisma.workOrder.groupBy({ by: ["status"], _count: true }),
        prisma.workOrder.groupBy({
          by: ["workCenter"],
          where: { status: { in: ["RELEASED", "IN_PROGRESS", "ON_HOLD", "KITTED"] } },
          _count: true,
        }),
      ]);
      const centerRows = centers
        .filter((c) => c.workCenter)
        .sort((a, b) => b._count - a._count)
        .slice(0, 6)
        .map((c) => ({ name: c.workCenter as string, count: c._count }));
      return {
        discipline: "Production",
        pie: {
          title: "Work orders by status",
          data: byStatus.map((w) => ({
            name: w.status.replace(/_/g, " "),
            value: w._count,
          })),
        },
        bar: {
          title: "Open load by work center",
          xKey: "name",
          data: centerRows,
          series: [{ key: "count", name: "Open WOs", color: TEAL }],
        },
      };
    }
  }
}
