"use server";

import { prisma } from "./db";

export async function logAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        userId: params.userId || null,
        changes: params.changes ? JSON.stringify(params.changes) : null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    });
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}

export async function getAuditTrail(entityType: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
