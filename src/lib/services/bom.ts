import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { verifySignaturePin } from "./signature-pin";

/**
 * Certify a drawing-originated BOM for PROTOTYPE. This is the first gate:
 * an in-work (DRAFT/IN_REVIEW) BOM is locked as prototype-certified, which
 * allows the originating drawing ECR to be RELEASED and a prototype WO to run.
 * Full production certification happens later via `certifyBom`.
 */
export async function certifyBomForPrototype(params: {
  bomHeaderId: string;
  /** Compatibility only; signer always comes from the authenticated session. */
  userId?: string;
  notes?: string;
  pinCode?: string;
}) {
  const signer = await requirePermission("bom.certify");
  await verifySignaturePin(signer.id, params.pinCode);
  const bom = await prisma.bomHeader.findUnique({
    where: { id: params.bomHeaderId },
    include: { part: true },
  });
  if (!bom) throw new Error("BOM not found");

  if (!["DRAFT", "IN_REVIEW"].includes(bom.status)) {
    throw new Error(
      `Only DRAFT or IN_REVIEW BOMs can be certified for prototype. Current status: ${bom.status}`
    );
  }
  const changes = { from: bom.status, to: "PROTOTYPE", revision: bom.revision,
    partNumber: bom.part.partNumber, certificationPath: "PROTOTYPE", pinVerified: true, signerName: signer.name };
  const certified = await prisma.$transaction(async (tx) => {
    const result = await tx.bomHeader.update({
      where: { id: bom.id, updatedAt: bom.updatedAt },
      data: { status: "PROTOTYPE", isPrototype: true, prototypeRequired: true,
        prototypeCertifiedAt: new Date(), prototypeCertifiedById: signer.id, notes: params.notes || bom.notes },
    });
    await tx.auditLog.create({ data: { entityType: "BomHeader", entityId: bom.id, action: "PROTOTYPE_CERTIFIED", userId: signer.id, changes: JSON.stringify(changes) } });
    return result;
  });

  return certified;
}

export async function certifyBom(params: {
  bomHeaderId: string;
  /** Compatibility only; signer always comes from the authenticated session. */
  userId?: string;
  notes?: string;
  pinCode?: string;
}) {
  const signer = await requirePermission("bom.certify");
  await verifySignaturePin(signer.id, params.pinCode);
  const bom = await prisma.bomHeader.findUnique({
    where: { id: params.bomHeaderId },
    include: { part: true },
  });
  if (!bom) throw new Error("BOM not found");

  if (!["DRAFT", "PROTOTYPE", "IN_REVIEW"].includes(bom.status)) {
    throw new Error(
      `Only DRAFT, IN_REVIEW or PROTOTYPE BOMs can be certified for production. Current status: ${bom.status}`
    );
  }

  if (bom.prototypeRequired) {
    // The prototype-required path retains the completed build and released-WI gates. A prototype
    // WO is created from the prototype-certified BOM and must reach COMPLETED
    // before the BOM can graduate to production.
    const completedProto = await prisma.workOrder.findFirst({
      where: {
        bomHeaderId: bom.id,
        type: "PROTOTYPE",
        status: "COMPLETED",
      },
      select: { id: true, number: true },
    });
    if (!completedProto) {
      throw new Error(
        "Production certification is blocked until a prototype work order for this BOM is COMPLETED. Create a prototype WO, build it, and complete it first."
      );
    }

    // Released work instruction must be on file (CM released after prototype build)
    const releasedWi = await prisma.workInstruction.findFirst({
      where: {
        partId: bom.partId,
        status: "RELEASED",
      },
      select: { id: true, documentNumber: true, revision: true },
    });
    if (!releasedWi) {
      throw new Error(
        "Production certification needs a RELEASED work instruction for this part. Finish the prototype WO (submits WI to CM), then release the WI from CM submissions."
      );
    }

  }

  const changes = { from: bom.status, to: "CERTIFIED", revision: bom.revision, partNumber: bom.part.partNumber,
    certificationPath: bom.prototypeRequired ? "PROTOTYPE" : "DIRECT", prototypeRequired: bom.prototypeRequired,
    pinVerified: true, signerName: signer.name };
  // Certification + obsoleting the previous revision + signature evidence are atomic.
  const certified = await prisma.$transaction(async (tx) => {
    await tx.bomHeader.updateMany({
      where: { partId: bom.partId, status: "CERTIFIED", id: { not: bom.id } },
      data: { status: "OBSOLETE", obsoleteDate: new Date() },
    });
    const result = await tx.bomHeader.update({
      where: { id: bom.id, updatedAt: bom.updatedAt },
      data: { status: "CERTIFIED", isPrototype: false, certifiedAt: new Date(), certifiedById: signer.id,
        effectiveDate: new Date(), notes: params.notes || bom.notes },
    });
    await tx.auditLog.create({ data: { entityType: "BomHeader", entityId: bom.id, action: "CERTIFIED", userId: signer.id, changes: JSON.stringify(changes) } });
    return result;
  });

  return certified;
}


