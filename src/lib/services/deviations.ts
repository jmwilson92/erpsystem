/**
 * Deviations and waivers — bounded, written authorisation to depart from a
 * requirement.
 *
 * A deviation is granted before the affected units exist; a waiver accepts
 * units that already depart from requirement. Both are recorded here.
 *
 * The rule this module actually enforces is that an authorisation must be
 * bounded — by quantity, by a date window, or by an explicit list of serials
 * and lots. An open-ended "we always do it this way" departure is the classic
 * audit finding, so approve() refuses one rather than trusting the requester
 * to remember.
 *
 * Whether an approved authorisation is *in force* is computed at read time
 * from the clock and the consumed count, never stored. A row that says
 * APPROVED while its window closed last month is exactly the failure this is
 * meant to prevent, and a nightly job that flips statuses would leave a gap
 * between expiry and the job running.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const DEVIATION_KINDS = ["DEVIATION", "WAIVER"] as const;

export const DEVIATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "INTERNAL_APPROVED",
  "CUSTOMER_SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CLOSED",
] as const;

export const KIND_LABELS: Record<string, string> = {
  DEVIATION: "Deviation (before manufacture)",
  WAIVER: "Waiver (accept as-is)",
};

export type BoundsShape = {
  quantityLimit?: number | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  units?: { id: string }[];
};

/** True when the authorisation is limited in at least one dimension. */
export function hasBound(d: BoundsShape): boolean {
  if (d.quantityLimit != null && d.quantityLimit > 0) return true;
  if (d.effectiveTo != null) return true;
  if ((d.units?.length || 0) > 0) return true;
  return false;
}

export type ForceShape = BoundsShape & {
  status: string;
  quantityUsed?: number;
};

export type ForceState =
  | "IN_FORCE"
  | "NOT_APPROVED"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED"
  | "EXHAUSTED"
  | "CLOSED";

/**
 * Derived state. EXPIRED and EXHAUSTED are computed, not stored — an approved
 * row whose window has closed must never read as usable.
 */
export function forceState(d: ForceShape, now: Date = new Date()): ForceState {
  if (d.status === "CLOSED") return "CLOSED";
  if (d.status !== "APPROVED") return "NOT_APPROVED";
  if (d.effectiveFrom && now < d.effectiveFrom) return "NOT_YET_EFFECTIVE";
  if (d.effectiveTo && now > d.effectiveTo) return "EXPIRED";
  if (
    d.quantityLimit != null &&
    d.quantityLimit > 0 &&
    (d.quantityUsed || 0) >= d.quantityLimit
  ) {
    return "EXHAUSTED";
  }
  return "IN_FORCE";
}

export function isInForce(d: ForceShape, now: Date = new Date()): boolean {
  return forceState(d, now) === "IN_FORCE";
}

export const FORCE_LABELS: Record<ForceState, string> = {
  IN_FORCE: "In force",
  NOT_APPROVED: "Not approved",
  NOT_YET_EFFECTIVE: "Not yet effective",
  EXPIRED: "Expired",
  EXHAUSTED: "Quantity exhausted",
  CLOSED: "Closed",
};

async function nextNumber(kind: string) {
  const prefix = kind === "WAIVER" ? "WVR" : "DEV";
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-`;
  const last = await prisma.deviation.findFirst({
    where: { number: { startsWith: like } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(like.length), 10) + 1 : 1;
  return `${like}${String(seq).padStart(3, "0")}`;
}

export type CreateDeviationInput = {
  kind: string;
  title: string;
  requirement: string;
  description: string;
  justification: string;
  partId?: string | null;
  contractId?: string | null;
  nonConformanceId?: string | null;
  quantityLimit?: number | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  customerApprovalRequired?: boolean;
  requestedById?: string | null;
};

export async function createDeviation(input: CreateDeviationInput) {
  const kind = (input.kind || "DEVIATION").toUpperCase();
  if (!(DEVIATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown kind: ${input.kind}`);
  }
  if (!input.title.trim()) throw new Error("A title is required");
  if (!input.requirement.trim()) {
    throw new Error("State the requirement being departed from");
  }
  if (
    input.effectiveFrom &&
    input.effectiveTo &&
    input.effectiveFrom > input.effectiveTo
  ) {
    throw new Error("The effective window ends before it starts");
  }
  if (input.quantityLimit != null && input.quantityLimit <= 0) {
    throw new Error("A quantity bound must be greater than zero");
  }

  const created = await prisma.deviation.create({
    data: {
      number: await nextNumber(kind),
      kind,
      title: input.title.trim(),
      requirement: input.requirement.trim(),
      description: input.description.trim(),
      justification: input.justification.trim(),
      partId: input.partId || null,
      contractId: input.contractId || null,
      nonConformanceId: input.nonConformanceId || null,
      quantityLimit: input.quantityLimit ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      customerApprovalRequired: input.customerApprovalRequired ?? true,
      requestedById: input.requestedById || null,
      status: "DRAFT",
    },
  });

  await logAudit({
    entityType: "Deviation",
    entityId: created.id,
    action: "CREATED",
    userId: input.requestedById || undefined,
    metadata: { number: created.number, kind },
  }).catch(() => {});

  return created;
}

