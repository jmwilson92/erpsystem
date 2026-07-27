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

  // Mirror the action into control-plane telemetry for demo sessions only.
  // logAudit is the chokepoint every meaningful ERP write already goes through,
  // so this gives "what did test drivers actually do" without instrumenting
  // dozens of call sites — and without touching a customer's audit trail (their
  // AuditLog stays the record; we log nothing for real tenants here).
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const demo = jar.get("forge-demo")?.value;
    if (demo && !jar.get("forge-session")?.value) {
      const { trackEvent } = await import("./services/telemetry");
      trackEvent({
        kind: "ACTION",
        source: "DEMO",
        sessionId: demo,
        schemaName: demo,
        // Entity + verb only — never ids or field values.
        label: `${params.entityType}.${params.action}`.toLowerCase(),
      });
    }
  } catch {
    // Outside a request scope (scripts/seed) or telemetry down — ignore.
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
