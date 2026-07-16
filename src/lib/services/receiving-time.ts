/**
 * Receiving traveler labor: scan-in / scan-out + deliver to QA/Test station.
 * Time posts to the user's timesheet against the PO project / WBS / charge code.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { listWorkCenterCodesByArea } from "@/lib/services/workcenters";

const LABOR_RATE = 55;

export type StationArea = "QA" | "TEST" | "DOCK";

function areaFromWorkCenter(code: string | null | undefined): StationArea | null {
  if (!code) return null;
  const u = code.toUpperCase();
  if (u.startsWith("TEST") || u.includes("TEST")) return "TEST";
  if (u.startsWith("QA") || u.includes("QA")) return "QA";
  if (u === "DOCK" || u.startsWith("RCV") || u.includes("RECEIV")) return "DOCK";
  return null;
}

/** Resolve default station code for an area. */
export async function defaultStationCode(area: "QA" | "TEST"): Promise<string> {
  const codes = await listWorkCenterCodesByArea(area);
  if (codes.length) return codes[0];
  return area === "QA" ? "QA-01" : "TEST-01";
}

async function chargeContextForTraveler(travelerId: string) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: travelerId },
    include: {
      purchaseOrder: {
        select: {
          id: true,
          number: true,
          projectId: true,
          wbsElementId: true,
          project: { select: { number: true, name: true } },
          wbsElement: { select: { code: true, name: true } },
          purchaseRequest: {
            select: {
              chargeType: true,
              projectId: true,
              wbsElementId: true,
              salesOrderId: true,
            },
          },
        },
      },
    },
  });
  if (!traveler) throw new Error("Traveler not found");

  const po = traveler.purchaseOrder;
  const pr = po?.purchaseRequest;
  const projectId = po?.projectId || pr?.projectId || null;
  const wbsElementId = po?.wbsElementId || pr?.wbsElementId || null;

  let chargeCode: string | null = null;
  if (po?.wbsElement?.code) {
    chargeCode = po.wbsElement.code;
  } else if (po?.project?.number) {
    chargeCode = po.project.number;
  } else if (pr?.chargeType === "INDIRECT") {
    chargeCode = "IND-RCV";
  } else if (pr?.chargeType === "DIRECT") {
    chargeCode = "DIR-RCV";
  } else if (pr?.chargeType === "SALES_ORDER") {
    chargeCode = `SO-${pr.salesOrderId?.slice(-6) || "RCV"}`;
  } else if (po?.number) {
    chargeCode = po.number;
  } else if (traveler.contractNumber) {
    chargeCode = traveler.contractNumber;
  } else {
    chargeCode = "RCV-OH";
  }

  return {
    traveler,
    projectId,
    wbsElementId,
    chargeCode,
    poNumber: po?.number || null,
  };
}

/**
 * Scan into a receiving traveler — starts labor clock for dock / QA / Test work.
 * One open scan per user (closes other receiving scans for this user).
 */
export async function scanIntoReceivingTraveler(params: {
  travelerId: string;
  userId: string;
  notes?: string | null;
}) {
  const { traveler } = await chargeContextForTraveler(params.travelerId);

  // Close this user's open scan on any other traveler
  const otherOpen = await prisma.receivingTraveler.findMany({
    where: {
      activeScanUserId: params.userId,
      id: { not: params.travelerId },
      activeScanAt: { not: null },
    },
    select: { id: true },
  });
  for (const o of otherOpen) {
    await scanOutOfReceivingTraveler({
      travelerId: o.id,
      userId: params.userId,
      reason: "SWITCH_TRAVELER",
    });
  }

  if (
    traveler.activeScanUserId === params.userId &&
    traveler.activeScanAt
  ) {
    return traveler;
  }

  // If someone else is scanned in, don't steal — still allow work; they own the clock
  if (
    traveler.activeScanUserId &&
    traveler.activeScanUserId !== params.userId &&
    traveler.activeScanAt
  ) {
    throw new Error(
      "Someone else is already scanned into this traveler. They must scan out first."
    );
  }

  const now = new Date();
  const updated = await prisma.receivingTraveler.update({
    where: { id: params.travelerId },
    data: {
      activeScanUserId: params.userId,
      activeScanAt: now,
    },
  });

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: params.travelerId,
    action: "RCV_SCAN_IN",
    userId: params.userId,
    metadata: {
      number: traveler.number,
      at: now.toISOString(),
      notes: params.notes || null,
      workCenter: traveler.currentWorkCenter,
    },
  });

  return updated;
}

