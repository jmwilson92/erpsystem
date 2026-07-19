/**
 * Serialization — per-unit serials with as-built genealogy.
 *
 * Every finished unit of a serialized part gets its own serial. When a
 * WO's units are serialized we also write the as-built record: one
 * SerialComponent row per BOM component per unit — by exact component
 * serial when the component part is serialized, by lot otherwise. That
 * makes each top-level unit individually answerable for what's inside
 * it (and each component serial answerable for where it went).
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Mint one serial per finished unit for a serialized WO part. */
export async function mintUnitSerials(params: {
  workOrderId: string;
  partId: string;
  quantity: number;
  lotNumber?: string | null;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    select: { number: true },
  });
  if (!wo) throw new Error("Work order not found");
  const count = Math.max(1, Math.round(params.quantity));
  const serials: { id: string; serial: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const serial = `SN-${wo.number}-${String(i).padStart(2, "0")}`;
    const row = await prisma.serialNumber.upsert({
      where: { serial },
      create: {
        serial,
        partId: params.partId,
        status: "IN_STOCK",
        workOrderId: params.workOrderId,
        lotNumber: params.lotNumber || null,
      },
      update: {},
    });
    serials.push({ id: row.id, serial: row.serial });
  }
  await logAudit({
    entityType: "WorkOrder",
    entityId: params.workOrderId,
    action: "UNITS_SERIALIZED",
    userId: params.userId,
    metadata: { serials: serials.map((s) => s.serial) },
  });
  return serials;
}

/**
 * Write the as-built for each unit serial from the WO's kitted material.
 * Serialized components are assigned to units one-by-one (minting
 * component serials from the issued lot when receiving didn't register
 * them); lot-controlled components get a lot row with per-unit quantity.
 */
