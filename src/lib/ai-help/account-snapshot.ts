/**
 * Read-only, tenant-scoped counts for Carina.
 * Uses the request's Prisma tenant schema and the same view-permission
 * checks as the rest of the ERP. Never writes, never crosses tenants,
 * and never invents a number when a query fails or is denied.
 */
import { getCurrentUser, userCanView } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findKanbanShortages } from "@/lib/services/kanban-replenishment";

const CLOSED_WO = ["COMPLETED", "CANCELLED", "CLOSED"];
const OPEN_SO = ["OPEN", "PLANNED", "IN_PRODUCTION", "READY_TO_SHIP"];
const OPEN_PO = ["APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"];
const OPEN_NCR = ["OPEN", "UNDER_REVIEW", "MRB"];

export type SnapshotCounts = {
  allowed: true;
  total: number;
  byStatus: Record<string, number>;
  assignedToYou?: number;
  samples: { number: string; status: string }[];
};

export type SnapshotDenied = { allowed: false; reason: string };

export type LowStockCounts = {
  allowed: true;
  count: number;
  samples: { part: string; available: number; min: number }[];
};

export type AccountSnapshot = {
  signedIn: boolean;
  workOrders?: SnapshotCounts | SnapshotDenied;
  salesOrders?: SnapshotCounts | SnapshotDenied;
  purchaseOrders?: SnapshotCounts | SnapshotDenied;
  ncrs?: SnapshotCounts | SnapshotDenied;
  lowStock?: LowStockCounts | SnapshotDenied;
};

/** True for account-data questions (counts/lists), not how-to or mutations. */
export function wantsAccountSnapshot(question: string): boolean {
  const t = question.toLowerCase();
  if (
    /\b(can i|should i|do i need|how do i|how do we|how to|create|finish|approve|sign|delete|complete|release)\b/.test(
      t
    ) &&
    !/\bdo (i|we) have\b/.test(t)
  ) {
    return false;
  }
  if (/\b(show me how|walk me through|steps to)\b/.test(t)) return false;
  const topic =
    /\b(work orders?|\bwos?\b|sales orders?|\bsos?\b|purchase orders?|\bpos?\b|ncrs?|non[ -]?conformances?|low[ -]?stock|reorder point|inventory|stock levels?)\b/.test(
      t
    );
  const intent =
    /\b(how many|how much|count|number of|list|do i have|do we have|open|outstanding|current)\b/.test(
      t
    );
  return topic && intent;
}

function asked(question: string, re: RegExp) {
  return re.test(question.toLowerCase());
}

function byStatusFromGroup(
  rows: { status: string; _count: number }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count;
  return out;
}

async function denyOr<T>(
  userId: string,
  module: string,
  label: string,
  load: () => Promise<T>
): Promise<T | SnapshotDenied> {
  const ok = await userCanView(userId, module);
  if (!ok) {
    return {
      allowed: false,
      reason: `You don’t have permission to view ${label} in this workspace.`,
    };
  }
  return load();
}

