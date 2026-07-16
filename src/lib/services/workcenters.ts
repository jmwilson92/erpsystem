"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isWorkArea, type WorkArea } from "@/lib/work-areas";

export async function listWorkCenters(opts?: {
  area?: WorkArea;
  activeOnly?: boolean;
}) {
  return prisma.workCenter.findMany({
    where: {
      ...(opts?.area ? { area: opts.area } : {}),
      ...(opts?.activeOnly !== false ? { isActive: true } : {}),
    },
    orderBy: [{ area: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  });
}

export async function getDefaultWorkCenter(area: WorkArea) {
  const def = await prisma.workCenter.findFirst({
    where: { area, isActive: true, isDefault: true },
    orderBy: { sortOrder: "asc" },
  });
  if (def) return def;
  return prisma.workCenter.findFirst({
    where: { area, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getWorkCenterByCode(code: string) {
  return prisma.workCenter.findUnique({ where: { code } });
}

/**
 * Resolve where a WI step should run.
 * - Specific workCenter code wins when set
 * - Else default for requiredArea
 * - Else isTestStep → default TEST station (not manufacturing)
 * - Else coordinator / WO current station
 */
export async function resolveStepStation(params: {
  stepWorkCenter?: string | null;
  requiredArea?: string | null;
  isTestStep?: boolean;
  /** BUILD | QA | TEST when requiredArea not set */
  stepType?: string | null;
  preferredWorkCenter?: string | null; // coordinator / WO
}): Promise<{ code: string | null; area: WorkArea | null; locked: boolean }> {
  if (params.stepWorkCenter) {
    const wc = await getWorkCenterByCode(params.stepWorkCenter);
    return {
      code: params.stepWorkCenter,
      area: wc && isWorkArea(wc.area) ? wc.area : null,
      locked: true, // specific code from WI
    };
  }
  let area: WorkArea | null = isWorkArea(params.requiredArea)
    ? params.requiredArea
    : null;
  if (!area) {
    if (params.isTestStep || params.stepType === "TEST") area = "TEST";
    else if (params.stepType === "QA") area = "QA";
    else if (params.stepType === "BUILD") area = "MANUFACTURING";
  }
  if (area) {
    const def = await getDefaultWorkCenter(area);
    return {
      code: def?.code || null,
      area,
      locked: false,
    };
  }
  if (params.preferredWorkCenter) {
    const wc = await getWorkCenterByCode(params.preferredWorkCenter);
    return {
      code: params.preferredWorkCenter,
      area: wc && isWorkArea(wc.area) ? wc.area : null,
      locked: false,
    };
  }
  return { code: null, area: null, locked: false };
}

export async function saveWorkCenter(params: {
  id?: string;
  code: string;
  name: string;
  area: WorkArea;
  department?: string;
  capacityHoursPerDay?: number;
  efficiency?: number;
  isActive?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  userId?: string;
}) {
  const code = params.code.trim().toUpperCase();
  if (!code) throw new Error("Workcenter code required");
  if (!isWorkArea(params.area)) throw new Error("Invalid area");

  if (params.isDefault) {
    await prisma.workCenter.updateMany({
      where: { area: params.area, isDefault: true },
      data: { isDefault: false },
    });
  }

  if (params.id) {
    const wc = await prisma.workCenter.update({
      where: { id: params.id },
      data: {
        code,
        name: params.name.trim(),
        area: params.area,
        department: params.department,
        capacityHoursPerDay: params.capacityHoursPerDay ?? 16,
        efficiency: params.efficiency ?? 0.85,
        isActive: params.isActive ?? true,
        isDefault: params.isDefault ?? false,
        sortOrder: params.sortOrder ?? 0,
      },
    });
    await logAudit({
      entityType: "WorkCenter",
      entityId: wc.id,
      action: "UPDATED",
      userId: params.userId,
    });
    return wc;
  }

  const wc = await prisma.workCenter.create({
    data: {
      code,
      name: params.name.trim(),
      area: params.area,
      department: params.department,
      capacityHoursPerDay: params.capacityHoursPerDay ?? 16,
      efficiency: params.efficiency ?? 0.85,
      isActive: params.isActive ?? true,
      isDefault: params.isDefault ?? false,
      sortOrder: params.sortOrder ?? 0,
    },
  });
  await logAudit({
    entityType: "WorkCenter",
    entityId: wc.id,
    action: "CREATED",
    userId: params.userId,
  });
  return wc;
}

/** Coordinator assigns WO header station (current workcenter). */
export async function reassignWorkOrderStation(params: {
  workOrderId: string;
  workCenterCode: string;
  userId?: string;
  force?: boolean;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: {
      stepCompletions: { include: { step: true } },
    },
  });
  if (!wo) throw new Error("Work order not found");

  const wc = await getWorkCenterByCode(params.workCenterCode);
  if (!wc || !wc.isActive) throw new Error("Invalid or inactive workcenter");

  // If any incomplete locked step requires a different area/center, block unless force
  if (!params.force) {
    for (const sc of wo.stepCompletions) {
      if (["SIGNED", "PASSED", "SKIPPED", "FAILED"].includes(sc.status)) continue;
      if (!sc.step.routeLock) continue;
      const required = sc.step.workCenter || null;
      const area = sc.step.requiredArea;
      if (required && required !== wc.code) {
        throw new Error(
          `Step "${sc.step.title}" is locked to ${required}. Use force override to move.`
        );
      }
      if (area && isWorkArea(area) && wc.area !== area) {
        throw new Error(
          `Step "${sc.step.title}" is locked to ${area}. Use force override to move.`
        );
      }
    }
  }

  const from = wo.workCenter;
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      workCenter: wc.code,
      department: wc.area,
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: wo.status,
          userId: params.userId,
          notes: `Station ${from || "—"} → ${wc.code} (${wc.area})${
            params.force ? " [forced]" : ""
          }`,
        },
      },
    },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "STATION_REASSIGNED",
    userId: params.userId,
    metadata: { from, to: wc.code, area: wc.area, force: !!params.force },
  });

  return { workCenter: wc.code, area: wc.area };
}

