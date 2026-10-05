import { clientForSchema, isValidSchemaName } from "@/lib/db";

/**
 * Read-only adoption snapshot for one customer workspace.
 *
 * Claimed when the control-plane setup token has been consumed
 * (`setupTokenHash` is null) or the tenant schema has an INSTANCE_CLAIMED
 * audit row. Login is the latest AuthSession.lastSeenAt. Counts and the last
 * audit timestamp come from that schema only — a failure is recorded on the
 * row so one broken tenant cannot take down the registry page.
 */
export type TenantActivitySource = {
  id: string;
  schemaName: string;
  isDemo: boolean;
  setupTokenHash: string | null;
  setupTokenExpiresAt: Date | null;
};

export type TenantUsageCounts = {
  parts: number;
  boms: number;
  workOrders: number;
  nonConformances: number;
};

export type ClaimReason = "demo" | "audit" | "token_consumed" | "pending";

export type TenantActivity = {
  claimed: boolean;
  claimReason: ClaimReason;
  claimedAt: Date | null;
  linkExpiresAt: Date | null;
  lastLoginAt: Date | null;
  lastAuditAt: Date | null;
  counts: TenantUsageCounts | null;
  /** Schema could not be read. Claim state may still come from the registry. */
  unavailable: boolean;
};

const SKIP_SCHEMAS = new Set(["public", "demo_template"]);

type SchemaRead = {
  instanceClaimedAt: Date | null;
  lastLoginAt: Date | null;
  lastAuditAt: Date | null;
  counts: TenantUsageCounts;
};

export function deriveClaim(input: {
  isDemo: boolean;
  setupTokenHash: string | null;
  instanceClaimedAt: Date | null;
}): Pick<TenantActivity, "claimed" | "claimReason" | "claimedAt"> {
  if (input.isDemo) {
    return { claimed: false, claimReason: "demo", claimedAt: null };
  }
  if (input.instanceClaimedAt) {
    return {
      claimed: true,
      claimReason: "audit",
      claimedAt: input.instanceClaimedAt,
    };
  }
  if (input.setupTokenHash == null) {
    return { claimed: true, claimReason: "token_consumed", claimedAt: null };
  }
  return { claimed: false, claimReason: "pending", claimedAt: null };
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asCount(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function readSchema(schemaName: string): Promise<SchemaRead> {
  if (!isValidSchemaName(schemaName) || SKIP_SCHEMAS.has(schemaName)) {
    throw new Error("schema not readable");
  }
  // clientForSchema qualifies every model query to this Postgres schema.
  // One failure rejects the batch; the caller records the tenant as unread.
  const db = clientForSchema(schemaName);
  const [claim, session, parts, boms, workOrders, nonConformances, audit] =
    await Promise.all([
      db.auditLog.findFirst({
        where: { action: "INSTANCE_CLAIMED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      db.authSession.aggregate({ _max: { lastSeenAt: true } }),
      db.part.count(),
      db.bomHeader.count(),
      db.workOrder.count(),
      db.nonConformance.count(),
      db.auditLog.aggregate({ _max: { createdAt: true } }),
    ]);
  return {
    instanceClaimedAt: asDate(claim?.createdAt),
    lastLoginAt: asDate(session._max.lastSeenAt),
    lastAuditAt: asDate(audit._max.createdAt),
    counts: {
      parts: asCount(parts),
      boms: asCount(boms),
      workOrders: asCount(workOrders),
      nonConformances: asCount(nonConformances),
    },
  };
}

function emptyActivity(
  tenant: TenantActivitySource,
  claim: Pick<TenantActivity, "claimed" | "claimReason" | "claimedAt">,
  unavailable: boolean
): TenantActivity {
  return {
    ...claim,
    linkExpiresAt: tenant.setupTokenExpiresAt,
    lastLoginAt: null,
    lastAuditAt: null,
    counts: null,
    unavailable,
  };
}

/** One tenant. Demo sandboxes are labeled and not queried. */
export async function loadTenantActivity(
  tenant: TenantActivitySource
): Promise<TenantActivity> {
  if (tenant.isDemo) {
    return emptyActivity(
      tenant,
      deriveClaim({
        isDemo: true,
        setupTokenHash: tenant.setupTokenHash,
        instanceClaimedAt: null,
      }),
      false
    );
  }

  try {
    const read = await readSchema(tenant.schemaName);
    const claim = deriveClaim({
      isDemo: false,
      setupTokenHash: tenant.setupTokenHash,
      instanceClaimedAt: read.instanceClaimedAt,
    });
    return {
      ...claim,
      linkExpiresAt: tenant.setupTokenExpiresAt,
      lastLoginAt: read.lastLoginAt,
      lastAuditAt: read.lastAuditAt,
      counts: read.counts,
      unavailable: false,
    };
  } catch {
    // Do not log the driver error — Prisma messages often include the
    // connection string. The registry page shows this row as unavailable.
    return emptyActivity(
      tenant,
      deriveClaim({
        isDemo: false,
        setupTokenHash: tenant.setupTokenHash,
        instanceClaimedAt: null,
      }),
      true
    );
  }
}

/** Bounded fan-out so a long registry does not open every schema at once. */
export async function loadTenantActivities(
  tenants: TenantActivitySource[]
): Promise<Map<string, TenantActivity>> {
  const out = new Map<string, TenantActivity>();
  const limit = 5;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= tenants.length) return;
      const tenant = tenants[i];
      out.set(tenant.id, await loadTenantActivity(tenant));
    }
  }
  const workers = Math.min(limit, tenants.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