export async function buildUnitAsBuilt(params: {
  workOrderId: string;
  unitSerialIds: string[];
  userId?: string;
}) {
  const units = params.unitSerialIds;
  if (!units.length) return { componentsPerUnit: 0 };

  const kits = await prisma.kitOrder.findMany({
    where: {
      workOrderId: params.workOrderId,
      status: { in: ["COMPLETE", "COMPLETED"] },
    },
    include: { lines: { include: { part: true } } },
  });
  const lines = kits.flatMap((k) => k.lines);
  if (!lines.length) return { componentsPerUnit: 0 };

  let written = 0;
  for (const line of lines) {
    const totalQty = line.quantityPicked || line.quantityRequired || 0;
    if (totalQty <= 0) continue;
    const perUnit = totalQty / units.length;

    if (line.part.isSerialized) {
      // Whole units only — assign one component serial per required unit.
      const eachNeeds = Math.max(1, Math.round(perUnit));
      // Pool: serials already registered for this part+lot and not yet installed
      const pool = await prisma.serialNumber.findMany({
        where: {
          partId: line.partId,
          ...(line.lotNumber ? { lotNumber: line.lotNumber } : {}),
          status: { in: ["IN_STOCK", "ISSUED"] },
        },
        orderBy: { serial: "asc" },
        take: units.length * eachNeeds,
      });
      let poolIdx = 0;
      for (const unitId of units) {
        for (let n = 0; n < eachNeeds; n++) {
          let comp = pool[poolIdx++];
          if (!comp) {
            // Receiving didn't register serials for this lot — mint one now
            // so the install is still individually accounted.
            const serial = `SN-${line.part.partNumber}-${(line.lotNumber || "LOT").replace(/[^A-Za-z0-9]/g, "")}-${String(poolIdx).padStart(2, "0")}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
            comp = await prisma.serialNumber.create({
              data: {
                serial,
                partId: line.partId,
                status: "ISSUED",
                lotNumber: line.lotNumber,
                workOrderId: params.workOrderId,
              },
            });
          }
          await prisma.serialComponent.create({
            data: {
              parentId: unitId,
              componentPartId: line.partId,
              componentSerialId: comp.id,
              lotNumber: line.lotNumber,
              quantity: 1,
              workOrderId: params.workOrderId,
            },
          });
          await prisma.serialNumber.update({
            where: { id: comp.id },
            data: { status: "INSTALLED" },
          });
          written++;
        }
      }
    } else {
      for (const unitId of units) {
        await prisma.serialComponent.create({
          data: {
            parentId: unitId,
            componentPartId: line.partId,
            componentSerialId: null,
            lotNumber: line.lotNumber,
            quantity: perUnit,
            workOrderId: params.workOrderId,
          },
        });
        written++;
      }
    }
  }
  return { componentsPerUnit: Math.round(written / units.length) };
}

/** Registry list with filters. */
export async function listSerials(params?: {
  search?: string;
  status?: string;
  partId?: string;
}) {
  return prisma.serialNumber.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.partId ? { partId: params.partId } : {}),
      ...(params?.search
        ? {
            OR: [
              { serial: { contains: params.search } },
              { lotNumber: { contains: params.search } },
              { part: { partNumber: { contains: params.search } } },
            ],
          }
        : {}),
    },
    include: {
      part: { select: { partNumber: true, description: true, isSerialized: true } },
      _count: { select: { components: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/** Full genealogy for one serial: unit info, as-built down, where-used up. */
export async function getSerialGenealogy(serialId: string) {
  const unit = await prisma.serialNumber.findUnique({
    where: { id: serialId },
    include: {
      part: { select: { id: true, partNumber: true, description: true } },
      components: {
        include: {
          componentPart: {
            select: { id: true, partNumber: true, description: true, isSerialized: true },
          },
          componentSerial: { select: { id: true, serial: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      installedIn: {
        include: {
          parent: {
            include: { part: { select: { partNumber: true, description: true } } },
          },
        },
      },
      rmas: { select: { id: true, number: true, status: true } },
    },
  });
  if (!unit) return null;
  const wo = unit.workOrderId
    ? await prisma.workOrder.findUnique({
        where: { id: unit.workOrderId },
        select: { id: true, number: true, salesOrderId: true },
      })
    : null;
  const so = wo?.salesOrderId
    ? await prisma.salesOrder.findUnique({
        where: { id: wo.salesOrderId },
        select: { id: true, number: true },
      })
    : null;
  const traceEvents = await prisma.traceEvent.findMany({
    where: { serialNumber: unit.serial },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return { unit, wo, so, traceEvents };
}

// ─── RMA (customer returns) ─────────────────────────────────────

export async function nextRmaNumber() {
  const count = await prisma.rma.count();
  let number = `RMA-${String(count + 1).padStart(5, "0")}`;
  if (await prisma.rma.findUnique({ where: { number } })) {
    number = `RMA-${String(count + 1).padStart(5, "0")}-${Date.now().toString(36).slice(-4)}`;
  }
  return number;
}

export async function createRma(params: {
  customerId: string;
  salesOrderId?: string | null;
  partId?: string | null;
  serialNumberId?: string | null;
  quantity?: number;
  reason: string;
  userId?: string;
}) {
  if (!params.reason.trim()) throw new Error("A return reason is required");
  const rma = await prisma.rma.create({
    data: {
      number: await nextRmaNumber(),
      customerId: params.customerId,
      salesOrderId: params.salesOrderId || null,
      partId: params.partId || null,
      serialNumberId: params.serialNumberId || null,
      quantity: params.quantity || 1,
      reason: params.reason.trim(),
      createdById: params.userId,
    },
  });
  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: rma.number },
  });
  return rma;
}

const RMA_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ["AUTHORIZED", "REJECTED"],
  AUTHORIZED: ["RECEIVED", "REJECTED"],
  RECEIVED: ["IN_EVALUATION", "DISPOSITIONED"],
  IN_EVALUATION: ["DISPOSITIONED"],
  DISPOSITIONED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
};

export async function transitionRma(params: {
  rmaId: string;
  to: string;
  disposition?: string | null;
  dispositionNotes?: string | null;
  userId?: string;
}) {
  const rma = await prisma.rma.findUnique({ where: { id: params.rmaId } });
  if (!rma) throw new Error("RMA not found");
  const allowed = RMA_TRANSITIONS[rma.status] || [];
  if (!allowed.includes(params.to)) {
    throw new Error(`Cannot move RMA from ${rma.status} to ${params.to}`);
  }
  if (params.to === "DISPOSITIONED" && !params.disposition) {
    throw new Error("Pick a disposition (repair, replace, credit, stock, scrap)");
  }

  const updated = await prisma.rma.update({
    where: { id: rma.id },
    data: {
      status: params.to,
      ...(params.disposition ? { disposition: params.disposition } : {}),
      ...(params.dispositionNotes
        ? { dispositionNotes: params.dispositionNotes }
        : {}),
      ...(params.to === "RECEIVED" ? { receivedAt: new Date() } : {}),
      ...(params.to === "CLOSED" || params.to === "REJECTED"
        ? { closedAt: new Date() }
        : {}),
    },
  });

  // Returned serialized unit goes to quarantine on receipt; scrap on
  // a SCRAP disposition close.
  if (rma.serialNumberId) {
    if (params.to === "RECEIVED") {
      await prisma.serialNumber.update({
        where: { id: rma.serialNumberId },
        data: { status: "QUARANTINE" },
      });
    } else if (params.to === "CLOSED" && updated.disposition === "SCRAP") {
      await prisma.serialNumber.update({
        where: { id: rma.serialNumberId },
        data: { status: "SCRAPPED" },
      });
    } else if (
      params.to === "CLOSED" &&
      updated.disposition === "RETURN_TO_STOCK"
    ) {
      await prisma.serialNumber.update({
        where: { id: rma.serialNumberId },
        data: { status: "IN_STOCK" },
      });
    }
    const sn = await prisma.serialNumber.findUnique({
      where: { id: rma.serialNumberId },
      select: { serial: true, partId: true },
    });
    if (sn) {
      await prisma.traceEvent.create({
        data: {
          eventType: `RMA_${params.to}`,
          partId: sn.partId,
          serialNumber: sn.serial,
          quantity: rma.quantity,
          salesOrderId: rma.salesOrderId || undefined,
          notes: `${rma.number}: ${params.to}${updated.disposition ? ` (${updated.disposition})` : ""}`,
        },
      });
    }
  }

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: params.to,
    userId: params.userId,
    changes: { from: rma.status, to: params.to },
  });
  return updated;
}

export async function listRmas(params?: { status?: string }) {
  return prisma.rma.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      customer: { select: { name: true } },
      part: { select: { partNumber: true } },
      serialNumber: { select: { id: true, serial: true } },
      salesOrder: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
