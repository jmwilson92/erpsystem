/**
 * Shelf life & lot expiry.
 *
 * `Part.shelfLifeDays` and `Lot.expiresAt` already existed as columns but
 * nothing computed or enforced them. This wires them up:
 *   - receiving stamps an expiry on the lot from the part's shelf life
 *   - expiring/expired stock is queryable for alerts and reports
 *   - issuing expired material can be checked before it reaches the floor
 *
 * Matters for adhesives, sealants, o-rings, resins, and calibration standards —
 * the AS9100 auditor's favourite finding.
 */
import { Prisma } from "@prisma/client";
import { prisma, currentRequestSchema, isValidSchemaName } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Days before expiry that stock is considered "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

/** Shelf life applies only when the part carries a positive shelfLifeDays. */
export function computeExpiry(
  shelfLifeDays: number | null | undefined,
  receivedAt: Date = new Date()
): Date | null {
  if (!shelfLifeDays || shelfLifeDays <= 0) return null;
  return new Date(receivedAt.getTime() + shelfLifeDays * 86_400_000);
}

/**
 * Create (or update) a lot with expiry derived from the part's shelf life.
 * Call this from receiving so expiry is never a manual step someone forgets.
 * An explicit `expiresAt` (e.g. printed on the manufacturer's cert) wins over
 * the computed one.
 */
export async function recordLot(params: {
  lotNumber: string;
  partId: string;
  quantity: number;
  receivedAt?: Date;
  supplierId?: string | null;
  poNumber?: string | null;
  /** Manufacturer's printed expiry — overrides the shelf-life calculation. */
  expiresAt?: Date | null;
  userId?: string;
}) {
  const receivedAt = params.receivedAt ?? new Date();
  const part = await prisma.part.findUnique({
    where: { id: params.partId },
    select: { shelfLifeDays: true, partNumber: true },
  });

  const expiresAt =
    params.expiresAt ?? computeExpiry(part?.shelfLifeDays, receivedAt);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.lot.findUnique({ where: { lotNumber: params.lotNumber } });
    if (existing && existing.partId !== params.partId) {
      throw new Error("Lot number is already registered to another part");
    }
    // Include the immutable part identity in the unique predicate: a concurrent
    // first receipt for another part must fail its insert, never update this lot.
    const lot = await tx.lot.upsert({
      where: { lotNumber: params.lotNumber, partId: params.partId },
      create: {
        lotNumber: params.lotNumber, partId: params.partId, quantity: params.quantity,
        receivedAt, supplierId: params.supplierId || null, poNumber: params.poNumber || null, expiresAt,
      },
      update: { quantity: params.quantity, receivedAt, ...(expiresAt ? { expiresAt } : {}) },
    });
    await logAudit({
      entityType: "Lot", entityId: lot.id, action: "RECEIVED", userId: params.userId,
      metadata: { lotNumber: lot.lotNumber, partNumber: part?.partNumber, expiresAt: expiresAt?.toISOString() ?? null },
    }, tx);
    return lot;
  });
}

export type ExpiringLot = {
  id: string;
  lotNumber: string;
  partId: string;
  partNumber: string | null;
  description: string | null;
  quantity: number;
  expiresAt: Date;
  daysLeft: number;
  expired: boolean;
};

/**
 * Lots already expired or expiring inside `withinDays`, soonest first.
 * Only AVAILABLE stock — consumed or quarantined lots aren't actionable.
 */
export async function getExpiringLots(
  withinDays = EXPIRY_WARNING_DAYS
): Promise<ExpiringLot[]> {
  const horizon = new Date(Date.now() + withinDays * 86_400_000);
  const lots = await prisma.lot.findMany({
    where: {
      status: "AVAILABLE",
      quantity: { gt: 0 },
      expiresAt: { not: null, lte: horizon },
    },
    orderBy: { expiresAt: "asc" },
    take: 500,
  });
  if (lots.length === 0) return [];

  const parts = await prisma.part.findMany({
    where: { id: { in: [...new Set(lots.map((l) => l.partId))] } },
    select: { id: true, partNumber: true, description: true },
  });
  const byId = new Map(parts.map((p) => [p.id, p]));

  const now = Date.now();
  return lots.map((l) => {
    const p = byId.get(l.partId);
    const expiresAt = l.expiresAt as Date;
    return {
      id: l.id,
      lotNumber: l.lotNumber,
      partId: l.partId,
      partNumber: p?.partNumber ?? null,
      description: p?.description ?? null,
      quantity: l.quantity,
      expiresAt,
      daysLeft: Math.ceil((expiresAt.getTime() - now) / 86_400_000),
      expired: expiresAt.getTime() < now,
    };
  });
}