/**
 * Scan out — post hours to timesheet against PO charge (project / WBS / code).
 */
export async function scanOutOfReceivingTraveler(params: {
  travelerId: string;
  userId: string;
  reason?: string;
}) {
  const ctx = await chargeContextForTraveler(params.travelerId);
  const { traveler } = ctx;

  if (!traveler.activeScanAt || !traveler.activeScanUserId) {
    return { hours: 0, entryId: null as string | null };
  }

  // Prefer clocking out the actual scanner; allow force when reason is system
  const scanUserId = traveler.activeScanUserId;
  if (
    scanUserId !== params.userId &&
    !["DELIVER", "PUTAWAY", "INSPECTION_DONE", "FORCE"].includes(
      params.reason || ""
    )
  ) {
    throw new Error("Not your open scan on this traveler");
  }

  const end = new Date();
  const ms = end.getTime() - traveler.activeScanAt.getTime();
  let hours = Math.round((ms / 3600000) * 100) / 100;
  if (hours < 0.1 && ms > 30_000) hours = 0.1;
  if (hours > 12) hours = 12;

  await prisma.receivingTraveler.update({
    where: { id: params.travelerId },
    data: {
      activeScanUserId: null,
      activeScanAt: null,
    },
  });

  if (hours < 0.05) {
    await logAudit({
      entityType: "ReceivingTraveler",
      entityId: params.travelerId,
      action: "RCV_SCAN_OUT",
      userId: scanUserId,
      metadata: {
        hours: 0,
        reason: params.reason || "MANUAL",
        skipped: true,
      },
    });
    return { hours: 0, entryId: null as string | null };
  }

  const { getOrCreateTimesheet } = await import("@/lib/services/timesheets");
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  let timesheetId: string | null = null;
  try {
    const sheet = await getOrCreateTimesheet(scanUserId, date);
    if (["OPEN", "REJECTED"].includes(sheet.status)) {
      timesheetId = sheet.id;
    }
  } catch {
    /* unattached ok */
  }

  const station = traveler.currentWorkCenter || "DOCK";
  const reason = params.reason || "MANUAL";
  const entry = await prisma.timeEntry.create({
    data: {
      userId: scanUserId,
      timesheetId: timesheetId || undefined,
      date,
      hours,
      type: "RECEIVING",
      receivingTravelerId: traveler.id,
      projectId: ctx.projectId || undefined,
      wbsElementId: ctx.wbsElementId || undefined,
      chargeCode: ctx.chargeCode || undefined,
      description: `Receiving ${traveler.number}${
        ctx.poNumber ? ` · ${ctx.poNumber}` : ""
      } @ ${station}${reason !== "MANUAL" ? ` (${reason})` : ""}`,
      status: "SUBMITTED",
      laborRate: LABOR_RATE,
      costAmount: Math.round(hours * LABOR_RATE * 100) / 100,
    },
  });

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: params.travelerId,
    action: "RCV_SCAN_OUT",
    userId: scanUserId,
    metadata: {
      hours,
      timeEntryId: entry.id,
      timesheetId,
      chargeCode: ctx.chargeCode,
      projectId: ctx.projectId,
      wbsElementId: ctx.wbsElementId,
      reason,
    },
  });

  return { hours, entryId: entry.id };
}

/**
 * Material handler: mark child delivered to QA or Test workcenter.
 * Closes any open MH scan (time stops) and parks the traveler at the station.
 */
