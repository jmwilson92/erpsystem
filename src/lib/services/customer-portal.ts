/**
 * Customer order portal.
 *
 * Shows a customer their own open orders and how far along each one is.
 *
 * Two things govern the design.
 *
 * First, the view is deliberately narrow. A customer sees quantities, dates,
 * stage and hold state — never cost, margin, internal notes, supplier names,
 * nonconformance detail, or anything belonging to another customer. Every
 * query is scoped by the customer resolved from the token and selects a
 * whitelist of fields rather than whole rows, so a column added to SalesOrder
 * later cannot quietly become customer-visible.
 *
 * Second, the progress number does not guess. It would be easy to invent
 * weights — "kitted is 30%" — and produce a satisfying bar that means nothing.
 * Instead two real ratios are reported: how much has been built, and how much
 * has shipped, both straight quantity over quantity. A stage label carries the
 * qualitative part. A customer chasing a late order is the least good audience
 * for a number that was made up.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const DEFAULT_TOKEN_DAYS = 365;

export type HoldKind = "MATERIAL" | "QUALITY" | "CREDIT" | "NONE";

export const HOLD_LABELS: Record<HoldKind, string> = {
  MATERIAL: "Waiting on material",
  QUALITY: "On quality hold",
  CREDIT: "Awaiting deposit",
  NONE: "",
};

/**
 * Customer-facing stage. Coarser than the internal work order status on
 * purpose — a customer does not need to know the difference between
 * READY_TO_KIT and KITTING, and publishing internal state machine names
 * invites questions the portal cannot answer.
 */
export type Stage =
  | "ORDERED"
  | "IN_PRODUCTION"
  | "BUILT"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED";

export const STAGE_LABELS: Record<Stage, string> = {
  ORDERED: "Order accepted",
  IN_PRODUCTION: "In production",
  BUILT: "Built, awaiting shipment",
  PARTIALLY_SHIPPED: "Partially shipped",
  SHIPPED: "Shipped",
};

export type LineProgressInput = {
  quantity: number;
  quantityShipped: number;
  /** Summed across the line's work orders. */
  quantityBuilt: number;
  workOrderStatuses?: string[];
  hasOpenQualityIssue?: boolean;
  creditHold?: boolean;
};

export type LineProgress = {
  builtPct: number;
  shippedPct: number;
  stage: Stage;
  hold: HoldKind;
  isComplete: boolean;
};

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

/**
 * Derive progress for one order line.
 *
 * Built and shipped are separate ratios rather than one blended score. Built
 * is floored at shipped: you cannot ship what was never built, so a line that
 * shipped from finished stock without a work order still reads as fully built
 * instead of showing 0% built and 100% shipped, which looks like a bug to the
 * person reading it.
 */
export function lineProgress(input: LineProgressInput): LineProgress {
  const qty = input.quantity > 0 ? input.quantity : 0;
  const shipped = Math.max(0, input.quantityShipped);
  const built = Math.max(0, input.quantityBuilt);

  const shippedPct = qty ? clampPct((shipped / qty) * 100) : 0;
  const builtPct = qty ? Math.max(clampPct((built / qty) * 100), shippedPct) : 0;

  const statuses = input.workOrderStatuses || [];
  const anyInProgress = statuses.some((s) =>
    ["RELEASED", "IN_PROGRESS", "KITTING", "KITTED", "READY_TO_KIT"].includes(s)
  );

  let stage: Stage;
  if (shippedPct >= 100) stage = "SHIPPED";
  else if (shippedPct > 0) stage = "PARTIALLY_SHIPPED";
  else if (builtPct >= 100) stage = "BUILT";
  else if (builtPct > 0 || anyInProgress) stage = "IN_PRODUCTION";
  else stage = "ORDERED";

  // A shipped line is finished, so a stale internal hold must not resurface
  // on it — the customer would be told their delivered order is blocked.
  let hold: HoldKind = "NONE";
  if (stage !== "SHIPPED") {
    if (input.creditHold) hold = "CREDIT";
    else if (input.hasOpenQualityIssue) hold = "QUALITY";
    else if (statuses.includes("WAITING_MATERIAL")) hold = "MATERIAL";
  }

  return {
    builtPct,
    shippedPct,
    stage,
    hold,
    isComplete: shippedPct >= 100,
  };
}

/** Roll line progress up to an order, weighted by quantity, not by line count. */
export function orderProgress(lines: (LineProgress & { quantity: number })[]) {
  const totalQty = lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  if (totalQty === 0) {
    return { builtPct: 0, shippedPct: 0, hold: "NONE" as HoldKind, isComplete: false };
  }
  const weighted = (pick: (l: (typeof lines)[number]) => number) =>
    lines.reduce((s, l) => s + pick(l) * Math.max(0, l.quantity), 0) / totalQty;

  // A single blocked line blocks the order, and credit outranks the rest
  // because nothing moves until it clears.
  const holds = lines.map((l) => l.hold).filter((h) => h !== "NONE");
  const hold: HoldKind = holds.includes("CREDIT")
    ? "CREDIT"
    : holds.includes("QUALITY")
      ? "QUALITY"
      : holds.includes("MATERIAL")
        ? "MATERIAL"
        : "NONE";

  return {
    builtPct: clampPct(weighted((l) => l.builtPct)),
    shippedPct: clampPct(weighted((l) => l.shippedPct)),
    hold,
    isComplete: lines.every((l) => l.isComplete),
  };
}

