import { controlPlaneClient } from "@/lib/db";
import {
  destroyTenant,
  demoPoolTarget,
  sweepIdleDemos,
} from "@/lib/services/tenancy";

const PROVISION_STALE_MS = 5 * 60_000;

/**
 * Stronger than sweepIdleDemos alone: also drop clones that died mid-provision
 * and READY pool entries beyond DEMO_POOL_SIZE. Call from cron so Hobby-tier
 * disk cannot refill with 100 abandoned schemas.
 */
export async function reapAbandonedDemos(maxIdleMinutes: number): Promise<{
  idle: number;
  stuck: number;
  extraReady: number;
}> {
  const idle = await sweepIdleDemos(maxIdleMinutes);
  const cp = controlPlaneClient();
  const provisionCutoff = new Date(Date.now() - PROVISION_STALE_MS);

  const stuckRows = await cp.tenant.findMany({
    where: {
      isDemo: true,
      status: "PROVISIONING",
      createdAt: { lt: provisionCutoff },
    },
    select: { schemaName: true },
    take: 25,
  });

  const ready = await cp.tenant.findMany({
    where: { isDemo: true, status: "READY" },
    select: { schemaName: true },
    orderBy: { createdAt: "asc" },
  });
  const extraReadyRows = ready.slice(0, Math.max(0, ready.length - demoPoolTarget()));

  let stuck = 0;
  let extraReady = 0;
  for (const t of stuckRows) {
    try {
      await destroyTenant(t.schemaName);
      stuck += 1;
    } catch {
      /* best-effort */
    }
  }
  for (const t of extraReadyRows) {
    try {
      await destroyTenant(t.schemaName);
      extraReady += 1;
    } catch {
      /* best-effort */
    }
  }
  return { idle, stuck, extraReady };
}