/** Assign/reassign a single step's runtime station. */
export async function reassignStepStation(params: {
  workOrderId: string;
  stepId: string;
  workCenterCode: string;
  userId?: string;
  force?: boolean;
}) {
  const sc = await prisma.workOrderStepCompletion.findUnique({
    where: {
      workOrderId_stepId: {
        workOrderId: params.workOrderId,
        stepId: params.stepId,
      },
    },
    include: { step: true },
  });
  if (!sc) throw new Error("Step completion not found");

  const wc = await getWorkCenterByCode(params.workCenterCode);
  if (!wc || !wc.isActive) throw new Error("Invalid or inactive workcenter");

  if (sc.step.routeLock && !params.force) {
    if (sc.step.workCenter && sc.step.workCenter !== wc.code) {
      throw new Error(
        `Step locked to ${sc.step.workCenter}. Enable force override to change.`
      );
    }
    if (
      sc.step.requiredArea &&
      isWorkArea(sc.step.requiredArea) &&
      wc.area !== sc.step.requiredArea
    ) {
      throw new Error(
        `Step locked to ${sc.step.requiredArea} area. Enable force override to change.`
      );
    }
  } else if (!params.force && sc.step.requiredArea && isWorkArea(sc.step.requiredArea)) {
    // Soft constraint: must stay in area unless force
    if (wc.area !== sc.step.requiredArea) {
      throw new Error(
        `Step requires ${sc.step.requiredArea}. Pick a station in that area, or force override.`
      );
    }
  }

  await prisma.workOrderStepCompletion.update({
    where: { id: sc.id },
    data: { assignedWorkCenter: wc.code },
  });

  await logAudit({
    entityType: "WorkOrderStepCompletion",
    entityId: sc.id,
    action: "STEP_STATION_ASSIGNED",
    userId: params.userId,
    metadata: {
      workOrderId: params.workOrderId,
      stepId: params.stepId,
      workCenter: wc.code,
      force: !!params.force,
    },
  });

  return { assignedWorkCenter: wc.code, area: wc.area };
}

/** When creating WO step completions, seed assignedWorkCenter from WI routing. */
export async function seedStepAssignments(workOrderId: string, preferredWorkCenter?: string) {
  const completions = await prisma.workOrderStepCompletion.findMany({
    where: { workOrderId },
    include: { step: true },
  });
  for (const sc of completions) {
    if (sc.assignedWorkCenter) continue;
    const resolved = await resolveStepStation({
      stepWorkCenter: sc.step.workCenter,
      requiredArea: sc.step.requiredArea,
      isTestStep: sc.step.isTestStep,
      stepType: sc.step.stepType,
      preferredWorkCenter,
    });
    if (resolved.code) {
      await prisma.workOrderStepCompletion.update({
        where: { id: sc.id },
        data: { assignedWorkCenter: resolved.code },
      });
    }
  }
}

export async function listWorkCenterCodesByArea(area: WorkArea) {
  const rows = await prisma.workCenter.findMany({
    where: { area, isActive: true },
    select: { code: true },
  });
  return rows.map((r) => r.code);
}