/** Days late relative to the required date; negative means still in hand. */
export function daysLate(required: Date | null | undefined, now = new Date()) {
  if (!required) return null;
  const ms = 86400000;
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(
    required.getUTCFullYear(),
    required.getUTCMonth(),
    required.getUTCDate()
  );
  return Math.round((a - b) / ms);
}

// ---------------------------------------------------------------- tokens

export async function issueToken(input: {
  customerId: string;
  label?: string | null;
  days?: number;
}) {
  const token = randomBytes(32).toString("hex");
  const record = await prisma.customerPortalToken.create({
    data: {
      tokenHash: sha256(token),
      customerId: input.customerId,
      label: (input.label || "").trim() || null,
      expiresAt: new Date(Date.now() + (input.days ?? DEFAULT_TOKEN_DAYS) * 86400000),
    },
  });
  return { token, record };
}

export async function revokeToken(id: string) {
  return prisma.customerPortalToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function listTokens() {
  return prisma.customerPortalToken.findMany({
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { id: true, name: true } } },
  });
}

export type TokenCheck =
  | { ok: true; customerId: string; tokenId: string }
  | { ok: false };

export async function resolveToken(raw: string): Promise<TokenCheck> {
  const token = (raw || "").trim();
  if (!token) return { ok: false };
  const row = await prisma.customerPortalToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, customerId: true, expiresAt: true, revokedAt: true },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    return { ok: false };
  }
  return { ok: true, customerId: row.customerId, tokenId: row.id };
}

// ---------------------------------------------------------------- dashboard

/**
 * Everything the portal shows, for one customer.
 *
 * Field selection is explicit throughout. Pulling whole SalesOrder rows would
 * hand the customer totalAmount, deposit state, internal department and any
 * column added later.
 */
export async function portalDashboard(rawToken: string) {
  const check = await resolveToken(rawToken);
  if (!check.ok) return null;

  await prisma.customerPortalToken
    .update({ where: { id: check.tokenId }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const customer = await prisma.customer.findUnique({
    where: { id: check.customerId },
    select: { id: true, name: true },
  });
  if (!customer) return null;

  const orders = await prisma.salesOrder.findMany({
    where: {
      customerId: check.customerId,
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: { orderDate: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      requiredDate: true,
      shipDate: true,
      customerPo: true,
      depositRequired: true,
      depositStatus: true,
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          description: true,
          quantity: true,
          quantityShipped: true,
          fulfillmentStatus: true,
          part: { select: { partNumber: true } },
          workOrders: {
            select: {
              id: true,
              number: true,
              status: true,
              quantity: true,
              quantityCompleted: true,
            },
          },
        },
      },
    },
  });

  // One query for quality issues across every work order in view, rather than
  // one per line.
  const workOrderIds = orders.flatMap((o) =>
    o.lines.flatMap((l) => l.workOrders.map((w) => w.id))
  );
  const flagged = workOrderIds.length
    ? await prisma.nonConformance.findMany({
        where: {
          workOrderId: { in: workOrderIds },
          status: { notIn: ["CLOSED"] },
        },
        select: { workOrderId: true },
      })
    : [];
  const flaggedWos = new Set(flagged.map((f) => f.workOrderId).filter(Boolean));

  const decorated = orders.map((o) => {
    const creditHold = o.depositRequired && o.depositStatus === "PENDING";

    const lines = o.lines.map((l, index) => {
      const built = l.workOrders.reduce(
        (s, w) => s + (w.quantityCompleted || 0),
        0
      );
      const progress = lineProgress({
        quantity: l.quantity,
        quantityShipped: l.quantityShipped,
        quantityBuilt: built,
        workOrderStatuses: l.workOrders.map((w) => w.status),
        hasOpenQualityIssue: l.workOrders.some((w) => flaggedWos.has(w.id)),
        creditHold,
      });
      return {
        id: l.id,
        // SalesOrderLine carries no line number, so position stands in for one.
        lineNumber: index + 1,
        description: l.description,
        partNumber: l.part?.partNumber || null,
        quantity: l.quantity,
        quantityShipped: l.quantityShipped,
        quantityBuilt: built,
        ...progress,
      };
    });

    const rollup = orderProgress(lines);
    return {
      id: o.id,
      number: o.number,
      customerPo: o.customerPo,
      orderDate: o.orderDate,
      requiredDate: o.requiredDate,
      shipDate: o.shipDate,
      lines,
      ...rollup,
      lateDays: rollup.isComplete ? null : daysLate(o.requiredDate),
    };
  });

  const open = decorated.filter((o) => !o.isComplete);

  return {
    customer,
    orders: decorated,
    summary: {
      openOrders: open.length,
      totalOrders: decorated.length,
      onHold: open.filter((o) => o.hold !== "NONE").length,
      late: open.filter((o) => (o.lateDays ?? 0) > 0).length,
      unitsOpen: open.reduce(
        (s, o) =>
          s + o.lines.reduce((t, l) => t + Math.max(0, l.quantity - l.quantityShipped), 0),
        0
      ),
    },
  };
}
