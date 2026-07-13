/**
 * Asset Tracker — company tools, test equipment, and demo units.
 * Assets check out to a person and optionally attach to a work order
 * or engineering task. In-house-only assets can never go offsite; demo
 * units can.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function createAsset(params: {
  name: string;
  category?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  locationScope?: string;
  homeLocation?: string;
  purchaseValue?: number;
  userId?: string | null;
}) {
  const count = await prisma.asset.count();
  const asset = await prisma.asset.create({
    data: {
      assetTag: `AST-${String(count + 1).padStart(5, "0")}`,
      name: params.name,
      category: params.category || "EQUIPMENT",
      serialNumber: params.serialNumber || null,
      manufacturer: params.manufacturer || null,
      model: params.model || null,
      locationScope:
        params.locationScope === "OFFSITE_OK" ? "OFFSITE_OK" : "IN_HOUSE_ONLY",
      homeLocation: params.homeLocation || null,
      purchaseValue: params.purchaseValue || 0,
    },
  });
  await logAudit({
    entityType: "Asset",
    entityId: asset.id,
    action: "ASSET_CREATED",
    userId: params.userId,
    metadata: { tag: asset.assetTag, name: asset.name },
  });
  return asset;
}

export async function checkoutAsset(params: {
  assetId: string;
  userId: string;
  purpose?: string;
  offsite?: boolean;
  destination?: string;
  dueAt?: Date | null;
  workOrderId?: string | null;
  engTaskId?: string | null;
  actorId?: string | null;
}) {
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: params.assetId },
  });
  if (asset.status === "CHECKED_OUT" || asset.status === "IN_USE") {
    throw new Error("Asset is already checked out");
  }
  if (asset.status === "RETIRED") {
    throw new Error("Asset is retired");
  }
  if (params.offsite && asset.locationScope === "IN_HOUSE_ONLY") {
    throw new Error(
      `${asset.assetTag} is in-house only and cannot leave the facility.`
    );
  }

  await prisma.assetCheckout.create({
    data: {
      assetId: asset.id,
      userId: params.userId,
      purpose: params.purpose || null,
      offsite: Boolean(params.offsite),
      destination: params.destination || null,
      dueAt: params.dueAt || null,
    },
  });
  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: {
      status: "CHECKED_OUT",
      assignedToUserId: params.userId,
      workOrderId: params.workOrderId || null,
      engTaskId: params.engTaskId || null,
    },
  });
  await logAudit({
    entityType: "Asset",
    entityId: asset.id,
    action: params.offsite ? "ASSET_CHECKED_OUT_OFFSITE" : "ASSET_CHECKED_OUT",
    userId: params.actorId,
    metadata: { destination: params.destination, purpose: params.purpose },
  });
  return updated;
}

export async function checkinAsset(params: {
  assetId: string;
  returnNote?: string;
  actorId?: string | null;
}) {
  const open = await prisma.assetCheckout.findFirst({
    where: { assetId: params.assetId, checkedInAt: null },
    orderBy: { checkedOutAt: "desc" },
  });
  if (open) {
    await prisma.assetCheckout.update({
      where: { id: open.id },
      data: { checkedInAt: new Date(), returnNote: params.returnNote || null },
    });
  }
  const updated = await prisma.asset.update({
    where: { id: params.assetId },
    data: {
      status: "AVAILABLE",
      assignedToUserId: null,
      workOrderId: null,
      engTaskId: null,
    },
  });
  await logAudit({
    entityType: "Asset",
    entityId: params.assetId,
    action: "ASSET_CHECKED_IN",
    userId: params.actorId,
    metadata: { returnNote: params.returnNote },
  });
  return updated;
}

export async function getAssetsOverview() {
  const assets = await prisma.asset.findMany({
    include: {
      assignedToUser: { select: { name: true } },
      workOrder: { select: { number: true } },
      engTask: { select: { name: true } },
      checkouts: {
        where: { checkedInAt: null },
        orderBy: { checkedOutAt: "desc" },
        take: 1,
      },
    },
    orderBy: { assetTag: "asc" },
  });
  const counts = {
    total: assets.length,
    available: assets.filter((a) => a.status === "AVAILABLE").length,
    out: assets.filter((a) => ["CHECKED_OUT", "IN_USE"].includes(a.status)).length,
    offsite: assets.filter((a) => a.checkouts[0]?.offsite).length,
  };
  return { assets, counts };
}