export async function loadAccountSnapshot(
  question: string,
  userId?: string
): Promise<AccountSnapshot> {
  const user = userId
    ? { id: userId }
    : await getCurrentUser();
  if (!user?.id) return { signedIn: false };

  const q = question.toLowerCase();
  const mentionWo = asked(q, /\b(work orders?|\bwos?\b)\b/);
  const mentionSo = asked(q, /\b(sales orders?|\bsos?\b)\b/);
  const mentionPo = asked(q, /\b(purchase orders?|\bpos?\b)\b/);
  const mentionNcr = asked(q, /\b(ncrs?|non[ -]?conformances?)\b/);
  const mentionStock = asked(
    q,
    /\b(low[ -]?stock|reorder point|inventory|stock levels?)\b/
  );
  const anyTopic =
    mentionWo || mentionSo || mentionPo || mentionNcr || mentionStock;
  // Bare "how many open … do I have" with work orders implied: default to WOs.
  const loadWo = mentionWo || !anyTopic;

  const snap: AccountSnapshot = { signedIn: true };

  if (loadWo) {
    snap.workOrders = await denyOr(user.id, "work-orders", "work orders", async () => {
      const [grouped, assignedToYou, samples] = await Promise.all([
        prisma.workOrder.groupBy({
          by: ["status"],
          where: { status: { notIn: CLOSED_WO } },
          _count: true,
        }),
        prisma.workOrder.count({
          where: {
            status: { notIn: CLOSED_WO },
            assigneeId: user.id,
          },
        }),
        prisma.workOrder.findMany({
          where: { status: { notIn: CLOSED_WO } },
          select: { number: true, status: true },
          orderBy: [{ dueDate: "asc" }, { number: "asc" }],
          take: 8,
        }),
      ]);
      const byStatus = byStatusFromGroup(grouped);
      const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
      return { allowed: true as const, total, byStatus, assignedToYou, samples };
    });
  }

  if (mentionSo) {
    snap.salesOrders = await denyOr(user.id, "sales", "sales orders", async () => {
      const [grouped, samples] = await Promise.all([
        prisma.salesOrder.groupBy({
          by: ["status"],
          where: { status: { in: OPEN_SO } },
          _count: true,
        }),
        prisma.salesOrder.findMany({
          where: { status: { in: OPEN_SO } },
          select: { number: true, status: true },
          orderBy: [{ requiredDate: "asc" }, { number: "asc" }],
          take: 8,
        }),
      ]);
      const byStatus = byStatusFromGroup(grouped);
      const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
      return { allowed: true as const, total, byStatus, samples };
    });
  }

  if (mentionPo) {
    snap.purchaseOrders = await denyOr(
      user.id,
      "purchasing",
      "purchase orders",
      async () => {
        const [grouped, samples] = await Promise.all([
          prisma.purchaseOrder.groupBy({
            by: ["status"],
            where: { status: { in: OPEN_PO } },
            _count: true,
          }),
          prisma.purchaseOrder.findMany({
            where: { status: { in: OPEN_PO } },
            select: { number: true, status: true },
            orderBy: [{ promisedDate: "asc" }, { number: "asc" }],
            take: 8,
          }),
        ]);
        const byStatus = byStatusFromGroup(grouped);
        const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
        return { allowed: true as const, total, byStatus, samples };
      }
    );
  }

  if (mentionNcr) {
    snap.ncrs = await denyOr(user.id, "quality", "NCRs", async () => {
      const [grouped, samples] = await Promise.all([
        prisma.nonConformance.groupBy({
          by: ["status"],
          where: { status: { in: OPEN_NCR } },
          _count: true,
        }),
        prisma.nonConformance.findMany({
          where: { status: { in: OPEN_NCR } },
          select: { number: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
      ]);
      const byStatus = byStatusFromGroup(grouped);
      const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
      return { allowed: true as const, total, byStatus, samples };
    });
  }

  if (mentionStock) {
    snap.lowStock = await denyOr(user.id, "inventory", "inventory", async () => {
      const [kanban, lowAvailable] = await Promise.all([
        findKanbanShortages(),
        prisma.inventoryItem.findMany({
          where: { quantityAvailable: { gt: 0, lte: 5 } },
          select: {
            id: true,
            quantityAvailable: true,
            part: { select: { number: true, minStock: true, isKanban: true } },
          },
          take: 200,
        }),
      ]);
      const seen = new Set<string>();
      const samples: { part: string; available: number; min: number }[] = [];
      for (const k of kanban) {
        const key = `${k.partNumber}:${k.available}`;
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push({ part: k.partNumber, available: k.available, min: k.minStock });
      }
      for (const row of lowAvailable) {
        if (row.part.isKanban && row.part.minStock > 0) continue;
        const key = `${row.part.number}:${row.quantityAvailable}`;
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push({
          part: row.part.number,
          available: row.quantityAvailable,
          min: row.part.minStock || 5,
        });
      }
      return {
        allowed: true as const,
        count: samples.length,
        samples: samples.slice(0, 8),
      };
    });
  }

  return snap;
}

function statusList(byStatus: Record<string, number>): string {
  return Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s.replace(/_/g, " ")} ${n}`)
    .join(", ");
}

function sampleList(samples: { number: string; status: string }[]): string {
  if (!samples.length) return "";
  return ` Examples: ${samples
    .map((s) => `${s.number} (${s.status.replace(/_/g, " ")})`)
    .join(", ")}.`;
}

function formatCounts(label: string, c: SnapshotCounts | SnapshotDenied): string {
  if (!c.allowed) return c.reason;
  if (c.total === 0) return `There are 0 open ${label}.`;
  const assigned =
    typeof c.assignedToYou === "number"
      ? ` ${c.assignedToYou} assigned to you.`
      : "";
  return `There are ${c.total} open ${label}${
    Object.keys(c.byStatus).length ? `, by status: ${statusList(c.byStatus)}` : ""
  }.${assigned}${sampleList(c.samples)}`;
}

export function formatAccountSnapshotReply(
  question: string,
  snap: AccountSnapshot
): string {
  const disclose =
    "I’m Carina, Protessera’s AI help assistant. These are read-only counts from your current workspace; I can make mistakes, and I haven’t changed any records.";
  if (!snap.signedIn) {
    return `I can only look up account counts when you’re signed in. Sign in, then ask again, or open the relevant module. ${disclose}`;
  }
  const parts: string[] = [];
  if (snap.workOrders) parts.push(formatCounts("work orders", snap.workOrders));
  if (snap.salesOrders) parts.push(formatCounts("sales orders", snap.salesOrders));
  if (snap.purchaseOrders)
    parts.push(formatCounts("purchase orders", snap.purchaseOrders));
  if (snap.ncrs) parts.push(formatCounts("NCRs", snap.ncrs));
  if (snap.lowStock) {
    if (!snap.lowStock.allowed) parts.push(snap.lowStock.reason);
    else if (snap.lowStock.count === 0) {
      parts.push("There are 0 low-stock inventory rows using the Inventory screen rule (kanban at or below min stock, or available quantity of 5 or less).");
    } else {
      const ex = snap.lowStock.samples
        .map((s) => `${s.part} (available ${s.available}, min ${s.min})`)
        .join(", ");
      parts.push(
        `There are ${snap.lowStock.count} low-stock inventory rows using the Inventory screen rule (kanban at or below min stock, or available quantity of 5 or less).${ex ? ` Examples: ${ex}.` : ""}`
      );
    }
  }
  if (!parts.length) {
    return `I couldn’t match that to a count I can look up. I can report permission-checked counts of open work orders, sales orders, purchase orders, NCRs, and low-stock items. I won’t invent a number. ${disclose}`;
  }
  return `${parts.join(" ")} ${disclose}`;
}

export const ACCOUNT_SNAPSHOT_UNAVAILABLE =
  "I couldn’t load those counts right now, so I won’t invent a number. Open the authorized module, or use the Support tab for a human. I’m Carina, an AI assistant, and I haven’t changed any records.";
