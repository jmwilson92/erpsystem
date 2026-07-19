/**
 * Serial as-built genealogy — install/remove trees, WO multi-qty units,
 * kit serial-to-unit assignments for assembler/QA checklists.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recordTrace } from "@/lib/services/order-fulfillment";

export type SerialTreeNode = {
  serialId: string;
  serial: string;
  partId: string;
  partNumber: string;
  partName: string;
  status: string;
  installId?: string;
  quantity?: number;
  lotNumber?: string | null;
  installedAt?: Date | null;
  children: SerialTreeNode[];
};

/** Mint a new serial for a part (unique serial string). */
export async function mintSerial(params: {
  serial: string;
  partId: string;
  workOrderId?: string | null;
  lotNumber?: string | null;
  status?: string;
  ownership?: string;
  userId?: string;
}) {
  const serial = params.serial.trim().toUpperCase();
  if (!serial) throw new Error("Serial number required");
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  if (!part) throw new Error("Part not found");

  const row = await prisma.serialNumber.create({
    data: {
      serial,
      partId: params.partId,
      workOrderId: params.workOrderId || null,
      lotNumber: params.lotNumber || null,
      status: params.status || "IN_STOCK",
      ownership: params.ownership || "COMPANY",
    },
    include: { part: { select: { partNumber: true, description: true } } },
  });

  await logAudit({
    entityType: "SerialNumber",
    entityId: row.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { serial, partId: params.partId },
  });

  return row;
}

/** Ensure WorkOrderUnit rows 1..quantity exist for a WO. */
export async function ensureWorkOrderUnits(params: {
  workOrderId: string;
  quantity?: number;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");
  const qty = Math.max(1, Math.floor(params.quantity ?? (wo.quantity || 1)));

  const existing = await prisma.workOrderUnit.findMany({
    where: { workOrderId: wo.id },
  });
  const have = new Set(existing.map((u) => u.unitIndex));
  for (let i = 1; i <= qty; i++) {
    if (have.has(i)) continue;
    await prisma.workOrderUnit.create({
      data: { workOrderId: wo.id, unitIndex: i, status: "OPEN" },
    });
  }
  return prisma.workOrderUnit.findMany({
    where: { workOrderId: wo.id },
    orderBy: { unitIndex: "asc" },
    include: {
      serial: { include: { part: { select: { partNumber: true, description: true } } } },
      kitAssignments: {
        include: {
          serial: { include: { part: { select: { partNumber: true, description: true } } } },
        },
      },
    },
  });
}

/** Assign top-level serial to a WO unit. */
export async function assignUnitSerial(params: {
  workOrderId: string;
  unitIndex: number;
  serial: string;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: { part: true },
  });
  if (!wo) throw new Error("Work order not found");
  if (!wo.partId) throw new Error("Work order has no part");

  await ensureWorkOrderUnits({ workOrderId: wo.id });

  let sn = await prisma.serialNumber.findUnique({
    where: { serial: params.serial.trim().toUpperCase() },
  });
  if (!sn) {
    sn = await mintSerial({
      serial: params.serial,
      partId: wo.partId,
      workOrderId: wo.id,
      status: "ISSUED",
      userId: params.userId,
    });
  } else if (sn.partId !== wo.partId) {
    throw new Error(
      `Serial ${sn.serial} is for a different part than this WO`
    );
  }

  const unit = await prisma.workOrderUnit.update({
    where: {
      workOrderId_unitIndex: {
        workOrderId: wo.id,
        unitIndex: params.unitIndex,
      },
    },
    data: { serialId: sn.id, status: "IN_BUILD" },
    include: { serial: true },
  });

  await prisma.serialNumber.update({
    where: { id: sn.id },
    data: { workOrderId: wo.id, status: sn.status === "IN_STOCK" ? "ISSUED" : sn.status },
  });

  return unit;
}

/**
 * When kit is issued: map each serialized component SN to a WO unit
 * so assemblers know what goes where and QA knows what to check.
 */
