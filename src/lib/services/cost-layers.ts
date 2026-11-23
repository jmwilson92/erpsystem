/**
 * Inventory costing methods: STANDARD, moving weighted AVERAGE, FIFO, and LIFO.
 *
 * FIFO/LIFO keep additive InventoryCostLayer rows (quantityRemaining is
 * zeroed, never deleted). AVERAGE recomputes Part.averageCost on receipt
 * only. STANDARD relieves at standard and keeps purchase-price variance.
 *
 * Method-change policy: the costing method may be changed only at a quiet
 * period boundary — the current open period must have no posted inventory,
 * COGS, WIP, scrap, or RMA stock journals, and no material transactions
 * dated in the period. Mid-period changes are blocked. On a permitted
 * change, opening layers are seeded from on-hand quantity at the recorded
 * book unit cost so the GL inventory balance does not jump when switching
 * among AVERAGE/FIFO/LIFO or off STANDARD. Switching TO STANDARD posts a
 * revaluation journal (inventory vs 6222 Inventory revaluation) when book
 * value differs from standard × quantity, so the standard subledger ties
 * to the GL. LIFO is not permitted under IFRS.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { postJournal } from "@/lib/services/gaap";
import { roundMoney } from "@/lib/services/posting-rules";

type Db = Prisma.TransactionClient | typeof prisma;

const money = roundMoney;

export const COSTING_METHODS = ["STANDARD", "AVERAGE", "FIFO", "LIFO"] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

export function normalizeCostingMethod(raw: string | null | undefined): CostingMethod {
  const method = (raw || "STANDARD").toUpperCase();
  if (method === "AVERAGE" || method === "ACTUAL") return "AVERAGE";
  if (method === "FIFO") return "FIFO";
  if (method === "LIFO") return "LIFO";
  return "STANDARD";
}

export function usesCostLayers(method: string | null | undefined): boolean {
  const normalized = normalizeCostingMethod(method);
  return normalized === "FIFO" || normalized === "LIFO";
}

function isCompanyOwned(ownership: string | null | undefined): boolean {
  const value = (ownership || "COMPANY").toUpperCase();
  return value === "COMPANY";
}

export async function currentCostingMethod(db: Db = prisma): Promise<CostingMethod> {
  const row = await db.accountingSettings.findUnique({ where: { id: "default" } });
  return normalizeCostingMethod(row?.costingMethod);
}

async function loadMethod(db: Db): Promise<CostingMethod> {
  return currentCostingMethod(db);
}


async function syncBinCostFromLayers(db: Db, partId: string, locationId: string) {
  const layers = await db.inventoryCostLayer.findMany({
    where: { partId, locationId, quantityRemaining: { gt: 0 } },
    select: { quantityRemaining: true, unitCost: true },
  });
  const qty = layers.reduce((sum, row) => sum + (row.quantityRemaining || 0), 0);
  if (qty <= 0.0000001) return;
  const value = layers.reduce((sum, row) => sum + row.quantityRemaining * row.unitCost, 0);
  const unit = money(value / qty);
  await db.inventoryItem.updateMany({
    where: { partId, locationId, ownership: "COMPANY" },
    data: { unitCost: unit },
  });
}

export async function recordInboundCost(params: {
  partId: string;
  locationId: string;
  inventoryItemId?: string | null;
  quantity: number;
  unitCost: number;
  sourceType: string;
  sourceId?: string | null;
  materialTransactionId?: string | null;
  journalEntryId?: string | null;
  ownership?: string | null;
  receivedAt?: Date;
  db?: Db;
}): Promise<void> {
  const db = params.db || prisma;
  const quantity = Number(params.quantity) || 0;
  const unitCost = money(Number(params.unitCost) || 0);
  if (quantity <= 0.0000001) return;
  if (!isCompanyOwned(params.ownership)) return;

  const method = await loadMethod(db);
  if (method === "AVERAGE") {
    await recomputeMovingAverage(db, params.partId, quantity, unitCost);
    return;
  }
  if (method !== "FIFO" && method !== "LIFO") {
    await maybeTouchLastBuy(db, params.partId, unitCost);
    return;
  }

  await db.inventoryCostLayer.create({
    data: {
      partId: params.partId,
      locationId: params.locationId,
      inventoryItemId: params.inventoryItemId || null,
      quantityOriginal: quantity,
      quantityRemaining: quantity,
      unitCost,
      sourceType: params.sourceType,
      sourceId: params.sourceId || null,
      materialTransactionId: params.materialTransactionId || null,
      journalEntryId: params.journalEntryId || null,
      receivedAt: params.receivedAt || new Date(),
    },
  });
  await syncBinCostFromLayers(db, params.partId, params.locationId);
  await maybeTouchLastBuy(db, params.partId, unitCost);
}

async function maybeTouchLastBuy(db: Db, partId: string, unitCost: number) {
  if (unitCost <= 0) return;
  await db.part.update({
    where: { id: partId },
    data: { lastBuyCost: unitCost },
  });
}

/**
 * Moving weighted average is recomputed on receipt (or any inbound) only.
 * Issues do not change the average. newAvg = (oldQty×oldAvg + recQty×recCost) / (oldQty+recQty).
 * The inbound quantity is assumed to already be on the inventory rows.
 */
