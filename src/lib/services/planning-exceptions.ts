"use server";

import { prisma } from "@/lib/db";
import { endOfWorkingDay } from "@/lib/services/schedule";
import { getCapacityAndWorkload } from "@/lib/services/capacity";
import { KIT_BUFFER_MINUTES } from "@/lib/services/schedule";

export type PlanningExceptionCode =
  | "NO_ESTIMATE"
  | "NO_WI"
  | "NO_DATES"
  | "LATE_RISK"
  | "OVER_CAPACITY"
  | "MATERIAL_SHORT"
  | "NO_BOM"
  | "UNSCHEDULED";

export type PlanningException = {
  code: PlanningExceptionCode;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  href: string;
  entityType: "WorkOrder" | "WorkCenter" | "MaterialRequisition";
  entityId: string;
  entityNumber: string;
};

/**
 * Build the planner exceptions board for the open shop.
 */
export async function getPlanningExceptions(): Promise<{
  exceptions: PlanningException[];
  counts: Record<string, number>;
}> {
  const exceptions: PlanningException[] = [];

  const openWos = await prisma.workOrder.findMany({
    where: {
      status: {
        notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"],
      },
    },
    include: {
      instructions: { select: { id: true } },
      part: { select: { partNumber: true } },
      bomHeader: { select: { id: true, status: true } },
    },
    take: 500,
  });

  for (const wo of openWos) {
    const est = wo.estimatedMinutes || 0;
    if (est <= KIT_BUFFER_MINUTES) {
      exceptions.push({
        code: "NO_ESTIMATE",
        severity: "warn",
        title: "Weak or default estimate",
        detail: `${wo.number} has only ${est} min (kit buffer / no WI steps)`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
    if (
      wo.type === "PRODUCTION" &&
      wo.instructions.length === 0 &&
      wo.partId
    ) {
      exceptions.push({
        code: "NO_WI",
        severity: "warn",
        title: "No work instruction",
        detail: `${wo.number} (${wo.part?.partNumber || "—"}) has no attached WI`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
    if (!wo.dueDate && !wo.plannedStart && !wo.plannedEnd) {
      exceptions.push({
        code: "NO_DATES",
        severity: "critical",
        title: "No schedule dates",
        detail: `${wo.number} has no due / planned start / planned end`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    } else if (!wo.plannedStart || !wo.plannedEnd) {
      exceptions.push({
        code: "UNSCHEDULED",
        severity: "warn",
        title: "Missing planned window",
        detail: `${wo.number} has due date but incomplete planned start/end`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
    if (
      wo.dueDate &&
      wo.plannedEnd &&
      wo.plannedEnd > endOfWorkingDay(wo.dueDate)
    ) {
      exceptions.push({
        code: "LATE_RISK",
        severity: "critical",
        title: "Late risk",
        detail: `${wo.number} planned end is after due date`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    } else if (wo.scheduleRisk === "LATE_RISK") {
      exceptions.push({
        code: "LATE_RISK",
        severity: "critical",
        title: "Late risk",
        detail: `${wo.number} flagged LATE_RISK`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
    if (
      ["WAITING_MATERIAL", "READY_TO_KIT"].includes(wo.status) ||
      wo.kitStatus === "WAITING_MATERIAL"
    ) {
      exceptions.push({
        code: "MATERIAL_SHORT",
        severity: "warn",
        title: "Material short / waiting",
        detail: `${wo.number} status ${wo.status} · kit ${wo.kitStatus}`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
    if (
      wo.type === "PRODUCTION" &&
      !wo.bomHeaderId &&
      wo.sourceType !== "OTHER"
    ) {
      exceptions.push({
        code: "NO_BOM",
        severity: "critical",
        title: "Production WO without BOM",
        detail: `${wo.number} has no BOM header`,
        href: `/work-orders/${wo.id}`,
        entityType: "WorkOrder",
        entityId: wo.id,
        entityNumber: wo.number,
      });
    }
  }

  try {
    const cap = await getCapacityAndWorkload();
    for (const c of cap.centers) {
      if (c.alert === "OVER") {
        exceptions.push({
          code: "OVER_CAPACITY",
          severity: "critical",
          title: `Over capacity · ${c.code}`,
          detail: `${c.name}: ${c.utilizationPct}% util (${c.projectedHoursThisWeek}h / ${c.availableHoursThisWeek}h)`,
          href: `/planning?tab=capacity`,
          entityType: "WorkCenter",
          entityId: c.workCenterId,
          entityNumber: c.code,
        });
      }
    }
  } catch {
    // capacity optional
  }

  // Deduplicate by code+entityId
  const seen = new Set<string>();
  const unique = exceptions.filter((e) => {
    const k = `${e.code}:${e.entityId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const severityRank = { critical: 0, warn: 1, info: 2 };
  unique.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.code.localeCompare(b.code)
  );

  const counts: Record<string, number> = {};
  for (const e of unique) {
    counts[e.code] = (counts[e.code] || 0) + 1;
  }

  return { exceptions: unique.slice(0, 100), counts };
}
