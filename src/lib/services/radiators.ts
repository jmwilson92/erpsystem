import { prisma } from "@/lib/db";
import { getFloorBoardData } from "@/lib/services/work-orders";
import { compactCurrency } from "@/lib/utils";

/**
 * Discipline info-radiators. Each slide is a full-screen board tuned to one
 * discipline; the radiator page rotates through the selected slides on a timer
 * (monitor display — no interaction needed).
 */

export type RadiatorMetric = {
  label: string;
  value: string | number;
  tone: "teal" | "amber" | "rose" | "emerald" | "sky" | "violet" | "slate";
  hint?: string;
};

export type RadiatorSlide = {
  id: string;
  title: string;
  accent: string; // hex for the slide accent
  metrics: RadiatorMetric[];
};

const toneOf = (bad: boolean, warn = false): RadiatorMetric["tone"] =>
  bad ? "rose" : warn ? "amber" : "emerald";

export async function getRadiatorSlides(): Promise<RadiatorSlide[]> {
  const [
    floor,
    mrb,
    ncr,
    poOpen,
    prPending,
    suppliers,
    readyShip,
    shippedWeek,
    dockWaiting,
    inspPending,
    engOpen,
    engBlocked,
    projects,
    priorities,
  ] = await Promise.all([
    getFloorBoardData(),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.nonConformance.count({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
    }),
    prisma.purchaseOrder.count({
      where: { status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"] } },
    }),
    prisma.purchaseRequest.count({ where: { status: "SUBMITTED" } }),
    prisma.supplier.findMany({
      where: { isApprovedVendor: true },
      select: { onTimeDeliveryPct: true, overallScore: true },
    }),
    prisma.salesOrder.count({ where: { status: "READY_TO_SHIP" } }),
    prisma.shipment.count({
      where: {
        status: { in: ["SHIPPED", "DELIVERED"] },
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    }),
    prisma.receivingTraveler.count({ where: { status: { in: ["WAITING", "PARTIAL"] } } }),
    prisma.inspection.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    prisma.engTask.count({
      where: { status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
    }),
    prisma.engTask.count({ where: { status: "BLOCKED" } }),
    prisma.project.findMany({
      where: { status: "ACTIVE" },
      select: { plannedValue: true, earnedValue: true, actualCost: true },
    }),
    prisma.businessPriority.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { priority: "asc" },
      select: { number: true, title: true, _count: { select: { workOrders: true } } },
      take: 6,
    }),
  ]);

  const avgOtd = suppliers.length
    ? Math.round(suppliers.reduce((s, x) => s + x.onTimeDeliveryPct, 0) / suppliers.length)
    : 100;
  const avgScore = suppliers.length
    ? Math.round(suppliers.reduce((s, x) => s + x.overallScore, 0) / suppliers.length)
    : 0;

  const spis = projects.map((p) =>
    p.plannedValue > 0 ? p.earnedValue / p.plannedValue : 1
  );
  const cpis = projects.map((p) =>
    p.actualCost > 0 ? p.earnedValue / p.actualCost : 1
  );
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 1);

  const slides: RadiatorSlide[] = [
    {
      id: "production",
      title: "Production",
      accent: "#14b8a6",
      metrics: [
        { label: "In progress", value: floor.counts.inProgress, tone: "teal" },
        { label: "On hold", value: floor.counts.onHold, tone: toneOf(floor.counts.onHold > 0, true) },
        { label: "First-pass yield", value: `${floor.kpis.fpy}%`, tone: toneOf(floor.kpis.fpy < 90, floor.kpis.fpy < 95) },
        { label: "Plant load", value: `${floor.kpis.utilization}%`, tone: toneOf(floor.kpis.utilization > 100, floor.kpis.utilization > 85) },
        { label: "Efficiency", value: `${floor.kpis.efficiency}%`, tone: "sky" },
        { label: "WIP value", value: compactCurrency(floor.wipValue), tone: "emerald" },
      ],
    },
    {
      id: "quality",
      title: "Quality",
      accent: "#f59e0b",
      metrics: [
        { label: "Open NCRs", value: ncr, tone: toneOf(ncr > 5, ncr > 0) },
        { label: "Open MRB", value: mrb, tone: toneOf(mrb > 0, false) },
        { label: "Incoming yield", value: `${floor.kpis.fpy}%`, tone: toneOf(floor.kpis.fpy < 90, floor.kpis.fpy < 95) },
        { label: "Inspections pending", value: inspPending, tone: toneOf(inspPending > 10, inspPending > 0) },
      ],
    },
    {
      id: "purchasing",
      title: "Purchasing",
      accent: "#38bdf8",
      metrics: [
        { label: "Open POs", value: poOpen, tone: "sky" },
        { label: "PRs awaiting approval", value: prPending, tone: toneOf(prPending > 10, prPending > 0) },
        { label: "Avg supplier OTD", value: `${avgOtd}%`, tone: toneOf(avgOtd < 85, avgOtd < 95) },
        { label: "Avg supplier score", value: avgScore, tone: "emerald" },
      ],
    },
    {
      id: "receiving",
      title: "Receiving",
      accent: "#a78bfa",
      metrics: [
        { label: "Awaiting dock", value: dockWaiting, tone: toneOf(dockWaiting > 15, dockWaiting > 0) },
        { label: "Inspections pending", value: inspPending, tone: toneOf(inspPending > 10, inspPending > 0) },
        { label: "Open MRB", value: mrb, tone: toneOf(mrb > 0) },
      ],
    },
    {
      id: "shipping",
      title: "Shipping",
      accent: "#0ea5e9",
      metrics: [
        { label: "Ready to ship", value: readyShip, tone: toneOf(false, readyShip > 0) },
        { label: "Shipped (7 days)", value: shippedWeek, tone: "emerald" },
      ],
    },
    {
      id: "engineering",
      title: "Engineering",
      accent: "#8b5cf6",
      metrics: [
        { label: "Open tasks", value: engOpen, tone: "violet" },
        { label: "Blocked", value: engBlocked, tone: toneOf(engBlocked > 0, false) },
      ],
    },
    {
      id: "pmo",
      title: "PMO",
      accent: "#22d3ee",
      metrics: [
        { label: "Active projects", value: projects.length, tone: "teal" },
        { label: "Avg SPI", value: avg(spis).toFixed(2), tone: toneOf(avg(spis) < 0.9, avg(spis) < 1) },
        { label: "Avg CPI", value: avg(cpis).toFixed(2), tone: toneOf(avg(cpis) < 0.9, avg(cpis) < 1) },
      ],
    },
    {
      id: "priorities",
      title: "Business Priorities",
      accent: "#f43f5e",
      metrics: priorities.map((p) => ({
        label: `${p.number} · ${p.title}`,
        value: `${p._count.workOrders} WO`,
        tone: "slate" as const,
      })),
    },
  ];

  // Drop slides that have nothing to show.
  return slides.filter((s) => s.metrics.length > 0);
}
