/**
 * Kit readiness engine — the receive→kit handoff.
 *
 * Upcoming kits are driven by the work order's planned start date:
 *  - Inside the prep window (2 days before start, or start passed) AND all
 *    material on hand → a kit traveler (KIT-xxxxx) is auto-created so the
 *    floor is told to get ready to kit.
 *  - Material already arrived but the window hasn't opened → shown as
 *    "ready early" with a one-click kit button.
 *  - Material short → shown with exactly what's missing.
 *
 * The sweep runs on the kitting page load and after receiving putaway, so
 * travelers appear the moment the last part hits stock.
 */
import { prisma } from "@/lib/db";
import {
  checkBomMaterialAvailability,
  createKitOrder,
} from "@/lib/services/order-fulfillment";

export const KIT_PREP_WINDOW_DAYS = 2;

export type UpcomingKit = {
  workOrderId: string;
  woNumber: string;
  partNumber: string | null;
  quantity: number;
  status: string;
  plannedStart: Date | null;
  dueDate: Date | null;
  daysToStart: number | null;
  inWindow: boolean;
  ready: boolean;
  shorts: { partNumber: string; short: number }[];
};

/** WOs with a BOM that still need a kit, classified by window + material. */
export async function getUpcomingKits(): Promise<UpcomingKit[]> {
  const wos = await prisma.workOrder.findMany({
    where: {
      bomHeaderId: { not: null },
      status: { in: ["PLANNED", "RELEASED", "READY_TO_KIT", "ON_HOLD"] },
      kitOrders: { none: { status: { in: ["OPEN", "PICKING", "COMPLETE"] } } },
    },
    include: { part: { select: { partNumber: true } } },
    orderBy: [{ plannedStart: "asc" }, { dueDate: "asc" }],
    take: 60,
  });

  const now = Date.now();
  const out: UpcomingKit[] = [];
  for (const wo of wos) {
    const check = await checkBomMaterialAvailability(wo.id);
    const start = wo.plannedStart || wo.dueDate;
    const daysToStart = start
      ? Math.ceil((start.getTime() - now) / 86_400_000)
      : null;
    const inWindow =
      daysToStart === null ? false : daysToStart <= KIT_PREP_WINDOW_DAYS;
    out.push({
      workOrderId: wo.id,
      woNumber: wo.number,
      partNumber: wo.part?.partNumber || null,
      quantity: wo.quantity,
      status: wo.status,
      plannedStart: wo.plannedStart,
      dueDate: wo.dueDate,
      daysToStart,
      inWindow,
      ready: check.allAvailable,
      shorts: check.requirements
        .filter((r) => r.short > 0)
        .map((r) => ({ partNumber: r.partNumber, short: r.short })),
    });
  }
  // Soonest start first; undated last
  out.sort(
    (a, b) =>
      (a.daysToStart ?? Number.MAX_SAFE_INTEGER) -
      (b.daysToStart ?? Number.MAX_SAFE_INTEGER)
  );
  return out;
}

/**
 * Auto-create kit travelers for every WO that is inside the prep window
 * with all material on hand. Safe to run repeatedly (createKitOrder is
 * idempotent per open kit). Returns the travelers it opened.
 */
export async function sweepKitReadiness(userId?: string) {
  const upcoming = await getUpcomingKits();
  const opened: { woNumber: string; kitNumber: string }[] = [];
  for (const u of upcoming) {
    if (!u.inWindow || !u.ready) continue;
    try {
      const kit = await createKitOrder({
        workOrderId: u.workOrderId,
        userId,
      });
      opened.push({ woNumber: u.woNumber, kitNumber: kit.number });
    } catch {
      /* material may have been consumed between check and create — skip */
    }
  }
  return opened;
}

/**
 * Kit references for an MRS: maps partId → kit traveler chip, using the
 * kits on the MRS's own work orders (top-level builds) so STOCK /
 * received component lines show where they're being kitted.
 */
export async function getKitRefsForMrs(mrsId: string) {
  const kits = await prisma.kitOrder.findMany({
    where: { workOrder: { materialRequisitionId: mrsId } },
    include: {
      lines: { select: { partId: true, status: true } },
      workOrder: { select: { id: true, partId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // partId → { kitId, number, status, lineStatus }
  const byPart = new Map<
    string,
    { kitId: string; number: string; kitStatus: string; lineStatus: string }
  >();
  for (const kit of kits) {
    // The assembly being built gets the kit chip too
    if (kit.workOrder.partId && !byPart.has(kit.workOrder.partId)) {
      byPart.set(kit.workOrder.partId, {
        kitId: kit.id,
        number: kit.number,
        kitStatus: kit.status,
        lineStatus: kit.status === "COMPLETE" ? "PICKED" : "OPEN",
      });
    }
    for (const l of kit.lines) {
      if (!byPart.has(l.partId)) {
        byPart.set(l.partId, {
          kitId: kit.id,
          number: kit.number,
          kitStatus: kit.status,
          lineStatus: l.status,
        });
      }
    }
  }
  return byPart;
}