/** Choose the certification route before the revision is locked. */
export async function setBomPrototypeRequirement(bomHeaderId: string, prototypeRequired: boolean) {
  const user = await requirePermission("bom.certify");
  if (typeof prototypeRequired !== "boolean") throw new Error("Choose a valid certification path");
  const bom = await prisma.bomHeader.findUnique({ where: { id: bomHeaderId } });
  if (!bom) throw new Error("BOM not found");
  if (!["DRAFT", "IN_REVIEW", "PROTOTYPE"].includes(bom.status)) {
    throw new Error("Cannot change the certification path of a certified or obsolete BOM — create a new revision");
  }
  const updated = await prisma.bomHeader.update({
    where: { id: bom.id, updatedAt: bom.updatedAt }, data: { prototypeRequired },
  });
  await logAudit({ entityType: "BomHeader", entityId: bom.id, action: "CERTIFICATION_PATH_CHANGED", userId: user.id,
    changes: { from: bom.prototypeRequired ? "PROTOTYPE" : "DIRECT", to: prototypeRequired ? "PROTOTYPE" : "DIRECT", revision: bom.revision } });
  return updated;
}

export async function setBomPrototypeDefault(prototypeRequired: boolean) {
  const user = await requirePermission("admin.permissions");
  if (typeof prototypeRequired !== "boolean") throw new Error("Choose a valid certification path");
  const before = await prisma.companySettings.findUnique({ where: { id: "default" } });
  await prisma.companySettings.upsert({ where: { id: "default" },
    create: { id: "default", bomPrototypeRequired: prototypeRequired, updatedById: user.id },
    update: { bomPrototypeRequired: prototypeRequired, updatedById: user.id } });
  await logAudit({ entityType: "CompanySettings", entityId: "default", action: "BOM_CERTIFICATION_DEFAULT_CHANGED", userId: user.id,
    changes: { from: before?.bomPrototypeRequired ?? true, to: prototypeRequired } });
}

export async function createBomRevision(params: {
  partId: string;
  fromBomId?: string;
  revision: string;
  asPrototype?: boolean;
  prototypeRequired?: boolean;
  description?: string;
  drawingNumber?: string;
  originEcrNumber?: string;
  lines?: { componentPartId: string; quantity: number; findNumber?: string; notes?: string }[];
  userId?: string;
}) {
  const existing = await prisma.bomHeader.findUnique({
    where: {
      partId_revision: { partId: params.partId, revision: params.revision },
    },
  });
  if (existing) throw new Error(`Revision ${params.revision} already exists`);

  let lines = params.lines || [];
  if (params.fromBomId && lines.length === 0) {
    const from = await prisma.bomLine.findMany({
      where: { bomHeaderId: params.fromBomId },
    });
    lines = from.map((l) => ({
      componentPartId: l.componentPartId,
      quantity: l.quantity,
      findNumber: l.findNumber || undefined,
      notes: l.notes || undefined,
    }));
  }

  if (lines.some(l => !Number.isFinite(l.quantity) || l.quantity <= 0)) throw new Error("Quantity must be finite and > 0");
  const company = await prisma.companySettings.findUnique({
    where: { id: "default" }, select: { bomPrototypeRequired: true },
  });
  const prototypeRequired = params.asPrototype ? true : (params.prototypeRequired ?? company?.bomPrototypeRequired ?? true);
  const bom = await prisma.bomHeader.create({
    data: {
      partId: params.partId,
      revision: params.revision,
      status: "DRAFT",
      prototypeRequired,
      isPrototype: params.asPrototype || false,
      description: params.description,
      drawingNumber: params.drawingNumber,
      originEcrNumber: params.originEcrNumber,
      lines: {
        create: lines.map((l, i) => ({
          componentPartId: l.componentPartId,
          quantity: l.quantity,
          findNumber: l.findNumber,
          notes: l.notes,
          sortOrder: i + 1,
        })),
      },
    },
    include: { lines: { include: { componentPart: true } }, part: true },
  });

  await logAudit({
    entityType: "BomHeader",
    entityId: bom.id,
    action: "CREATED",
    userId: params.userId,
    metadata: {
      revision: params.revision,
      prototype: params.asPrototype,
      certificationPath: prototypeRequired ? "PROTOTYPE" : "DIRECT",
      lineCount: lines.length,
    },
  });

  return bom;
}

