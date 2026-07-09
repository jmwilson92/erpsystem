import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type PartInput = {
  partNumber: string;
  description: string;
  revision?: string;
  uom?: string;
  uomUnitId?: string | null;
  sourcingMethod: "PURCHASE" | "BUILD";
  itemStructure?: string;
  partType?: string;
  standardCost?: number;
  lastBuyCost?: number;
  averageCost?: number;
  leadTimeDays?: number;
  isSerialized?: boolean;
  isLotControlled?: boolean;
  isActive?: boolean;
  drawingNumber?: string | null;
  inventoryAccountId?: string | null;
  expenseAccountId?: string | null;
  cogsAccountId?: string | null;
  requiresGdtInspection?: boolean;
  requiresFunctionalTest?: boolean;
  notes?: string | null;
};

function derivePartType(sourcing: string, structure: string): string {
  if (sourcing === "PURCHASE") {
    if (structure === "RAW_MATERIAL") return "BUY";
    return "BUY";
  }
  if (structure === "TOP_LEVEL_ASSEMBLY") return "ASSEMBLY";
  if (structure === "SUB_ASSEMBLY") return "MAKE";
  if (structure === "RAW_MATERIAL") return "MAKE";
  return "MAKE";
}

export async function createPart(params: PartInput & { userId?: string }) {
  const partNumber = params.partNumber.trim().toUpperCase();
  if (!partNumber) throw new Error("Part number required");
  if (!params.description.trim()) throw new Error("Description required");

  let uom = (params.uom || "EA").trim().toUpperCase() || "EA";
  if (params.uomUnitId) {
    const u = await prisma.uomUnit.findUnique({ where: { id: params.uomUnitId } });
    if (u) uom = u.code;
  }

  const structure = params.itemStructure || "N_A";
  const part = await prisma.part.create({
    data: {
      partNumber,
      description: params.description.trim(),
      revision: params.revision || "A",
      uom,
      uomUnitId: params.uomUnitId || null,
      sourcingMethod: params.sourcingMethod,
      itemStructure: structure,
      partType: params.partType || derivePartType(params.sourcingMethod, structure),
      standardCost: params.standardCost ?? 0,
      lastBuyCost: params.lastBuyCost ?? 0,
      averageCost: params.averageCost ?? params.standardCost ?? 0,
      leadTimeDays: params.leadTimeDays ?? 0,
      isSerialized: params.isSerialized ?? false,
      isLotControlled: params.isLotControlled ?? false,
      isActive: params.isActive ?? true,
      drawingNumber: params.drawingNumber || null,
      inventoryAccountId: params.inventoryAccountId || null,
      expenseAccountId: params.expenseAccountId || null,
      cogsAccountId: params.cogsAccountId || null,
      requiresGdtInspection: params.requiresGdtInspection ?? false,
      requiresFunctionalTest: params.requiresFunctionalTest ?? false,
      notes: params.notes || null,
    },
  });

  await logAudit({
    entityType: "Part",
    entityId: part.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { partNumber: part.partNumber },
  });
  return part;
}