export async function getExpirySummary(withinDays = EXPIRY_WARNING_DAYS) {
  const rows = await getExpiringLots(withinDays);
  const expired = rows.filter((r) => r.expired);
  return {
    expired: expired.length,
    expiringSoon: rows.length - expired.length,
    total: rows.length,
  };
}

/**
 * Guard for anything about to consume a lot (kitting, issue to work order,
 * shipping, field-service part usage). Returns a reason string when the lot
 * must not be used, or null when it's fine.
 */
export async function checkLotUsable(lotId: string): Promise<string | null> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: { lotNumber: true, expiresAt: true, status: true },
  });
  if (!lot) return "Lot not found";
  if (lot.status === "QUARANTINE") {
    return `Lot ${lot.lotNumber} is in quarantine`;
  }
  if (lot.expiresAt && lot.expiresAt < new Date()) {
    return `Lot ${lot.lotNumber} expired ${lot.expiresAt.toLocaleDateString()}`;
  }
  return null;
}

/**
 * Mark expired stock so it stops showing as available. Intended for the
 * nightly sweep or a manual "quarantine expired" action; returns how many
 * lots were moved.
 */
export async function quarantineExpiredLots(userId?: string): Promise<number> {
  const schema = await currentRequestSchema();
  if (!isValidSchemaName(schema)) throw new Error("Invalid inventory schema");
  const lotTable = Prisma.raw(`"${schema}"."Lot"`);
  const stockTable = Prisma.raw(`"${schema}"."InventoryItem"`);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // Include pre-fix QUARANTINE labels with still-released physical stock.
    // Filter those in SQL so healthy old holds cannot starve the bounded sweep.
    // Both identifiers come only from the validated request schema, never input.
    const expired = await tx.$queryRaw<{ id: string; lotNumber: string; partId: string; status: string }[]>(Prisma.sql`
      SELECT l.id, l."lotNumber", l."partId", l.status FROM ${lotTable} l
      WHERE l."expiresAt" < ${now} AND (l.status = 'AVAILABLE' OR
        (l.status = 'QUARANTINE' AND EXISTS (
          SELECT 1 FROM ${stockTable} i WHERE i."partId" = l."partId" AND i."lotNumber" = l."lotNumber"
          AND i."quantityOnHand" > 0 AND (i."quantityAvailable" > 0 OR i."quantityQuarantine" < i."quantityOnHand")
        )))
      ORDER BY l.id LIMIT 500 FOR UPDATE OF l SKIP LOCKED`);
    for (const lot of expired) {
      // Hold the actual rows before reading quantities. A concurrent issue must
      // complete first, or see changed updatedAt/hold fields and fail its CAS.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${stockTable}
        WHERE "partId" = ${lot.partId} AND "lotNumber" = ${lot.lotNumber}
        AND "quantityOnHand" > 0 ORDER BY id FOR UPDATE`);
      const items = await tx.inventoryItem.findMany({ where: {
        partId: lot.partId, lotNumber: lot.lotNumber, quantityOnHand: { gt: 0 },
      } });
      for (const item of items) {
        // Preserve reservations and existing MRB/WO, serial, cost and ownership
        // identity. Quarantine is a physical hold, not an issue or cancellation.
        await tx.inventoryItem.update({ where: { id: item.id }, data: {
          quantityAvailable: 0, quantityQuarantine: item.quantityOnHand,
        } });
      }
      await tx.lot.update({ where: { id: lot.id }, data: { status: "QUARANTINE" } });
      await tx.traceEvent.create({ data: { eventType: "QUARANTINED_EXPIRED", partId: lot.partId,
        lotNumber: lot.lotNumber, quantity: items.reduce((sum, item) => sum + item.quantityOnHand, 0),
        notes: "Expired lot physical stock held; existing reservations and trace identity retained", userId,
      } });
      await logAudit({ entityType: "Lot", entityId: lot.id, action: "QUARANTINED_EXPIRED", userId,
        metadata: { lotNumber: lot.lotNumber, inventoryItemIds: items.map(item => item.id), repairedExistingHold: lot.status === "QUARANTINE" },
      }, tx);
    }
    return expired.length;
  }, { timeout: 30_000 });
}

/** Lots for one part, newest first — feeds the shelf-life panel on an item. */
export async function getLotsForPart(partId: string) {
  return prisma.lot.findMany({
    where: { partId },
    orderBy: [{ expiresAt: "asc" }, { receivedAt: "desc" }],
    take: 100,
  });
}
