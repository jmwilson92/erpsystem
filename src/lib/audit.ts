"use server";

import { prisma } from "./db";

/**
 * Source address for the audit record.
 *
 * NIST SP 800-171 3.3.1 expects audit records to say where an action came from,
 * and AuditLog.ipAddress existed as a column that nothing ever wrote — so every
 * record was missing that field silently.
 *
 * Prefers the left-most x-forwarded-for hop, which is the client as seen by the
 * first proxy (Caddy on-premise, Vercel's edge hosted). Returns null outside a
 * request scope — seeds and scripts legitimately have no source address, and a
 * missing value is more honest than inventing one.
 */
async function requestIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    return h.get("x-real-ip")?.trim()?.slice(0, 64) || null;
  } catch {
    return null;
  }
}

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
        ipAddress: await requestIp(),
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