async function recomputeMovingAverage(
  db: Db,
  partId: string,
  inboundQty: number,
  inboundUnitCost: number
) {
  const part = await db.part.findUnique({ where: { id: partId } });
  if (!part) return;
  const items = await db.inventoryItem.findMany({
    where: { partId, ownership: "COMPANY" },
    select: { id: true, quantityOnHand: true },
  });
  const totalQty = items.reduce((sum, row) => sum + (row.quantityOnHand || 0), 0);
  const previousQty = Math.max(0, totalQty - inboundQty);
  const previousAvg = part.averageCost || 0;
  const denominator = previousQty + inboundQty;
  const nextAvg =
    denominator > 0.0000001
      ? money((previousQty * previousAvg + inboundQty * inboundUnitCost) / denominator)
      : money(inboundUnitCost);
  await db.part.update({
    where: { id: partId },
    data: { averageCost: nextAvg, lastBuyCost: inboundUnitCost > 0 ? inboundUnitCost : part.lastBuyCost },
  });
  if (items.length) {
    await db.inventoryItem.updateMany({
      where: { partId, ownership: "COMPANY" },
      data: { unitCost: nextAvg },
    });
  }
}

export type ConsumeResult = {
  amount: number;
  unitCost: number;
  quantity: number;
  layers: { layerId: string; quantity: number; unitCost: number; amount: number }[];
};

/**
 * Consume cost for an outbound movement. FIFO peels oldest remaining layers
 * first; LIFO peels newest first. AVERAGE uses the current moving average.
 * STANDARD uses the caller-supplied fallback (typically standard or bin cost).
 */
