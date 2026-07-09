"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function listUomUnits(activeOnly = true) {
  return prisma.uomUnit.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    include: {
      conversionsFrom: { include: { toUom: true } },
      conversionsTo: { include: { fromUom: true } },
    },
  });
}

export async function saveUomUnit(params: {
  id?: string;
  code: string;
  name: string;
  category?: string;
  isActive?: boolean;
  sortOrder?: number;
  userId?: string;
}) {
  const code = params.code.trim().toUpperCase();
  if (!code) throw new Error("UOM code required");

  if (params.id) {
    return prisma.uomUnit.update({
      where: { id: params.id },
      data: {
        code,
        name: params.name.trim(),
        category: params.category || "COUNT",
        isActive: params.isActive ?? true,
        sortOrder: params.sortOrder ?? 0,
      },
    });
  }

  const u = await prisma.uomUnit.create({
    data: {
      code,
      name: params.name.trim(),
      category: params.category || "COUNT",
      isActive: params.isActive ?? true,
      sortOrder: params.sortOrder ?? 0,
    },
  });
  await logAudit({
    entityType: "UomUnit",
    entityId: u.id,
    action: "CREATED",
    userId: params.userId,
  });
  return u;
}

export async function saveUomConversion(params: {
  fromUomId: string;
  toUomId: string;
  factor: number;
  notes?: string;
  userId?: string;
}) {
  if (params.fromUomId === params.toUomId) {
    throw new Error("From and to UOM must differ");
  }
  if (!(params.factor > 0)) throw new Error("Factor must be > 0");

  const conv = await prisma.uomConversion.upsert({
    where: {
      fromUomId_toUomId: {
        fromUomId: params.fromUomId,
        toUomId: params.toUomId,
      },
    },
    create: {
      fromUomId: params.fromUomId,
      toUomId: params.toUomId,
      factor: params.factor,
      notes: params.notes,
    },
    update: {
      factor: params.factor,
      notes: params.notes,
    },
  });

  // Inverse conversion
  await prisma.uomConversion.upsert({
    where: {
      fromUomId_toUomId: {
        fromUomId: params.toUomId,
        toUomId: params.fromUomId,
      },
    },
    create: {
      fromUomId: params.toUomId,
      toUomId: params.fromUomId,
      factor: 1 / params.factor,
      notes: params.notes ? `Inverse of: ${params.notes}` : "Auto inverse",
    },
    update: {
      factor: 1 / params.factor,
    },
  });

  return conv;
}

export async function convertQty(params: {
  quantity: number;
  fromCode: string;
  toCode: string;
}) {
  if (params.fromCode === params.toCode) return params.quantity;
  const from = await prisma.uomUnit.findUnique({
    where: { code: params.fromCode.toUpperCase() },
  });
  const to = await prisma.uomUnit.findUnique({
    where: { code: params.toCode.toUpperCase() },
  });
  if (!from || !to) throw new Error("Unknown UOM");
  const conv = await prisma.uomConversion.findUnique({
    where: {
      fromUomId_toUomId: { fromUomId: from.id, toUomId: to.id },
    },
  });
  if (!conv) throw new Error(`No conversion ${params.fromCode} → ${params.toCode}`);
  return params.quantity * conv.factor;
}