export async function submitDeviation(id: string, userId?: string | null) {
  const d = await prisma.deviation.findUnique({ where: { id } });
  if (!d) throw new Error("Not found");
  if (d.status !== "DRAFT" && d.status !== "REJECTED") {
    throw new Error(`Cannot submit from ${d.status}`);
  }
  const updated = await prisma.deviation.update({
    where: { id },
    data: { status: "SUBMITTED", rejectedReason: null },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: "SUBMITTED",
    userId: userId || undefined,
  }).catch(() => {});
  return updated;
}

/**
 * Internal approval. Refuses an unbounded authorisation, and refuses to grant
 * final approval while the customer's countersignature is still outstanding —
 * the whole point of the flag is that someone else has to say yes.
 */
export async function approveDeviation(id: string, userId?: string | null) {
  const d = await prisma.deviation.findUnique({
    where: { id },
    include: { units: { select: { id: true } } },
  });
  if (!d) throw new Error("Not found");
  if (d.status === "APPROVED" || d.status === "CLOSED") {
    throw new Error(`Already ${d.status.toLowerCase()}`);
  }
  if (!hasBound(d)) {
    throw new Error(
      "This authorisation is unbounded — set a quantity, an end date, or list the serials and lots it covers before approving"
    );
  }

  const needsCustomer = d.customerApprovalRequired && !d.customerApprovedAt;
  const status = needsCustomer ? "INTERNAL_APPROVED" : "APPROVED";

  const updated = await prisma.deviation.update({
    where: { id },
    data: {
      status,
      approvedById: userId || null,
      approvedAt: new Date(),
    },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: needsCustomer ? "INTERNAL_APPROVED" : "APPROVED",
    userId: userId || undefined,
    metadata: { number: d.number },
  }).catch(() => {});
  return updated;
}

export async function rejectDeviation(
  id: string,
  reason: string,
  userId?: string | null
) {
  if (!reason.trim()) throw new Error("A rejection needs a reason");
  const updated = await prisma.deviation.update({
    where: { id },
    data: { status: "REJECTED", rejectedReason: reason.trim() },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: "REJECTED",
    userId: userId || undefined,
    metadata: { reason: reason.trim() },
  }).catch(() => {});
  return updated;
}

/**
 * Record the customer's countersignature. Promotes to APPROVED only when the
 * internal approval already happened, so a customer letter cannot bypass the
 * internal gate.
 */
export async function recordCustomerApproval(
  id: string,
  reference: string,
  userId?: string | null
) {
  const d = await prisma.deviation.findUnique({
    where: { id },
    include: { units: { select: { id: true } } },
  });
  if (!d) throw new Error("Not found");
  if (!hasBound(d)) {
    throw new Error("Bound the authorisation before recording an approval");
  }

  const promote = d.status === "INTERNAL_APPROVED" || d.status === "CUSTOMER_SUBMITTED";
  const updated = await prisma.deviation.update({
    where: { id },
    data: {
      customerApprovedAt: new Date(),
      customerReference: reference.trim() || null,
      status: promote ? "APPROVED" : d.status,
    },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: "CUSTOMER_APPROVED",
    userId: userId || undefined,
    metadata: { reference: reference.trim() },
  }).catch(() => {});
  return updated;
}

export async function closeDeviation(id: string, userId?: string | null) {
  const updated = await prisma.deviation.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: "CLOSED",
    userId: userId || undefined,
  }).catch(() => {});
  return updated;
}

export async function addUnit(
  deviationId: string,
  input: { serial?: string | null; lotNumber?: string | null; note?: string | null }
) {
  const serial = (input.serial || "").trim() || null;
  const lotNumber = (input.lotNumber || "").trim() || null;
  if (!serial && !lotNumber) {
    throw new Error("Give a serial or a lot number");
  }
  return prisma.deviationUnit.create({
    data: {
      deviationId,
      serial,
      lotNumber,
      note: (input.note || "").trim() || null,
    },
  });
}