export async function consumeOutboundCost(params: {
  partId: string;
  locationId: string;
  inventoryItemId?: string | null;
  quantity: number;
  fallbackUnitCost?: number;
  materialTransactionId?: string | null;
  journalEntryId?: string | null;
  ownership?: string | null;
  db?: Db;
  /** When set, skips a settings lookup (use inside a tight transaction). */
  costingMethod?: string | null;
}): Promise<ConsumeResult> {
  const db = params.db || prisma;
  const quantity = Number(params.quantity) || 0;
  if (quantity <= 0.0000001) {
    return { amount: 0, unitCost: 0, quantity: 0, layers: [] };
  }
  if (!isCompanyOwned(params.ownership)) {
    return { amount: 0, unitCost: 0, quantity, layers: [] };
  }

  const method = normalizeCostingMethod(params.costingMethod ?? (await loadMethod(db)));
  if (method === "STANDARD") {
    const unitCost = money(params.fallbackUnitCost || 0);
    return { amount: money(unitCost * quantity), unitCost, quantity, layers: [] };
  }
  if (method === "AVERAGE") {
    const part = await db.part.findUnique({ where: { id: params.partId } });
    const unitCost = money(
      (part?.averageCost || 0) > 0 ? part!.averageCost : params.fallbackUnitCost || 0
    );
    return { amount: money(unitCost * quantity), unitCost, quantity, layers: [] };
  }

  await ensureImplicitOpeningLayer(db, params);
  const order = method === "LIFO" ? ("desc" as const) : ("asc" as const);
  const local = await db.inventoryCostLayer.findMany({
    where: { partId: params.partId, locationId: params.locationId, quantityRemaining: { gt: 0 } },
    orderBy: [{ receivedAt: order }, { createdAt: order }, { id: order }],
  });
  const take = await peelLayers(db, local, quantity, params);
  let remaining = money(quantity - take.quantity);
  if (remaining > 0.0001) {
    const others = await db.inventoryCostLayer.findMany({
      where: {
        partId: params.partId,
        quantityRemaining: { gt: 0 },
        locationId: { not: params.locationId },
      },
      orderBy: [{ receivedAt: order }, { createdAt: order }, { id: order }],
    });
    const extra = await peelLayers(db, others, remaining, params);
    take.amount = money(take.amount + extra.amount);
    take.quantity = money(take.quantity + extra.quantity);
    take.layers.push(...extra.layers);
    remaining = money(quantity - take.quantity);
  }
  if (remaining > 0.0001) {
    const fallback = money(params.fallbackUnitCost || 0);
    if (fallback <= 0) {
      throw new Error(
        `Insufficient cost layers to relieve ${quantity} of part ${params.partId} at this location. Remaining short: ${remaining}.`
      );
    }
    // Last-resort: post the shortfall at the recorded bin/standard cost so a
    // movement is never silently under-valued, and record a synthetic layer consume.
    const amount = money(fallback * remaining);
    take.amount = money(take.amount + amount);
    take.quantity = money(take.quantity + remaining);
    take.layers.push({ layerId: "", quantity: remaining, unitCost: fallback, amount });
  }
  const unitCost = take.quantity > 0 ? take.amount / take.quantity : 0;
  await syncBinCostFromLayers(db, params.partId, params.locationId);
  return { amount: take.amount, unitCost, quantity: take.quantity, layers: take.layers };
}

async function peelLayers(
  db: Db,
  layers: { id: string; quantityRemaining: number; unitCost: number }[],
  quantity: number,
  params: { materialTransactionId?: string | null; journalEntryId?: string | null }
): Promise<ConsumeResult> {
  let remaining = quantity;
  const used: ConsumeResult["layers"] = [];
  let amount = 0;
  for (const layer of layers) {
    if (remaining <= 0.0000001) break;
    const take = Math.min(layer.quantityRemaining, remaining);
    if (take <= 0) continue;
    const nextRemaining = money(layer.quantityRemaining - take);
    await db.inventoryCostLayer.update({
      where: { id: layer.id },
      data: { quantityRemaining: nextRemaining < 0.0000001 ? 0 : nextRemaining },
    });
    const lineAmount = money(take * layer.unitCost);
    await db.inventoryLayerConsumption.create({
      data: {
        layerId: layer.id,
        quantity: take,
        unitCost: layer.unitCost,
        amount: lineAmount,
        materialTransactionId: params.materialTransactionId || null,
        journalEntryId: params.journalEntryId || null,
      },
    });
    used.push({ layerId: layer.id, quantity: take, unitCost: layer.unitCost, amount: lineAmount });
    amount = money(amount + lineAmount);
    remaining = money(remaining - take);
  }
  return { amount, unitCost: 0, quantity: money(quantity - remaining), layers: used };
}

/**
 * Safety net for stock that exists without layers (legacy rows or a method
 * switch that missed a bin): seed an OPENING layer at the bin unit cost.
 */