export async function updatePart(
  id: string,
  params: Partial<PartInput> & { userId?: string }
) {
  const existing = await prisma.part.findUnique({ where: { id } });
  if (!existing) throw new Error("Part not found");

  let uom = params.uom !== undefined ? params.uom.trim().toUpperCase() : undefined;
  if (params.uomUnitId) {
    const u = await prisma.uomUnit.findUnique({ where: { id: params.uomUnitId } });
    if (u) uom = u.code;
  }

  const sourcing = params.sourcingMethod || existing.sourcingMethod;
  const structure = params.itemStructure || existing.itemStructure;

  const part = await prisma.part.update({
    where: { id },
    data: {
      ...(params.partNumber
        ? { partNumber: params.partNumber.trim().toUpperCase() }
        : {}),
      ...(params.description !== undefined
        ? { description: params.description.trim() }
        : {}),
      ...(params.revision !== undefined ? { revision: params.revision } : {}),
      ...(uom !== undefined ? { uom } : {}),
      ...(params.uomUnitId !== undefined ? { uomUnitId: params.uomUnitId } : {}),
      ...(params.sourcingMethod ? { sourcingMethod: params.sourcingMethod } : {}),
      ...(params.itemStructure !== undefined
        ? { itemStructure: params.itemStructure }
        : {}),
      partType:
        params.partType ||
        (params.sourcingMethod || params.itemStructure
          ? derivePartType(sourcing, structure)
          : undefined),
      ...(params.standardCost !== undefined
        ? { standardCost: params.standardCost }
        : {}),
      ...(params.lastBuyCost !== undefined
        ? { lastBuyCost: params.lastBuyCost }
        : {}),
      ...(params.averageCost !== undefined
        ? { averageCost: params.averageCost }
        : {}),
      ...(params.leadTimeDays !== undefined
        ? { leadTimeDays: params.leadTimeDays }
        : {}),
      ...(params.isSerialized !== undefined
        ? { isSerialized: params.isSerialized }
        : {}),
      ...(params.isLotControlled !== undefined
        ? { isLotControlled: params.isLotControlled }
        : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.drawingNumber !== undefined
        ? { drawingNumber: params.drawingNumber }
        : {}),
      ...(params.inventoryAccountId !== undefined
        ? { inventoryAccountId: params.inventoryAccountId }
        : {}),
      ...(params.expenseAccountId !== undefined
        ? { expenseAccountId: params.expenseAccountId }
        : {}),
      ...(params.cogsAccountId !== undefined
        ? { cogsAccountId: params.cogsAccountId }
        : {}),
      ...(params.requiresGdtInspection !== undefined
        ? { requiresGdtInspection: params.requiresGdtInspection }
        : {}),
      ...(params.requiresFunctionalTest !== undefined
        ? { requiresFunctionalTest: params.requiresFunctionalTest }
        : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });

  await logAudit({
    entityType: "Part",
    entityId: part.id,
    action: "UPDATED",
    userId: params.userId,
  });
  return part;
}

export async function upsertPartVendor(params: {
  id?: string;
  partId: string;
  supplierId: string;
  vendorPartNumber?: string;
  vendorDescription?: string;
  vendorSku?: string;
  manufacturer?: string;
  manufacturerPn?: string;
  unitCost?: number;
  minOrderQty?: number;
  leadTimeDays?: number;
  isPreferred?: boolean;
  isActive?: boolean;
  notes?: string;
  userId?: string;
}) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: params.supplierId },
  });
  if (!supplier) throw new Error("Supplier not found");

  if (params.isPreferred) {
    await prisma.partVendor.updateMany({
      where: { partId: params.partId, isPreferred: true },
      data: { isPreferred: false },
    });
  }

  if (params.id) {
    return prisma.partVendor.update({
      where: { id: params.id },
      data: {
        supplierId: params.supplierId,
        vendorPartNumber: params.vendorPartNumber || null,
        vendorDescription: params.vendorDescription || null,
        vendorSku: params.vendorSku || null,
        manufacturer: params.manufacturer || null,
        manufacturerPn: params.manufacturerPn || null,
        unitCost: params.unitCost ?? 0,
        minOrderQty: params.minOrderQty ?? 1,
        leadTimeDays: params.leadTimeDays ?? 0,
        isPreferred: params.isPreferred ?? false,
        isActive: params.isActive ?? true,
        notes: params.notes || null,
      },
    });
  }

  return prisma.partVendor.create({
    data: {
      partId: params.partId,
      supplierId: params.supplierId,
      vendorPartNumber: params.vendorPartNumber || null,
      vendorDescription: params.vendorDescription || null,
      vendorSku: params.vendorSku || null,
      manufacturer: params.manufacturer || null,
      manufacturerPn: params.manufacturerPn || null,
      unitCost: params.unitCost ?? 0,
      minOrderQty: params.minOrderQty ?? 1,
      leadTimeDays: params.leadTimeDays ?? 0,
      isPreferred: params.isPreferred ?? false,
      isActive: params.isActive ?? true,
      notes: params.notes || null,
    },
  });
}

export async function listApprovedSuppliers() {
  return prisma.supplier.findMany({
    where: {
      isApprovedVendor: true,
      status: { in: ["APPROVED", "CONDITIONAL"] },
    },
    orderBy: { name: "asc" },
  });
}

export function isSupplierApprovedForPo(s: {
  isApprovedVendor: boolean;
  status: string;
}) {
  return (
    s.isApprovedVendor &&
    (s.status === "APPROVED" || s.status === "CONDITIONAL")
  );
}
