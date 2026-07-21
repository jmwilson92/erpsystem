import { prisma } from "@/lib/db";

/**
 * Kit staging + work-center WIP location tracking.
 *
 * When a kit is picked, its material is moved into a real inventory row at the
 * staging location (on-hand, not available, tagged to the work order). As the
 * assembly moves through production, that WIP inventory travels with it between
 * work-center locations, so inventory always shows where the kit physically is.
 */

/**
 * Resolve the kit staging location. Prefers the company-configured staging
 * location code, then any STAGING-type location, then WIP, then STORAGE.
 * Auto-creates a STAGE-01 location if the company named one that doesn't exist.
 */
export async function resolveStagingLocation() {
  const settings = await prisma.companySettings.findUnique({
    where: { id: "default" },
    select: { kittingLocation: true },
  });
  const code = settings?.kittingLocation?.trim();

  if (code) {
    const byCode = await prisma.location.findFirst({
      where: { code: { equals: code } },
    });
    if (byCode) return byCode;
    // Named but missing — create it as a staging location in the first warehouse
    const wh = await prisma.warehouse.findFirst({ orderBy: { code: "asc" } });
    if (wh) {
      return prisma.location.create({
        data: {
          warehouseId: wh.id,
          code: code.toUpperCase(),
          name: "Kit staging",
          type: "STAGING",
        },
      });
    }
  }

  return (
    (await prisma.location.findFirst({ where: { type: "STAGING" } })) ||
    (await prisma.location.findFirst({ where: { type: "WIP" } })) ||
    (await prisma.location.findFirst({ where: { code: "WIP-01" } })) ||
    (await prisma.location.findFirst({ where: { type: "STORAGE" } }))
  );
}

/**
 * Move a work order's WIP material to a new location (staging or a work-center
 * floor location). Re-homes every WIP inventory row tagged to the WO, updates
 * WorkOrder.currentLocation, records transfers, and logs status history.
 */
export async function moveWorkOrderToLocation(params: {
  workOrderId: string;
  locationId: string;
  userId?: string;
}) {
  const [wo, dest] = await Promise.all([
    prisma.workOrder.findUnique({
      where: { id: params.workOrderId },
      include: { currentLocation: true },
    }),
    prisma.location.findUnique({
      where: { id: params.locationId },
      include: { workCenter: true },
    }),
  ]);
  if (!wo) throw new Error("Work order not found");
  if (!dest) throw new Error("Destination location not found");
  if (wo.currentLocationId === dest.id) {
    return { moved: 0, location: dest };
  }

  const wipRows = await prisma.inventoryItem.findMany({
    where: { workOrderId: wo.id },
    include: { location: true },
  });

  // Re-home each WIP row. Merge into an existing same-part/lot row at the
  // destination when one already exists, else just point the row at the dest.
  let moved = 0;
  for (const row of wipRows) {
    if (row.locationId === dest.id) continue;
    const existing = await prisma.inventoryItem.findFirst({
      where: {
        workOrderId: wo.id,
        locationId: dest.id,
        partId: row.partId,
        lotNumber: row.lotNumber,
      },
    });
    if (existing) {
      await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantityOnHand: existing.quantityOnHand + row.quantityOnHand,
        },
      });
      await prisma.inventoryItem.delete({ where: { id: row.id } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: row.id },
        data: { locationId: dest.id },
      });
    }
    await prisma.materialTransaction.create({
      data: {
        type: "TRANSFER",
        partId: row.partId,
        inventoryItemId: existing?.id ?? row.id,
        workOrderId: wo.id,
        quantity: row.quantityOnHand,
        fromLocation: row.location.code,
        toLocation: dest.code,
        lotNumber: row.lotNumber,
        serialNumber: row.serialNumber,
        reference: wo.number,
        notes: `WIP moved to ${dest.code}${dest.workCenter ? ` (${dest.workCenter.name})` : ""}`,
        userId: params.userId,
      },
    });
    moved += row.quantityOnHand;
  }

  const updates: {
    currentLocationId: string;
    workCenter?: string;
  } = { currentLocationId: dest.id };
  // Keep the WO's work-center field in step when moving onto a WC floor location
  if (dest.workCenter) updates.workCenter = dest.workCenter.code;

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      ...updates,
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: wo.status,
          userId: params.userId,
          notes: `Moved to ${dest.code}${dest.workCenter ? ` · ${dest.workCenter.name}` : ""}`,
        },
      },
    },
  });

  return { moved, location: dest };
}

/**
 * Consume a work order's WIP inventory (called when the WO completes to FG).
 * The staged material is now built into the finished assembly.
 */
export async function consumeWorkOrderWip(params: {
  workOrderId: string;
  userId?: string;
}) {
  const rows = await prisma.inventoryItem.findMany({
    where: { workOrderId: params.workOrderId, quantityOnHand: { gt: 0 } },
    include: { location: true },
  });
  for (const row of rows) {
    await prisma.materialTransaction.create({
      data: {
        type: "ISSUE",
        partId: row.partId,
        inventoryItemId: row.id,
        workOrderId: params.workOrderId,
        quantity: row.quantityOnHand,
        fromLocation: row.location.code,
        lotNumber: row.lotNumber,
        serialNumber: row.serialNumber,
        reference: "WIP_CONSUMED",
        notes: "WIP material consumed into finished assembly",
        userId: params.userId,
      },
    });
  }
  // Remove the WIP rows entirely — material is now inside the finished good.
  await prisma.inventoryItem.deleteMany({
    where: { workOrderId: params.workOrderId },
  });
  return { consumed: rows.length };
}