async function ensureImplicitOpeningLayer(
  db: Db,
  params: {
    partId: string;
    locationId: string;
    inventoryItemId?: string | null;
    fallbackUnitCost?: number;
  }
) {
  const remaining = await db.inventoryCostLayer.aggregate({
    where: { partId: params.partId, locationId: params.locationId },
    _sum: { quantityRemaining: true },
  });
  const layerQty = remaining._sum.quantityRemaining || 0;
  const items = await db.inventoryItem.findMany({
    where: { partId: params.partId, locationId: params.locationId, ownership: "COMPANY" },
    select: { id: true, quantityOnHand: true, unitCost: true },
  });
  const onHand = items.reduce((sum, row) => sum + (row.quantityOnHand || 0), 0);
  const short = money(onHand - layerQty);
  if (short <= 0.0001) return;
  const unit =
    params.fallbackUnitCost ||
    items.find((row) => row.id === params.inventoryItemId)?.unitCost ||
    items[0]?.unitCost ||
    0;
  await db.inventoryCostLayer.create({
    data: {
      partId: params.partId,
      locationId: params.locationId,
      inventoryItemId: params.inventoryItemId || items[0]?.id || null,
      quantityOriginal: short,
      quantityRemaining: short,
      unitCost: money(unit),
      sourceType: "OPENING",
    },
  });
}

/** Move layers from one location to another without revaluing (putaway / transfer). */
export async function moveCostLayers(params: {
  partId: string;
  fromLocationId: string;
  toLocationId: string;
  inventoryItemId?: string | null;
  quantity: number;
  materialTransactionId?: string | null;
  ownership?: string | null;
  fallbackUnitCost?: number;
  db?: Db;
  costingMethod?: string | null;
}): Promise<void> {
  const db = params.db || prisma;
  if (!isCompanyOwned(params.ownership)) return;
  if (params.fromLocationId === params.toLocationId) return;
  const method = normalizeCostingMethod(params.costingMethod ?? (await loadMethod(db)));
  if (!usesCostLayers(method)) return;
  const consumed = await consumeOutboundCost({
    partId: params.partId,
    locationId: params.fromLocationId,
    inventoryItemId: params.inventoryItemId,
    quantity: params.quantity,
    fallbackUnitCost: params.fallbackUnitCost,
    materialTransactionId: params.materialTransactionId,
    ownership: params.ownership,
    db,
    costingMethod: method,
  });
  for (const layer of consumed.layers) {
    if (!layer.layerId && layer.quantity <= 0) continue;
    await db.inventoryCostLayer.create({
      data: {
        partId: params.partId,
        locationId: params.toLocationId,
        inventoryItemId: params.inventoryItemId || null,
        quantityOriginal: layer.quantity,
        quantityRemaining: layer.quantity,
        unitCost: layer.unitCost,
        sourceType: "TRANSFER",
        sourceId: params.materialTransactionId || null,
        materialTransactionId: params.materialTransactionId || null,
      },
    });
  }
  await syncBinCostFromLayers(db, params.partId, params.toLocationId);
  await syncBinCostFromLayers(db, params.partId, params.fromLocationId);
}

export async function linkConsumptionsToJournal(params: {
  materialTransactionId: string;
  journalEntryId: string;
  db?: Db;
}): Promise<void> {
  const db = params.db || prisma;
  await db.inventoryLayerConsumption.updateMany({
    where: { materialTransactionId: params.materialTransactionId, journalEntryId: null },
    data: { journalEntryId: params.journalEntryId },
  });
  await db.inventoryCostLayer.updateMany({
    where: { materialTransactionId: params.materialTransactionId, journalEntryId: null },
    data: { journalEntryId: params.journalEntryId },
  });
}