export async function deliverTravelerToStation(params: {
  travelerId: string;
  area: "QA" | "TEST";
  workCenterCode?: string;
  userId: string;
}) {
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id: params.travelerId },
  });
  if (!traveler) throw new Error("Traveler not found");
  if (["COMPLETE", "CLOSED"].includes(traveler.status)) {
    throw new Error("Traveler already complete");
  }

  const code =
    params.workCenterCode?.trim() ||
    (await defaultStationCode(params.area));

  // Scan out whoever is on the clock for this deliver (MH dock time ends)
  if (traveler.activeScanAt && traveler.activeScanUserId) {
    await scanOutOfReceivingTraveler({
      travelerId: traveler.id,
      userId: traveler.activeScanUserId,
      reason: "DELIVER",
    });
  }

  const now = new Date();
  const areaLabel = params.area === "TEST" ? "Test Center" : "QA";
  const updated = await prisma.receivingTraveler.update({
    where: { id: traveler.id },
    data: {
      currentWorkCenter: code,
      atStationSince: now,
      status:
        traveler.status === "READY_TO_STOCK"
          ? traveler.status
          : "IN_INSPECTION",
      notes: `${traveler.number} · AT ${code} — waiting on ${areaLabel} to complete work and send back.`,
    },
  });

  // Align open station inspections' workCenter so queues stay consistent
  const receipts = await prisma.receipt.findMany({
    where: { travelerId: traveler.id },
    select: { id: true },
  });
  const receiptIds = receipts.map((r) => r.id);
  // Also receipts that still point at parent but material is on this child
  if (traveler.parentId) {
    const parentReceipts = await prisma.receipt.findMany({
      where: {
        OR: [
          { travelerId: traveler.parentId },
          { travelerId: traveler.id },
        ],
      },
      select: { id: true },
    });
    for (const r of parentReceipts) {
      if (!receiptIds.includes(r.id)) receiptIds.push(r.id);
    }
  }

  if (receiptIds.length) {
    const typeFilter =
      params.area === "TEST"
        ? { type: "FUNCTIONAL" as const }
        : { type: { in: ["VISUAL", "GDT"] as string[] } };
    await prisma.inspection.updateMany({
      where: {
        receiptId: { in: receiptIds },
        status: { in: ["PENDING", "IN_PROGRESS"] },
        ...typeFilter,
      },
      data: { workCenter: code },
    });
  }

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "DELIVERED_TO_STATION",
    userId: params.userId,
    metadata: {
      area: params.area,
      workCenter: code,
      number: traveler.number,
    },
  });

  return updated;
}

/** Clear station parking when material returns to dock (READY_TO_STOCK) or put away. */
export async function clearTravelerStation(params: {
  travelerId: string;
  userId?: string;
  nextNotes?: string;
}) {
  const t = await prisma.receivingTraveler.findUnique({
    where: { id: params.travelerId },
  });
  if (!t) return null;
  if (!t.currentWorkCenter && !t.atStationSince) return t;

  return prisma.receivingTraveler.update({
    where: { id: params.travelerId },
    data: {
      currentWorkCenter: null,
      atStationSince: null,
      ...(params.nextNotes ? { notes: params.nextNotes } : {}),
    },
  });
}

export function stationAreaOf(traveler: {
  currentWorkCenter?: string | null;
  notes?: string | null;
}): StationArea | null {
  return (
    areaFromWorkCenter(traveler.currentWorkCenter) ||
    (traveler.notes?.toLowerCase().includes("test center")
      ? "TEST"
      : traveler.notes?.toLowerCase().includes("at qa")
        ? "QA"
        : null)
  );
}

/** Infer deliver target from child notes / open inspection types. */
export function inferDeliverArea(params: {
  notes?: string | null;
  needsQa?: boolean;
  needsTest?: boolean;
  hasQaPending?: boolean;
  hasTestPending?: boolean;
}): "QA" | "TEST" {
  const notes = (params.notes || "").toLowerCase();
  const needsVisual =
    params.hasQaPending ||
    params.needsQa ||
    notes.includes("visual") ||
    notes.includes("gd&t") ||
    notes.includes("gd");
  const needsFunctional =
    params.hasTestPending ||
    params.needsTest ||
    notes.includes("functional") ||
    notes.includes("test center");
  // QA first when both
  if (needsVisual) return "QA";
  if (needsFunctional) return "TEST";
  return "QA";
}