export async function assignKitSerialToUnit(params: {
  workOrderId: string;
  unitIndex: number;
  serial: string;
  partId?: string;
  kitOrderId?: string | null;
  userId?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  if (!wo) throw new Error("Work order not found");

  await ensureWorkOrderUnits({ workOrderId: wo.id });
  const unit = await prisma.workOrderUnit.findUnique({
    where: {
      workOrderId_unitIndex: {
        workOrderId: wo.id,
        unitIndex: params.unitIndex,
      },
    },
  });
  if (!unit) throw new Error(`Unit ${params.unitIndex} not found`);

  const sn = await prisma.serialNumber.findUnique({
    where: { serial: params.serial.trim().toUpperCase() },
    include: { part: true },
  });
  if (!sn) throw new Error(`Serial ${params.serial} not found — mint or receive it first`);
  if (params.partId && sn.partId !== params.partId) {
    throw new Error("Serial part does not match assignment part");
  }
  if (!["IN_STOCK", "ISSUED"].includes(sn.status)) {
    throw new Error(`Serial ${sn.serial} status ${sn.status} cannot be kit-assigned`);
  }

  const row = await prisma.kitSerialAssignment.create({
    data: {
      workOrderId: wo.id,
      workOrderUnitId: unit.id,
      unitIndex: params.unitIndex,
      partId: sn.partId,
      serialId: sn.id,
      kitOrderId: params.kitOrderId || null,
      status: "ISSUED",
    },
    include: {
      serial: { include: { part: { select: { partNumber: true, description: true } } } },
    },
  });

  await prisma.serialNumber.update({
    where: { id: sn.id },
    data: { status: "ISSUED", workOrderId: wo.id },
  });

  await recordTrace({
    eventType: "KIT_SERIAL_ASSIGN",
    partId: sn.partId,
    serialNumber: sn.serial,
    workOrderId: wo.id,
    notes: `SN ${sn.serial} → unit ${params.unitIndex}`,
    userId: params.userId,
    metadata: { unitIndex: params.unitIndex, assignmentId: row.id },
  });

  return row;
}

export async function listKitSerialPlan(workOrderId: string) {
  return prisma.kitSerialAssignment.findMany({
    where: { workOrderId, status: { not: "CANCELLED" } },
    orderBy: [{ unitIndex: "asc" }, { createdAt: "asc" }],
    include: {
      serial: {
        include: { part: { select: { partNumber: true, description: true, isSerialized: true } } },
      },
    },
  });
}

/** Install child into parent (as-built). */
export async function installSerial(params: {
  parentSerialId: string;
  childSerialId?: string | null;
  childPartId: string;
  childLotNumber?: string | null;
  quantity?: number;
  workOrderId?: string | null;
  workOrderUnitIndex?: number | null;
  rmaId?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const parent = await prisma.serialNumber.findUnique({
    where: { id: params.parentSerialId },
  });
  if (!parent) throw new Error("Parent serial not found");

  const childSerialId = params.childSerialId || null;
  if (childSerialId) {
    const child = await prisma.serialNumber.findUnique({
      where: { id: childSerialId },
    });
    if (!child) throw new Error("Child serial not found");
    if (child.partId !== params.childPartId) {
      throw new Error("Child serial part mismatch");
    }
    if (["SCRAPPED", "SHIPPED"].includes(child.status)) {
      throw new Error(`Cannot install serial in status ${child.status}`);
    }
    await prisma.serialNumber.update({
      where: { id: child.id },
      data: {
        status: "INSTALLED",
        parentSerialId: parent.id,
      },
    });
  }

  const install = await prisma.serialInstall.create({
    data: {
      parentSerialId: parent.id,
      childSerialId,
      childPartId: params.childPartId,
      childLotNumber: params.childLotNumber || null,
      quantity: params.quantity ?? 1,
      workOrderId: params.workOrderId || null,
      workOrderUnitIndex: params.workOrderUnitIndex ?? null,
      status: "INSTALLED",
      installedById: params.userId || null,
      rmaId: params.rmaId || null,
      notes: params.notes || null,
    },
    include: {
      childPart: { select: { partNumber: true, description: true } },
      childSerial: true,
      parentSerial: true,
    },
  });

  // Mark kit assignment installed if matching
  if (childSerialId && params.workOrderId && params.workOrderUnitIndex) {
    await prisma.kitSerialAssignment.updateMany({
      where: {
        workOrderId: params.workOrderId,
        unitIndex: params.workOrderUnitIndex,
        serialId: childSerialId,
        status: { in: ["PLANNED", "ISSUED"] },
      },
      data: { status: "INSTALLED" },
    });
  }

  await recordTrace({
    eventType: "SERIAL_INSTALL",
    partId: params.childPartId,
    serialNumber: install.childSerial?.serial,
    workOrderId: params.workOrderId || undefined,
    notes: `Installed into ${parent.serial}`,
    userId: params.userId,
  });

  return install;
}

/** Remove installed component (tear-down / RMA). */
export async function removeSerialInstall(params: {
  installId: string;
  rmaId?: string | null;
  quarantine?: boolean;
  notes?: string | null;
  userId?: string;
}) {
  const install = await prisma.serialInstall.findUnique({
    where: { id: params.installId },
    include: { childSerial: true, parentSerial: true, childPart: true },
  });
  if (!install) throw new Error("Install record not found");
  if (install.status === "REMOVED") throw new Error("Already removed");

  const rmaId = params.rmaId || install.rmaId || null;

  const updated = await prisma.serialInstall.update({
    where: { id: install.id },
    data: {
      status: "REMOVED",
      removedAt: new Date(),
      removedById: params.userId || null,
      rmaId,
      notes: params.notes || install.notes,
    },
  });

  if (install.childSerialId) {
    await prisma.serialNumber.update({
      where: { id: install.childSerialId },
      data: {
        status: params.quarantine ? "QUARANTINE" : "ISSUED",
        parentSerialId: null,
      },
    });
  }

  await recordTrace({
    eventType: "SERIAL_REMOVE",
    partId: install.childPartId,
    serialNumber: install.childSerial?.serial,
    workOrderId: install.workOrderId || undefined,
    notes: `Removed from ${install.parentSerial.serial}`,
    userId: params.userId,
  });

  // Damaged / failed serialized components → NCR + MRB for disposition
  let mrbCase: { id: string; number: string } | null = null;
  if (params.quarantine) {
    mrbCase = await openMrbForTornDownSerial({
      partId: install.childPartId,
      serialId: install.childSerialId,
      serial: install.childSerial?.serial || null,
      workOrderId: install.workOrderId,
      rmaId,
      parentSerial: install.parentSerial.serial,
      notes: params.notes,
      userId: params.userId,
    });
  }

  return { install: updated, mrbCase };
}

/**
 * Open NCR + MRB for a component pulled from as-built (RMA tear-down or scrap hold).
 * Disposition (SCRAP / REPAIR / REWORK) is decided on the MRB board.
 */
export async function openMrbForTornDownSerial(params: {
  partId: string;
  serialId?: string | null;
  serial?: string | null;
  workOrderId?: string | null;
  rmaId?: string | null;
  parentSerial?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  let rmaNumber: string | null = null;
  if (params.rmaId) {
    const rma = await prisma.rma.findUnique({
      where: { id: params.rmaId },
      select: { number: true },
    });
    rmaNumber = rma?.number || null;
  }

  const snLabel = params.serial || "unserialized";
  const ncrCount = await prisma.nonConformance.count();
  const ncr = await prisma.nonConformance.create({
    data: {
      number: `NCR-${String(ncrCount + 1).padStart(5, "0")}`,
      title: `As-built tear-down — ${snLabel}`,
      description: [
        params.notes || "Serialized component removed for MRB disposition.",
        params.parentSerial ? `Removed from parent SN ${params.parentSerial}` : null,
        rmaNumber ? `Linked RMA ${rmaNumber}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: "MRB",
      severity: "MAJOR",
      source: params.rmaId ? "CUSTOMER" : "IN_PROCESS",
      partId: params.partId,
      workOrderId: params.workOrderId || null,
      serialNumber: params.serial || null,
      quantity: 1,
      createdById: params.userId || null,
    },
  });

  const mrbCount = await prisma.mrbCase.count();
  const mrb = await prisma.mrbCase.create({
    data: {
      number: `MRB-${String(mrbCount + 1).padStart(5, "0")}`,
      ncrId: ncr.id,
      status: "OPEN",
      chairId: params.userId || null,
      notes: rmaNumber
        ? `RMA ${rmaNumber} tear-down — disposition: SCRAP (order/pull replacement) or REPAIR/REWORK (return to RMA WO when done).`
        : "As-built tear-down hold",
      rmaId: params.rmaId || null,
      serialId: params.serialId || null,
    },
  });

  if (params.rmaId) {
    await prisma.rma.update({
      where: { id: params.rmaId },
      data: { status: "MRB_HOLD" },
    });
  }

  await logAudit({
    entityType: "MrbCase",
    entityId: mrb.id,
    action: "CREATED_FROM_TEARDOWN",
    userId: params.userId,
    metadata: {
      ncrId: ncr.id,
      serial: params.serial,
      rmaId: params.rmaId,
    },
  });

  return { id: mrb.id, number: mrb.number };
}

/** Recursive as-built tree from top serial. */
export async function getSerialTree(
  serialOrId: string,
  options?: { includeRemoved?: boolean }
): Promise<SerialTreeNode | null> {
  const sn = await prisma.serialNumber.findFirst({
    where: {
      OR: [{ id: serialOrId }, { serial: serialOrId.trim().toUpperCase() }],
    },
    include: { part: { select: { partNumber: true, description: true } } },
  });
  if (!sn) return null;

  async function build(parentId: string): Promise<SerialTreeNode["children"]> {
    const edges = await prisma.serialInstall.findMany({
      where: {
        parentSerialId: parentId,
        ...(options?.includeRemoved ? {} : { status: "INSTALLED" }),
      },
      orderBy: { installedAt: "asc" },
      include: {
        childPart: { select: { partNumber: true, description: true } },
        childSerial: true,
      },
    });
    const nodes: SerialTreeNode[] = [];
    for (const e of edges) {
      if (e.childSerialId && e.childSerial) {
        const kids = await build(e.childSerialId);
        nodes.push({
          serialId: e.childSerialId,
          serial: e.childSerial.serial,
          partId: e.childPartId,
          partNumber: e.childPart.partNumber,
          partName: e.childPart.description,
          status: e.status === "REMOVED" ? "REMOVED" : e.childSerial.status,
          installId: e.id,
          quantity: e.quantity,
          lotNumber: e.childLotNumber,
          installedAt: e.installedAt,
          children: kids,
        });
      } else {
        nodes.push({
          serialId: "",
          serial: e.childLotNumber ? `LOT:${e.childLotNumber}` : "(non-serialized)",
          partId: e.childPartId,
          partNumber: e.childPart.partNumber,
          partName: e.childPart.description,
          status: e.status,
          installId: e.id,
          quantity: e.quantity,
          lotNumber: e.childLotNumber,
          installedAt: e.installedAt,
          children: [],
        });
      }
    }
    return nodes;
  }

  return {
    serialId: sn.id,
    serial: sn.serial,
    partId: sn.partId,
    partNumber: sn.part.partNumber,
    partName: sn.part.description,
    status: sn.status,
    children: await build(sn.id),
  };
}

export async function whereUsedSerial(serialOrId: string) {
  const sn = await prisma.serialNumber.findFirst({
    where: {
      OR: [{ id: serialOrId }, { serial: serialOrId.trim().toUpperCase() }],
    },
  });
  if (!sn) return [];
  return prisma.serialInstall.findMany({
    where: { childSerialId: sn.id },
    orderBy: { installedAt: "desc" },
    include: {
      parentSerial: {
        include: { part: { select: { partNumber: true, description: true } } },
      },
    },
  });
}

export async function findSerial(serial: string) {
  return prisma.serialNumber.findUnique({
    where: { serial: serial.trim().toUpperCase() },
    include: {
      part: true,
      customer: { select: { id: true, code: true, name: true } },
      installsAsParent: {
        where: { status: "INSTALLED" },
        include: {
          childPart: { select: { partNumber: true, description: true } },
          childSerial: true,
        },
      },
    },
  });
}

export async function listSerials(params?: {
  q?: string;
  partId?: string;
  status?: string;
  take?: number;
}) {
  const q = params?.q?.trim();
  return prisma.serialNumber.findMany({
    where: {
      ...(params?.partId ? { partId: params.partId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(q
        ? {
            OR: [
              { serial: { contains: q.toUpperCase() } },
              { lotNumber: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: params?.take ?? 100,
    include: {
      part: { select: { partNumber: true, description: true } },
      customer: { select: { code: true, name: true } },
    },
  });
}

/** Start warranty clock (typically at ship). */
export async function startWarranty(params: {
  serialId: string;
  asOf?: Date;
  customerId?: string | null;
  salesOrderId?: string | null;
  shipmentId?: string | null;
}) {
  const sn = await prisma.serialNumber.findUnique({
    where: { id: params.serialId },
    include: { part: true },
  });
  if (!sn) throw new Error("Serial not found");
  const start = params.asOf || new Date();
  const months = sn.part.warrantyMonths ?? 12;
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  return prisma.serialNumber.update({
    where: { id: sn.id },
    data: {
      warrantyStart: start,
      warrantyEnd: end,
      status: "SHIPPED",
      customerId: params.customerId ?? sn.customerId,
      salesOrderId: params.salesOrderId ?? sn.salesOrderId,
      shipmentId: params.shipmentId ?? sn.shipmentId,
    },
  });
}

export function evaluateWarranty(
  serial: {
    warrantyStart: Date | null;
    warrantyEnd: Date | null;
  },
  part: { warrantyMonths: number | null },
  asOf: Date = new Date()
): { eligible: boolean; reason: string; warrantyEnd: Date | null } {
  if (serial.warrantyEnd) {
    const ok = asOf <= serial.warrantyEnd;
    return {
      eligible: ok,
      reason: ok
        ? `In warranty until ${serial.warrantyEnd.toISOString().slice(0, 10)}`
        : `Warranty expired ${serial.warrantyEnd.toISOString().slice(0, 10)}`,
      warrantyEnd: serial.warrantyEnd,
    };
  }
  if (serial.warrantyStart) {
    const months = part.warrantyMonths ?? 12;
    const end = new Date(serial.warrantyStart);
    end.setMonth(end.getMonth() + months);
    const ok = asOf <= end;
    return {
      eligible: ok,
      reason: ok
        ? `In warranty until ${end.toISOString().slice(0, 10)} (from start date)`
        : `Warranty expired ${end.toISOString().slice(0, 10)}`,
      warrantyEnd: end,
    };
  }
  return {
    eligible: false,
    reason: "No warranty start/end on serial — manual coverage decision required",
    warrantyEnd: null,
  };
}