/** Remaining FIFO/LIFO layer value (company-owned inventory only). */
export async function layerValueByPartLocation(db: Db = prisma) {
  const layers = await db.inventoryCostLayer.findMany({
    where: { quantityRemaining: { gt: 0 } },
    include: {
      location: { select: { type: true, code: true } },
      inventoryItem: { select: { workOrderId: true, quantityQuarantine: true, ownership: true } },
      part: {
        select: {
          partNumber: true,
          inventoryAccountId: true,
          itemStructure: true,
          sourcingMethod: true,
        },
      },
    },
  });
  return layers.filter((row) => !row.inventoryItem || (row.inventoryItem.ownership !== "GOVERNMENT" && row.inventoryItem.ownership !== "CUSTOMER"));
}

const ACTIVITY_ACCOUNT_CODES = ["1200", "1210", "1220", "1230", "2010", "5000", "5100", "6210", "6222"];

export type PeriodWindow = { start: Date; end: Date; name: string; status?: string };

export async function currentPeriodWindow(db: Db = prisma, at: Date = new Date()): Promise<PeriodWindow> {
  const open = await db.accountingPeriod.findFirst({
    where: { status: "OPEN", startDate: { lte: at }, endDate: { gte: at } },
    orderBy: { startDate: "desc" },
  });
  if (open) {
    return { start: open.startDate, end: open.endDate, name: open.name, status: open.status };
  }
  const enclosing = await db.accountingPeriod.findFirst({
    where: { startDate: { lte: at }, endDate: { gte: at } },
    orderBy: { startDate: "desc" },
  });
  if (enclosing) {
    return {
      start: enclosing.startDate,
      end: enclosing.endDate,
      name: enclosing.name,
      status: enclosing.status,
    };
  }
  const start = new Date(at.getFullYear(), at.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(at.getFullYear(), at.getMonth() + 1, 0, 23, 59, 59, 999);
  const name = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
  return { start, end, name };
}

export async function periodHasCostingActivity(
  db: Db,
  window: PeriodWindow
): Promise<{ blocked: boolean; reason?: string }> {
  const accounts = await db.account.findMany({
    where: { code: { in: ACTIVITY_ACCOUNT_CODES } },
    select: { id: true, code: true },
  });
  const accountIds = accounts.map((row) => row.id);
  const journal = accountIds.length
    ? await db.journalEntry.findFirst({
        where: {
          status: "POSTED",
          date: { gte: window.start, lte: window.end },
          lines: { some: { accountId: { in: accountIds } } },
        },
        select: { id: true, number: true, description: true },
      })
    : null;
  if (journal) {
    return {
      blocked: true,
      reason: `The current period ${window.name} already has a posted inventory, COGS, WIP, scrap, or RMA stock journal (${journal.number || journal.id}). Change the costing method at a period boundary after this period is closed and a new empty period is open.`,
    };
  }
  const movement = await db.materialTransaction.findFirst({
    where: { createdAt: { gte: window.start, lte: window.end } },
    select: { id: true, type: true, reference: true },
  });
  if (movement) {
    return {
      blocked: true,
      reason: `The current period ${window.name} already has a material transaction (${movement.type}${movement.reference ? ` ${movement.reference}` : ""}). Change the costing method at a period boundary after this period is closed and a new empty period is open.`,
    };
  }
  return { blocked: false };
}

/**
 * Apply a costing method change at a quiet period boundary. Seeds opening
 * layers or posts a standard-cost revaluation journal as needed.
 */
export async function changeCostingMethod(params: {
  nextMethod: string;
  userId?: string | null;
  db?: Db;
}): Promise<{ previous: CostingMethod; next: CostingMethod; revalued: number; seededLayers: number }> {
  const db = params.db || prisma;
  const next = normalizeCostingMethod(params.nextMethod);
  const settings = await db.accountingSettings.upsert({
    where: { id: "default" },
    create: { id: "default", costingMethod: next },
    update: {},
  });
  const previous = normalizeCostingMethod(settings.costingMethod);
  if (previous === next) {
    return { previous, next, revalued: 0, seededLayers: 0 };
  }

  const window = await currentPeriodWindow(db);
  const activity = await periodHasCostingActivity(db, window);
  if (activity.blocked) {
    throw new Error(activity.reason);
  }

  let revalued = 0;
  if (next === "STANDARD") {
    revalued = await postStandardRevaluation(db, params.userId);
  }

  // Retire leftover layers so a later switch back onto FIFO/LIFO cannot
  // double-count, then seed opening layers at current book value.
  const leftover = await db.inventoryCostLayer.findMany({
    where: { quantityRemaining: { gt: 0 } },
    select: { id: true },
  });
  if (leftover.length) {
    await db.inventoryCostLayer.updateMany({
      where: { quantityRemaining: { gt: 0 } },
      data: { quantityRemaining: 0 },
    });
  }

  let seededLayers = 0;
  if (usesCostLayers(next)) {
    seededLayers = await seedOpeningLayers(db);
  }
  if (next === "AVERAGE") {
    await syncAverageFromOnHand(db);
  }

  await db.accountingSettings.upsert({
    where: { id: "default" },
    create: { id: "default", costingMethod: next },
    update: { costingMethod: next, updatedById: params.userId || undefined },
  });
  return { previous, next, revalued, seededLayers };
}

async function seedOpeningLayers(db: Db): Promise<number> {
  const items = await db.inventoryItem.findMany({
    where: { quantityOnHand: { gt: 0 }, ownership: "COMPANY" },
  });
  let count = 0;
  for (const item of items) {
    await db.inventoryCostLayer.create({
      data: {
        partId: item.partId,
        locationId: item.locationId,
        inventoryItemId: item.id,
        quantityOriginal: item.quantityOnHand,
        quantityRemaining: item.quantityOnHand,
        unitCost: money(item.unitCost || 0),
        sourceType: "OPENING",
      },
    });
    count += 1;
  }
  return count;
}

async function syncAverageFromOnHand(db: Db) {
  const items = await db.inventoryItem.findMany({
    where: { ownership: "COMPANY" },
    select: { partId: true, quantityOnHand: true, unitCost: true },
  });
  const byPart = new Map<string, { qty: number; value: number }>();
  for (const item of items) {
    const cur = byPart.get(item.partId) || { qty: 0, value: 0 };
    cur.qty += item.quantityOnHand || 0;
    cur.value += (item.quantityOnHand || 0) * (item.unitCost || 0);
    byPart.set(item.partId, cur);
  }
  for (const [partId, cur] of byPart) {
    const avg = cur.qty > 0.0000001 ? money(cur.value / cur.qty) : 0;
    await db.part.update({ where: { id: partId }, data: { averageCost: avg } });
    if (cur.qty > 0) {
      await db.inventoryItem.updateMany({
        where: { partId, ownership: "COMPANY" },
        data: { unitCost: avg },
      });
    }
  }
}

async function postStandardRevaluation(db: Db, userId?: string | null): Promise<number> {
  const { ensureAccountingDefaults } = await import("@/lib/services/gl-posting");
  await ensureAccountingDefaults();
  let reval = await db.account.findUnique({ where: { code: "6222" } });
  if (!reval) {
    reval = await db.account.create({
      data: { code: "6222", name: "Inventory revaluation", type: "EXPENSE" },
    });
  }
  await db.glAccountMap.upsert({
    where: { eventKey: "COSTING_REVAL" },
    create: {
      eventKey: "COSTING_REVAL",
      label: "Inventory revaluation on costing method change",
      debitCode: "6222",
      creditCode: "1200",
      notes: "Posted when switching to STANDARD if book value differs from standard × quantity. Sides swap when inventory increases.",
    },
    update: {},
  });
  const required = ["1200", "1210", "1220", "1230"] as const;
  const found = await db.account.findMany({ where: { code: { in: [...required] } } });
  const byCode = new Map(found.map((row) => [row.code, row]));
  const missing = required.filter((code) => !byCode.has(code));
  if (missing.length) {
    throw new Error(`Missing inventory accounts for revaluation: ${missing.join(", ")}`);
  }
  const rm = byCode.get("1200")!;
  const wip = byCode.get("1210")!;
  const fg = byCode.get("1220")!;
  const ri = byCode.get("1230")!;
  const items = await db.inventoryItem.findMany({
    where: { quantityOnHand: { not: 0 }, ownership: "COMPANY" },
    include: {
      location: { select: { type: true } },
      part: { select: { standardCost: true, itemStructure: true, sourcingMethod: true, inventoryAccountId: true } },
    },
  });
  const byAccount = new Map<string, { book: number; standard: number; accountId: string }>();
  for (const item of items) {
    const cls =
      item.workOrderId || item.location.type === "WIP" || item.location.type === "STAGING"
        ? "WIP"
        : item.location.type === "QUARANTINE" || item.quantityQuarantine > 0.0001
          ? "RI"
          : (item.part.itemStructure || "").toUpperCase() === "TOP_LEVEL_ASSEMBLY" ||
              (item.part.itemStructure || "").toUpperCase() === "SUB_ASSEMBLY"
            ? "FG"
            : "RM";
    const accountId =
      item.part.inventoryAccountId && cls !== "WIP" && cls !== "RI"
        ? item.part.inventoryAccountId
        : cls === "WIP"
          ? wip.id
          : cls === "FG"
            ? fg.id
            : cls === "RI"
              ? ri.id
              : rm.id;
    const cur = byAccount.get(accountId) || { book: 0, standard: 0, accountId };
    cur.book = money(cur.book + item.quantityOnHand * (item.unitCost || 0));
    cur.standard = money(cur.standard + item.quantityOnHand * (item.part.standardCost || 0));
    byAccount.set(accountId, cur);
    await db.inventoryItem.update({
      where: { id: item.id },
      data: { unitCost: money(item.part.standardCost || 0) },
    });
  }
  let total = 0;
  let lineNo = 0;
  for (const group of byAccount.values()) {
    const diff = money(group.standard - group.book);
    if (Math.abs(diff) <= 0.001) continue;
    total = money(total + diff);
    lineNo += 1;
    const inventoryIncreases = diff > 0;
    await postJournal({
      description: `Costing method change — revalue inventory to standard`,
      source: "GL",
      sourceId: `costing-reval:${group.accountId}`,
      idempotencyKey: `costing-reval:${group.accountId}:${Date.now()}:${lineNo}`,
      createdById: userId || undefined,
      status: "POSTED",
      lines: inventoryIncreases
        ? [
            { accountId: group.accountId, debit: Math.abs(diff) },
            { accountId: reval.id, credit: Math.abs(diff) },
          ]
        : [
            { accountId: reval.id, debit: Math.abs(diff) },
            { accountId: group.accountId, credit: Math.abs(diff) },
          ],
    }, db);
  }
  return total;
}

export async function shipmentCostFromTransactions(params: {
  salesOrderId: string;
  shipmentNumber?: string | null;
  partId: string;
  quantity: number;
  db?: Db;
}): Promise<number | null> {
  const db = params.db || prisma;
  const ships = await db.materialTransaction.findMany({
    where: {
      type: "SHIP",
      salesOrderId: params.salesOrderId,
      partId: params.partId,
      ...(params.shipmentNumber ? { reference: params.shipmentNumber } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { layerConsumptions: true },
  });
  if (!ships.length) return null;
  const consumed = ships.flatMap((row) => row.layerConsumptions);
  if (consumed.length) {
    const qty = consumed.reduce((sum, row) => sum + (row.quantity || 0), 0);
    const amount = consumed.reduce((sum, row) => sum + (row.amount || 0), 0);
    if (qty <= 0) return null;
    return money(amount * (params.quantity / qty));
  }
  const valued = ships.filter((row) => (row.unitCost || 0) > 0);
  if (!valued.length) return null;
  const qty = valued.reduce((sum, row) => sum + (row.quantity || 0), 0);
  const amount = valued.reduce((sum, row) => sum + (row.quantity || 0) * (row.unitCost || 0), 0);
  if (qty <= 0) return null;
  return money(amount * (params.quantity / qty));
}