export async function compareBomRevisions(bomIdA: string, bomIdB: string) {
  const [a, b] = await Promise.all([
    prisma.bomHeader.findUnique({
      where: { id: bomIdA },
      include: { lines: { include: { componentPart: true } }, part: true },
    }),
    prisma.bomHeader.findUnique({
      where: { id: bomIdB },
      include: { lines: { include: { componentPart: true } }, part: true },
    }),
  ]);
  if (!a || !b) throw new Error("BOM not found");

  const mapA = new Map(a.lines.map((l) => [l.componentPart.partNumber, l]));
  const mapB = new Map(b.lines.map((l) => [l.componentPart.partNumber, l]));

  const added: typeof b.lines = [];
  const removed: typeof a.lines = [];
  const changed: { partNumber: string; fromQty: number; toQty: number }[] = [];

  for (const [pn, line] of mapB) {
    if (!mapA.has(pn)) added.push(line);
    else {
      const prev = mapA.get(pn)!;
      if (prev.quantity !== line.quantity) {
        changed.push({
          partNumber: pn,
          fromQty: prev.quantity,
          toQty: line.quantity,
        });
      }
    }
  }
  for (const [pn, line] of mapA) {
    if (!mapB.has(pn)) removed.push(line);
  }

  return {
    a: { id: a.id, revision: a.revision, status: a.status },
    b: { id: b.id, revision: b.revision, status: b.status },
    added,
    removed,
    changed,
  };
}

export async function whereUsed(partId: string) {
  return prisma.bomLine.findMany({
    where: { componentPartId: partId },
    include: {
      bomHeader: { include: { part: true } },
      componentPart: true,
    },
  });
}

/** Create or revise a BOM for an item (item card BOM tab). */
export async function createOrLinkBom(params: {
  partId: string;
  revision: string;
  description?: string;
  asPrototype?: boolean;
  copyFromBomId?: string;
  userId?: string;
}) {
  return createBomRevision({
    partId: params.partId,
    revision: params.revision.trim().toUpperCase(),
    description: params.description,
    asPrototype: params.asPrototype,
    fromBomId: params.copyFromBomId,
    userId: params.userId,
  });
}

export async function addBomLine(params: {
  bomHeaderId: string;
  componentPartId: string;
  quantity: number;
  uom?: string;
  findNumber?: string;
  notes?: string;
  userId?: string;
}) {
  const bom = await prisma.bomHeader.findUnique({
    where: { id: params.bomHeaderId },
    include: { lines: true },
  });
  if (!bom) throw new Error("BOM not found");
  if (["CERTIFIED", "OBSOLETE"].includes(bom.status)) {
    throw new Error("Cannot edit certified or obsolete BOMs — create a new revision");
  }
  if (params.componentPartId === bom.partId) {
    throw new Error("BOM cannot include itself as a component");
  }
  if (!Number.isFinite(params.quantity) || !(params.quantity > 0)) throw new Error("Quantity must be > 0");

  const component = await prisma.part.findUnique({
    where: { id: params.componentPartId },
    select: { uom: true },
  });
  const uom =
    (params.uom || component?.uom || "EA").trim().toUpperCase() || "EA";

  const maxSort = bom.lines.reduce((m, l) => Math.max(m, l.sortOrder), 0);
  const line = await prisma.bomLine.create({
    data: {
      bomHeaderId: params.bomHeaderId,
      componentPartId: params.componentPartId,
      quantity: params.quantity,
      uom,
      findNumber: params.findNumber || null,
      notes: params.notes || null,
      sortOrder: maxSort + 1,
    },
    include: { componentPart: true },
  });

  await logAudit({
    entityType: "BomHeader",
    entityId: params.bomHeaderId,
    action: "LINE_ADDED",
    userId: params.userId,
    metadata: {
      componentPartId: params.componentPartId,
      quantity: params.quantity,
      uom,
    },
  });
  return line;
}

export async function updateBomLine(params: {
  bomLineId: string;
  quantity?: number;
  findNumber?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  if (params.quantity !== undefined && (!Number.isFinite(params.quantity) || params.quantity <= 0)) throw new Error("Quantity must be finite and > 0");
  const line = await prisma.bomLine.findUnique({
    where: { id: params.bomLineId },
    include: { bomHeader: true },
  });
  if (!line) throw new Error("BOM line not found");
  if (["CERTIFIED", "OBSOLETE"].includes(line.bomHeader.status)) {
    throw new Error("Cannot edit certified or obsolete BOMs — create a new revision");
  }

  return prisma.bomLine.update({
    where: { id: params.bomLineId },
    data: {
      ...(params.quantity !== undefined ? { quantity: params.quantity } : {}),
      ...(params.findNumber !== undefined ? { findNumber: params.findNumber } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });
}

export async function removeBomLine(params: {
  bomLineId: string;
  userId?: string;
}) {
  const line = await prisma.bomLine.findUnique({
    where: { id: params.bomLineId },
    include: { bomHeader: true },
  });
  if (!line) throw new Error("BOM line not found");
  if (["CERTIFIED", "OBSOLETE"].includes(line.bomHeader.status)) {
    throw new Error("Cannot edit certified or obsolete BOMs — create a new revision");
  }
  await prisma.bomLine.delete({ where: { id: params.bomLineId } });
  await logAudit({
    entityType: "BomHeader",
    entityId: line.bomHeaderId,
    action: "LINE_REMOVED",
    userId: params.userId,
    metadata: { bomLineId: params.bomLineId },
  });
}
