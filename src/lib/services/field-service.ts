/**
 * Field service — customer calls, dispatch, on-site work, and billing.
 *
 * Shape mirrors how service actually runs:
 *   ticket (the customer's problem)
 *     └── visit (one dispatched trip; a job can need several)
 *           ├── labor (tech hours)
 *           └── parts (consumed from a warehouse or off the van)
 *
 * Links to User/Customer/Part are plain ids (see schema note), so callers
 * that need names resolve them via the helpers here rather than Prisma joins.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recordOdometer } from "./fleet";

export const TICKET_STATUSES = [
  "REQUEST",
  "SCHEDULED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const;

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const SERVICE_TYPES = [
  "REPAIR",
  "INSTALL",
  "PM",
  "INSPECTION",
  "WARRANTY",
] as const;

export const VISIT_STATUSES = [
  "SCHEDULED",
  "EN_ROUTE",
  "ON_SITE",
  "DONE",
  "CANCELLED",
] as const;

/** Open = still needs someone to do something. */
export const OPEN_TICKET_STATUSES = [
  "REQUEST",
  "SCHEDULED",
  "IN_PROGRESS",
  "ON_HOLD",
] as const;

/** SVC-0001, SVC-0002 … derived from the current max so gaps don't repeat. */
async function nextTicketNumber(): Promise<string> {
  const last = await prisma.serviceTicket.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last?.number?.match(/(\d+)$/)?.[1];
  const next = (n ? parseInt(n, 10) : 0) + 1;
  return `SVC-${String(next).padStart(4, "0")}`;
}

