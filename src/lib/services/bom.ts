"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function certifyBom(params: {
  bomHeaderId: string;
  userId?: string;
  notes?: string;
}) {
  const bom = await prisma.bomHeader.findUnique({
    where: { id: params.bomHeaderId },
    include: { part: true },
  });
  if (!bom) throw new Error("BOM not found");

  if (!["PROTOTYPE", "IN_REVIEW"].includes(bom.status)) {
    throw new Error(
      `Only PROTOTYPE or IN_REVIEW BOMs can be certified. Current status: ${bom.status}`
    );
  }

  // Obsolete previous certified revisions for same part
  await prisma.bomHeader.updateMany({
    where: {
      partId: bom.partId,
      status: "CERTIFIED",
      id: { not: bom.id },
    },
    data: {
      status: "OBSOLETE",
      obsoleteDate: new Date(),
    },
  });

  const certified = await prisma.bomHeader.update({
    where: { id: bom.id },
    data: {
      status: "CERTIFIED",
      isPrototype: false,
      certifiedAt: new Date(),
      certifiedById: params.userId,
      effectiveDate: new Date(),
      notes: params.notes || bom.notes,
    },
  });

  await logAudit({
    entityType: "BomHeader",
    entityId: bom.id,
    action: "CERTIFIED",
    userId: params.userId,
    changes: {
      from: bom.status,
      to: "CERTIFIED",
      revision: bom.revision,
      partNumber: bom.part.partNumber,
    },
  });

  return certified;
}

export async function createBomRevision(params: {
  partId: string;
  fromBomId?: string;
  revision: string;
  asPrototype?: boolean;
  description?: string;
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

  const bom = await prisma.bomHeader.create({
    data: {
      partId: params.partId,
      revision: params.revision,
      status: params.asPrototype ? "PROTOTYPE" : "DRAFT",
      isPrototype: params.asPrototype || false,
      description: params.description,
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