export async function removeUnit(unitId: string) {
  return prisma.deviationUnit.delete({ where: { id: unitId } });
}

/**
 * Consume one or more units against a quantity bound. Refuses to overrun the
 * limit — the bound is the authorisation, so exceeding it means shipping
 * unauthorised product.
 */
export async function consume(id: string, qty = 1, userId?: string | null) {
  if (qty <= 0) throw new Error("Quantity must be positive");
  const d = await prisma.deviation.findUnique({
    where: { id },
    include: { units: { select: { id: true } } },
  });
  if (!d) throw new Error("Not found");

  const state = forceState(d);
  if (state !== "IN_FORCE") {
    throw new Error(`Not in force — ${FORCE_LABELS[state].toLowerCase()}`);
  }
  if (d.quantityLimit != null && d.quantityUsed + qty > d.quantityLimit) {
    const left = d.quantityLimit - d.quantityUsed;
    throw new Error(
      `Only ${left} unit${left === 1 ? "" : "s"} remain on ${d.number}`
    );
  }

  const updated = await prisma.deviation.update({
    where: { id },
    data: { quantityUsed: { increment: qty } },
  });
  await logAudit({
    entityType: "Deviation",
    entityId: id,
    action: "CONSUMED",
    userId: userId || undefined,
    metadata: { qty, quantityUsed: updated.quantityUsed },
  }).catch(() => {});
  return updated;
}

export async function getDeviation(id: string) {
  return prisma.deviation.findUnique({
    where: { id },
    include: {
      part: { select: { id: true, partNumber: true, description: true } },
      contract: { select: { id: true, number: true, name: true } },
      nonConformance: { select: { id: true, number: true, title: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      units: { orderBy: { addedAt: "asc" } },
    },
  });
}

export async function listDeviations(filter: {
  kind?: string;
  status?: string;
  partId?: string;
  search?: string;
} = {}) {
  const where: Record<string, unknown> = {};
  if (filter.kind && filter.kind !== "ALL") where.kind = filter.kind;
  if (filter.status && filter.status !== "ALL") where.status = filter.status;
  if (filter.partId) where.partId = filter.partId;
  if (filter.search) {
    where.OR = [
      { number: { contains: filter.search } },
      { title: { contains: filter.search } },
      { requirement: { contains: filter.search } },
    ];
  }

  return prisma.deviation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      part: { select: { id: true, partNumber: true } },
      contract: { select: { id: true, number: true } },
      units: { select: { id: true } },
    },
  });
}

/**
 * Authorisations covering a given serial or lot, in force right now.
 * Used at the point of shipping or acceptance to answer "may we ship this?".
 */
export async function coverageFor(input: {
  partId?: string | null;
  serial?: string | null;
  lotNumber?: string | null;
  now?: Date;
}) {
  const serial = (input.serial || "").trim();
  const lotNumber = (input.lotNumber || "").trim();
  const now = input.now || new Date();

  const candidates = await prisma.deviation.findMany({
    where: {
      status: "APPROVED",
      ...(input.partId ? { partId: input.partId } : {}),
    },
    include: { units: true },
  });

  return candidates.filter((d) => {
    if (!isInForce(d, now)) return false;
    // No explicit unit list means the quantity or date bound governs, and the
    // authorisation covers any unit of the part it names.
    if (d.units.length === 0) return true;
    return d.units.some(
      (u) =>
        (serial && u.serial && u.serial.toLowerCase() === serial.toLowerCase()) ||
        (lotNumber &&
          u.lotNumber &&
          u.lotNumber.toLowerCase() === lotNumber.toLowerCase())
    );
  });
}

export async function getDeviationSummary() {
  const rows = await prisma.deviation.findMany({
    select: {
      status: true,
      kind: true,
      quantityLimit: true,
      quantityUsed: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
  const now = new Date();
  let inForce = 0;
  let expired = 0;
  let awaiting = 0;
  for (const r of rows) {
    const state = forceState(r, now);
    if (state === "IN_FORCE") inForce++;
    else if (state === "EXPIRED" || state === "EXHAUSTED") expired++;
    if (
      r.status === "SUBMITTED" ||
      r.status === "INTERNAL_APPROVED" ||
      r.status === "CUSTOMER_SUBMITTED"
    ) {
      awaiting++;
    }
  }
  return {
    total: rows.length,
    inForce,
    /** Approved but no longer usable — the ones people still cite by habit. */
    lapsed: expired,
    awaiting,
    deviations: rows.filter((r) => r.kind === "DEVIATION").length,
    waivers: rows.filter((r) => r.kind === "WAIVER").length,
  };
}
