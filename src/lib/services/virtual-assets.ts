"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function listVirtualAssets(filters?: {
  programId?: string;
  projectId?: string;
  salesOrderId?: string;
  productId?: string;
  usageType?: string;
  q?: string;
}) {
  return prisma.virtualAsset.findMany({
    where: {
      ...(filters?.programId ? { programId: filters.programId } : {}),
      ...(filters?.projectId ? { projectId: filters.projectId } : {}),
      ...(filters?.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      ...(filters?.productId ? { productId: filters.productId } : {}),
      ...(filters?.usageType ? { usageType: filters.usageType } : {}),
      ...(filters?.q
        ? {
            OR: [
              { assetTag: { contains: filters.q } },
              { name: { contains: filters.q } },
              { vendor: { contains: filters.q } },
              { licenseKey: { contains: filters.q } },
              { computerName: { contains: filters.q } },
            ],
          }
        : {}),
    },
    orderBy: { assetTag: "asc" },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      checkedOutTo: { select: { id: true, name: true, email: true } },
      product: { select: { id: true, code: true, name: true } },
      program: { select: { id: true, code: true, name: true } },
      project: { select: { id: true, number: true, name: true } },
      salesOrder: { select: { id: true, number: true } },
      assignments: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
}

export async function createVirtualAsset(params: {
  name: string;
  description?: string;
  assetType?: string;
  usageType?: string;
  vendor?: string;
  licenseKey?: string;
  seats?: number;
  cost?: number;
  purchasedAt?: Date | null;
  expiresAt?: Date | null;
  renewalUrl?: string;
  notes?: string;
  computerName?: string;
  productId?: string;
  programId?: string;
  projectId?: string;
  salesOrderId?: string;
  userId?: string;
}) {
  const count = await prisma.virtualAsset.count();
  const assetTag = `VA-${String(count + 1).padStart(5, "0")}`;
  const asset = await prisma.virtualAsset.create({
    data: {
      assetTag,
      name: params.name,
      description: params.description,
      assetType: params.assetType || "LICENSE",
      usageType: params.usageType || "INTERNAL",
      vendor: params.vendor,
      licenseKey: params.licenseKey,
      seats: params.seats,
      cost: params.cost ?? 0,
      purchasedAt: params.purchasedAt || undefined,
      expiresAt: params.expiresAt || undefined,
      renewalUrl: params.renewalUrl,
      notes: params.notes,
      computerName: params.computerName,
      productId: params.productId || null,
      programId: params.programId || null,
      projectId: params.projectId || null,
      salesOrderId: params.salesOrderId || null,
      status: "AVAILABLE",
    },
  });
  await logAudit({
    entityType: "VirtualAsset",
    entityId: asset.id,
    action: "CREATED",
    userId: params.userId,
  });
  return asset;
}

export async function assignVirtualAsset(params: {
  assetId: string;
  userId: string;
  notes?: string;
  actorId?: string;
}) {
  const asset = await prisma.virtualAsset.findUnique({
    where: { id: params.assetId },
  });
  if (!asset) throw new Error("Virtual asset not found");
  if (asset.status === "RETIRED" || asset.status === "EXPIRED") {
    throw new Error("Cannot assign retired/expired asset");
  }
  if (asset.seats != null && asset.seatsUsed >= asset.seats) {
    throw new Error("No seats available");
  }

  const updated = await prisma.virtualAsset.update({
    where: { id: asset.id },
    data: {
      assignedToId: params.userId,
      status: "ASSIGNED",
      seatsUsed: asset.seats != null ? asset.seatsUsed + 1 : asset.seatsUsed,
    },
  });

  await prisma.virtualAssetAssignment.create({
    data: {
      virtualAssetId: asset.id,
      userId: params.userId,
      action: "ASSIGN",
      notes: params.notes,
    },
  });

  await logAudit({
    entityType: "VirtualAsset",
    entityId: asset.id,
    action: "ASSIGNED",
    userId: params.actorId || params.userId,
    metadata: { assigneeId: params.userId },
  });
  return updated;
}

export async function unassignVirtualAsset(params: {
  assetId: string;
  actorId?: string;
  notes?: string;
}) {
  const asset = await prisma.virtualAsset.findUnique({
    where: { id: params.assetId },
  });
  if (!asset) throw new Error("Virtual asset not found");

  const priorUser = asset.assignedToId;
  const updated = await prisma.virtualAsset.update({
    where: { id: asset.id },
    data: {
      assignedToId: null,
      status:
        asset.checkedOutToId
          ? "CHECKED_OUT"
          : asset.status === "EXPIRED"
            ? "EXPIRED"
            : "AVAILABLE",
      seatsUsed: Math.max(0, asset.seatsUsed - (priorUser ? 1 : 0)),
    },
  });

  if (priorUser) {
    await prisma.virtualAssetAssignment.create({
      data: {
        virtualAssetId: asset.id,
        userId: priorUser,
        action: "UNASSIGN",
        notes: params.notes,
      },
    });
  }

  await logAudit({
    entityType: "VirtualAsset",
    entityId: asset.id,
    action: "UNASSIGNED",
    userId: params.actorId,
  });
  return updated;
}

export async function checkoutVirtualAsset(params: {
  assetId: string;
  userId: string;
  notes?: string;
}) {
  const asset = await prisma.virtualAsset.findUnique({
    where: { id: params.assetId },
  });
  if (!asset) throw new Error("Virtual asset not found");
  if (asset.checkedOutToId) throw new Error("Already checked out");
  if (["RETIRED", "EXPIRED"].includes(asset.status)) {
    throw new Error("Cannot check out retired/expired asset");
  }

  const updated = await prisma.virtualAsset.update({
    where: { id: asset.id },
    data: {
      checkedOutToId: params.userId,
      checkedOutAt: new Date(),
      status: "CHECKED_OUT",
    },
  });

  await prisma.virtualAssetAssignment.create({
    data: {
      virtualAssetId: asset.id,
      userId: params.userId,
      action: "CHECKOUT",
      notes: params.notes,
    },
  });

  await logAudit({
    entityType: "VirtualAsset",
    entityId: asset.id,
    action: "CHECKOUT",
    userId: params.userId,
  });
  return updated;
}

export async function returnVirtualAsset(params: {
  assetId: string;
  actorId?: string;
  notes?: string;
}) {
  const asset = await prisma.virtualAsset.findUnique({
    where: { id: params.assetId },
  });
  if (!asset) throw new Error("Virtual asset not found");
  if (!asset.checkedOutToId) throw new Error("Not checked out");

  const prior = asset.checkedOutToId;
  const updated = await prisma.virtualAsset.update({
    where: { id: asset.id },
    data: {
      checkedOutToId: null,
      checkedOutAt: null,
      status: asset.assignedToId ? "ASSIGNED" : "AVAILABLE",
    },
  });

  await prisma.virtualAssetAssignment.create({
    data: {
      virtualAssetId: asset.id,
      userId: prior,
      action: "RETURN",
      notes: params.notes,
    },
  });

  await logAudit({
    entityType: "VirtualAsset",
    entityId: asset.id,
    action: "RETURN",
    userId: params.actorId || prior,
  });
  return updated;
}