export async function createTicket(params: {
  customerId: string;
  title: string;
  description?: string | null;
  installedAssetId?: string | null;
  priority?: string;
  serviceType?: string;
  billable?: boolean;
  slaDueAt?: Date | null;
  siteAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  userId?: string;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("A short description of the problem is required");
  if (!params.customerId) throw new Error("Customer is required");

  const ticket = await prisma.serviceTicket.create({
    data: {
      number: await nextTicketNumber(),
      customerId: params.customerId,
      installedAssetId: params.installedAssetId || null,
      title,
      description: params.description?.trim() || null,
      priority: params.priority || "MEDIUM",
      serviceType: params.serviceType || "REPAIR",
      billable: params.billable ?? true,
      slaDueAt: params.slaDueAt ?? null,
      siteAddress: params.siteAddress?.trim() || null,
      contactName: params.contactName?.trim() || null,
      contactPhone: params.contactPhone?.trim() || null,
      openedById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "ServiceTicket",
    entityId: ticket.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: ticket.number, priority: ticket.priority },
  });
  return ticket;
}

export async function listTickets(params?: {
  status?: string;
  open?: boolean;
  customerId?: string;
  technicianId?: string;
}) {
  return prisma.serviceTicket.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.open
        ? { status: { in: [...OPEN_TICKET_STATUSES] } }
        : {}),
      ...(params?.customerId ? { customerId: params.customerId } : {}),
      ...(params?.technicianId
        ? { visits: { some: { technicianId: params.technicianId } } }
        : {}),
    },
    include: {
      visits: {
        orderBy: { scheduledFor: "asc" },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          technicianId: true,
          vehicleId: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export async function getTicket(id: string) {
  return prisma.serviceTicket.findUnique({
    where: { id },
    include: {
      installedAsset: true,
      visits: {
        orderBy: { scheduledFor: "asc" },
        include: { labor: true, parts: true, vehicle: true },
      },
    },
  });
}

export async function updateTicketStatus(params: {
  id: string;
  status: string;
  userId?: string;
}) {
  const data: Record<string, unknown> = { status: params.status };
  if (params.status === "CLOSED" || params.status === "COMPLETED") {
    data.closedAt = new Date();
  }
  const t = await prisma.serviceTicket.update({
    where: { id: params.id },
    data,
  });
  await logAudit({
    entityType: "ServiceTicket",
    entityId: params.id,
    action: `STATUS_${params.status}`,
    userId: params.userId,
  });
  return t;
}

// ─── Dispatch ───────────────────────────────────────────────────

/**
 * Schedule a trip. Moves the ticket out of REQUEST so the queue reflects that
 * someone is actually going.
 */
export async function scheduleVisit(params: {
  ticketId: string;
  technicianId?: string | null;
  vehicleId?: string | null;
  scheduledFor?: Date | null;
  scheduledEnd?: Date | null;
  userId?: string;
}) {
  const visit = await prisma.serviceVisit.create({
    data: {
      ticketId: params.ticketId,
      technicianId: params.technicianId || null,
      vehicleId: params.vehicleId || null,
      scheduledFor: params.scheduledFor ?? null,
      scheduledEnd: params.scheduledEnd ?? null,
    },
  });
  await prisma.serviceTicket.updateMany({
    where: { id: params.ticketId, status: "REQUEST" },
    data: { status: "SCHEDULED" },
  });
  await logAudit({
    entityType: "ServiceVisit",
    entityId: visit.id,
    action: "SCHEDULED",
    userId: params.userId,
  });
  return visit;
}

export async function updateVisit(
  id: string,
  data: Record<string, unknown>,
  userId?: string
) {
  const visit = await prisma.serviceVisit.update({ where: { id }, data });
  await logAudit({
    entityType: "ServiceVisit",
    entityId: id,
    action: "UPDATED",
    userId,
  });
  return visit;
}

/** Tech arrives — stamps start time and pulls the ticket into IN_PROGRESS. */
export async function startVisit(params: {
  id: string;
  odometerStart?: number | null;
  userId?: string;
}) {
  const visit = await prisma.serviceVisit.update({
    where: { id: params.id },
    data: {
      status: "ON_SITE",
      startedAt: new Date(),
      odometerStart: params.odometerStart ?? undefined,
    },
  });
  await prisma.serviceTicket.updateMany({
    where: { id: visit.ticketId, status: { in: ["REQUEST", "SCHEDULED"] } },
    data: { status: "IN_PROGRESS" },
  });
  if (visit.vehicleId && params.odometerStart != null) {
    await recordOdometer(visit.vehicleId, params.odometerStart);
  }
  return visit;
}

/**
 * Close out a trip. The ticket only moves to COMPLETED when no other visit is
 * still outstanding — multi-trip jobs stay open until the last one is done.
 */
export async function completeVisit(params: {
  id: string;
  summary?: string | null;
  signedBy?: string | null;
  odometerEnd?: number | null;
  userId?: string;
}) {
  const visit = await prisma.serviceVisit.update({
    where: { id: params.id },
    data: {
      status: "DONE",
      completedAt: new Date(),
      summary: params.summary?.trim() || null,
      signedBy: params.signedBy?.trim() || null,
      odometerEnd: params.odometerEnd ?? undefined,
    },
  });

  if (visit.vehicleId && params.odometerEnd != null) {
    await recordOdometer(visit.vehicleId, params.odometerEnd);
  }

  const outstanding = await prisma.serviceVisit.count({
    where: {
      ticketId: visit.ticketId,
      status: { in: ["SCHEDULED", "EN_ROUTE", "ON_SITE"] },
    },
  });
  if (outstanding === 0) {
    await prisma.serviceTicket.update({
      where: { id: visit.ticketId },
      data: { status: "COMPLETED", closedAt: new Date() },
    });
  }

  await logAudit({
    entityType: "ServiceVisit",
    entityId: params.id,
    action: "COMPLETED",
    userId: params.userId,
  });
  return visit;
}

// ─── Labor & parts ──────────────────────────────────────────────

export async function addLabor(params: {
  visitId: string;
  userId?: string | null;
  hours: number;
  rate?: number;
  billable?: boolean;
  notes?: string | null;
  workedOn?: Date | null;
}) {
  if (!(params.hours > 0)) throw new Error("Hours must be greater than zero");
  return prisma.serviceLabor.create({
    data: {
      visitId: params.visitId,
      userId: params.userId || null,
      hours: params.hours,
      rate: params.rate ?? 0,
      billable: params.billable ?? true,
      notes: params.notes?.trim() || null,
      workedOn: params.workedOn ?? new Date(),
    },
  });
}

export async function addPartUsage(params: {
  visitId: string;
  partId?: string | null;
  lotId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice?: number;
  billable?: boolean;
  fromVehicleId?: string | null;
}) {
  if (!(params.quantity > 0)) throw new Error("Quantity must be greater than zero");
  return prisma.servicePartUsage.create({
    data: {
      visitId: params.visitId,
      partId: params.partId || null,
      lotId: params.lotId || null,
      description: params.description?.trim() || null,
      quantity: params.quantity,
      unitPrice: params.unitPrice ?? 0,
      billable: params.billable ?? true,
      fromVehicleId: params.fromVehicleId || null,
    },
  });
}

export async function removeLabor(id: string) {
  return prisma.serviceLabor.delete({ where: { id } });
}

export async function removePartUsage(id: string) {
  return prisma.servicePartUsage.delete({ where: { id } });
}

// ─── Billing ────────────────────────────────────────────────────

export type TicketTotals = {
  laborHours: number;
  laborCost: number;
  partsCost: number;
  billableTotal: number;
  nonBillableTotal: number;
  total: number;
};

/**
 * Roll a ticket's visits into money. Non-billable work is tracked separately
 * rather than dropped — warranty jobs still have a real cost worth seeing.
 */
export async function getTicketTotals(ticketId: string): Promise<TicketTotals> {
  const visits = await prisma.serviceVisit.findMany({
    where: { ticketId },
    include: { labor: true, parts: true },
  });

  let laborHours = 0;
  let laborCost = 0;
  let partsCost = 0;
  let billableTotal = 0;
  let nonBillableTotal = 0;

  for (const v of visits) {
    for (const l of v.labor) {
      const amount = l.hours * (l.rate || 0);
      laborHours += l.hours;
      laborCost += amount;
      if (l.billable) billableTotal += amount;
      else nonBillableTotal += amount;
    }
    for (const p of v.parts) {
      const amount = p.quantity * (p.unitPrice || 0);
      partsCost += amount;
      if (p.billable) billableTotal += amount;
      else nonBillableTotal += amount;
    }
  }

  return {
    laborHours,
    laborCost,
    partsCost,
    billableTotal,
    nonBillableTotal,
    total: laborCost + partsCost,
  };
}

// ─── Installed base ─────────────────────────────────────────────

export async function listInstalledAssets(customerId?: string) {
  return prisma.installedAsset.findMany({
    where: {
      status: "ACTIVE",
      ...(customerId ? { customerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function createInstalledAsset(params: {
  customerId: string;
  serialNumber?: string | null;
  partId?: string | null;
  siteName?: string | null;
  address?: string | null;
  installedAt?: Date | null;
  warrantyEnds?: Date | null;
  notes?: string | null;
  userId?: string;
}) {
  const asset = await prisma.installedAsset.create({
    data: {
      customerId: params.customerId,
      serialNumber: params.serialNumber?.trim() || null,
      partId: params.partId || null,
      siteName: params.siteName?.trim() || null,
      address: params.address?.trim() || null,
      installedAt: params.installedAt ?? null,
      warrantyEnds: params.warrantyEnds ?? null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "InstalledAsset",
    entityId: asset.id,
    action: "CREATED",
    userId: params.userId,
  });
  return asset;
}

/** True when the unit is still under warranty — drives billable defaults. */
export function isUnderWarranty(warrantyEnds: Date | null | undefined): boolean {
  return !!warrantyEnds && warrantyEnds >= new Date();
}

// ─── Dashboard ──────────────────────────────────────────────────

export async function getServiceSummary() {
  const now = new Date();
  const [open, unscheduled, overdueSla, todayVisits] = await Promise.all([
    prisma.serviceTicket.count({
      where: { status: { in: [...OPEN_TICKET_STATUSES] } },
    }),
    prisma.serviceTicket.count({ where: { status: "REQUEST" } }),
    prisma.serviceTicket.count({
      where: {
        status: { in: [...OPEN_TICKET_STATUSES] },
        slaDueAt: { lt: now },
      },
    }),
    prisma.serviceVisit.count({
      where: {
        status: { in: ["SCHEDULED", "EN_ROUTE", "ON_SITE"] },
        scheduledFor: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
      },
    }),
  ]);
  return { open, unscheduled, overdueSla, todayVisits };
}
