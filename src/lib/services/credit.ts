import { prisma } from "@/lib/db";

export type CreditSnapshot = {
  creditLimit: number;
  /** Open AR balance (invoice total − amount paid for OPEN/PARTIAL) */
  arBalance: number;
  /** Open sales order backlog not yet shipped/closed */
  openSoBalance: number;
  /** AR + open SO exposure */
  exposure: number;
  availableCredit: number;
  isOverLimit: boolean;
  /** creditLimit is 0 → no limit enforced */
  hasLimit: boolean;
  utilizationPct: number;
};

const OPEN_SO_STATUSES = [
  "OPEN",
  "PLANNED",
  "IN_PRODUCTION",
  "READY_TO_SHIP",
];

/**
 * Compute customer credit exposure from open AR + open sales orders.
 * creditLimit <= 0 means no limit is enforced.
 */
export async function getCustomerCreditSnapshot(
  customerId: string,
  options?: { excludeSalesOrderId?: string }
): Promise<CreditSnapshot> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { creditLimit: true },
  });
  if (!customer) throw new Error("Customer not found");

  const [invoices, openOrders] = await Promise.all([
    prisma.arInvoice.findMany({
      where: {
        customerId,
        status: { in: ["OPEN", "PARTIAL"] },
      },
      select: { total: true, amountPaid: true },
    }),
    prisma.salesOrder.findMany({
      where: {
        customerId,
        status: { in: OPEN_SO_STATUSES },
        ...(options?.excludeSalesOrderId
          ? { id: { not: options.excludeSalesOrderId } }
          : {}),
      },
      select: { totalAmount: true },
    }),
  ]);

  const arBalance = invoices.reduce(
    (s, inv) => s + Math.max(0, inv.total - inv.amountPaid),
    0
  );
  const openSoBalance = openOrders.reduce((s, o) => s + o.totalAmount, 0);
  const exposure = arBalance + openSoBalance;
  const creditLimit = customer.creditLimit ?? 0;
  const hasLimit = creditLimit > 0;
  const availableCredit = hasLimit ? Math.max(0, creditLimit - exposure) : Infinity;
  const isOverLimit = hasLimit && exposure >= creditLimit;
  const utilizationPct = hasLimit
    ? Math.round((exposure / creditLimit) * 1000) / 10
    : 0;

  return {
    creditLimit,
    arBalance,
    openSoBalance,
    exposure,
    availableCredit: hasLimit ? availableCredit : 0,
    isOverLimit,
    hasLimit,
    utilizationPct,
  };
}

/**
 * If the new order would push exposure over the credit limit, require a deposit.
 * Deposit amount = the amount of this order that exceeds available credit
 * (or the full order total if already over limit / no remaining credit).
 */
export function evaluateDepositRequirement(
  snapshot: CreditSnapshot,
  orderTotal: number
): {
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: string;
  creditHold: boolean;
  overBy: number;
} {
  if (!snapshot.hasLimit || orderTotal <= 0) {
    return {
      depositRequired: false,
      depositAmount: 0,
      depositStatus: "N_A",
      creditHold: false,
      overBy: 0,
    };
  }

  const projected = snapshot.exposure + orderTotal;
  const overBy = Math.max(0, projected - snapshot.creditLimit);
  if (overBy <= 0) {
    return {
      depositRequired: false,
      depositAmount: 0,
      depositStatus: "N_A",
      creditHold: false,
      overBy: 0,
    };
  }

  // Require deposit covering the over-limit portion (capped at order total)
  const depositAmount = Math.min(orderTotal, Math.round(overBy * 100) / 100);
  return {
    depositRequired: true,
    depositAmount,
    depositStatus: "PENDING",
    creditHold: true,
    overBy,
  };
}
