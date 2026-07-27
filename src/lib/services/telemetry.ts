/**
 * Product telemetry — how the demo and the app actually get used, and what
 * breaks.
 *
 * Two rules this module never violates:
 *  1. **Never break a real request.** Every write is fire-and-forget and
 *     swallows its own errors. Telemetry failing must never surface to a
 *     visitor or fail a checkout/provisioning path.
 *  2. **Always the control plane.** Demo sandboxes are dropped when the
 *     visitor leaves, so writing events into the request's schema would delete
 *     the very data we want. Everything lands in `public` via
 *     controlPlaneClient.
 *
 * Deliberately anonymous: no names, emails, or customer business records — a
 * session id (the throwaway demo schema name), a route, and a short label.
 */
import { controlPlaneClient } from "@/lib/db";

export type TelemetryKind =
  | "DEMO_START"
  | "DEMO_END"
  | "PAGE"
  | "ACTION"
  | "ERROR"
  | "CONVERT";

export type TelemetrySource = "DEMO" | "TENANT" | "MARKETING" | "PLATFORM";

export type TelemetryInput = {
  kind: TelemetryKind;
  source?: TelemetrySource;
  sessionId?: string | null;
  schemaName?: string | null;
  path?: string | null;
  label?: string | null;
  detail?: Record<string, unknown> | null;
  severity?: "error" | "warn" | null;
};

/** Trim to keep one bad payload from bloating the table. */
function clip(v: string | null | undefined, max: number): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Strip the query string so paths group cleanly (and can't carry tokens). */
function cleanPath(p: string | null | undefined): string | null {
  const s = clip(p, 300);
  if (!s) return null;
  const q = s.indexOf("?");
  return q === -1 ? s : s.slice(0, q);
}

/**
 * Record one event. Always safe to call — awaiting is optional and failures are
 * swallowed. Callers on a hot path should not await.
 */
export async function recordEvent(input: TelemetryInput): Promise<void> {
  try {
    let detail: string | null = null;
    if (input.detail) {
      try {
        detail = clip(JSON.stringify(input.detail), 2000);
      } catch {
        detail = null;
      }
    }
    await controlPlaneClient().telemetryEvent.create({
      data: {
        kind: input.kind,
        source: input.source ?? "DEMO",
        sessionId: clip(input.sessionId, 100),
        schemaName: clip(input.schemaName, 100),
        path: cleanPath(input.path),
        label: clip(input.label, 500),
        detail,
        severity: input.severity ?? null,
      },
    });
  } catch {
    // Telemetry is best-effort by design — never surface or rethrow.
  }
}

/** Fire-and-forget helper for request paths that must not wait on a write. */
export function trackEvent(input: TelemetryInput): void {
  void recordEvent(input).catch(() => undefined);
}

// ─── Dashboard queries ──────────────────────────────────────────

export type InsightsWindow = 1 | 7 | 30;

function since(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export type DemoFunnel = {
  started: number;
  ended: number;
  converted: number;
  /** Median session length in minutes across ended demos (null if none). */
  medianMinutes: number | null;
  /** started -> clicked "start your own instance" */
  convertRate: number;
};

/**
 * Demo funnel over the window: how many test drives started, how many were
 * explicitly ended, how long they lasted, and how many clicked through to
 * signup.
 */
export async function getDemoFunnel(days: InsightsWindow): Promise<DemoFunnel> {
  const db = controlPlaneClient();
  const from = since(days);
  try {
    const [started, ended, converted, endedRows] = await Promise.all([
      db.telemetryEvent.count({ where: { kind: "DEMO_START", createdAt: { gte: from } } }),
      db.telemetryEvent.count({ where: { kind: "DEMO_END", createdAt: { gte: from } } }),
      db.telemetryEvent.count({ where: { kind: "CONVERT", createdAt: { gte: from } } }),
      db.telemetryEvent.findMany({
        where: { kind: "DEMO_END", createdAt: { gte: from }, detail: { not: null } },
        select: { detail: true },
        take: 500,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const mins: number[] = [];
    for (const r of endedRows) {
      try {
        const d = JSON.parse(r.detail || "{}") as { minutes?: number };
        if (typeof d.minutes === "number" && d.minutes >= 0) mins.push(d.minutes);
      } catch {
        /* ignore malformed */
      }
    }
    mins.sort((a, b) => a - b);
    const medianMinutes = mins.length
      ? Math.round(mins[Math.floor(mins.length / 2)] * 10) / 10
      : null;

    return {
      started,
      ended,
      converted,
      medianMinutes,
      convertRate: started > 0 ? Math.round((converted / started) * 100) : 0,
    };
  } catch {
    return { started: 0, ended: 0, converted: 0, medianMinutes: null, convertRate: 0 };
  }
}

export type Counted = { key: string; count: number };

/** Most-visited routes (demo traffic), most popular first. */
export async function getTopPages(days: InsightsWindow, limit = 12): Promise<Counted[]> {
  try {
    const rows = await controlPlaneClient().telemetryEvent.groupBy({
      by: ["path"],
      where: { kind: "PAGE", createdAt: { gte: since(days) }, path: { not: null } },
      _count: { path: true },
      orderBy: { _count: { path: "desc" } },
      take: limit,
    });
    return rows
      .filter((r) => r.path)
      .map((r) => ({ key: r.path as string, count: r._count.path }));
  } catch {
    return [];
  }
}

/** Milestone actions people actually completed in a test drive. */
export async function getTopActions(days: InsightsWindow, limit = 12): Promise<Counted[]> {
  try {
    const rows = await controlPlaneClient().telemetryEvent.groupBy({
      by: ["label"],
      where: { kind: "ACTION", createdAt: { gte: since(days) }, label: { not: null } },
      _count: { label: true },
      orderBy: { _count: { label: "desc" } },
      take: limit,
    });
    return rows
      .filter((r) => r.label)
      .map((r) => ({ key: r.label as string, count: r._count.label }));
  } catch {
    return [];
  }
}

export type ErrorGroup = {
  label: string;
  count: number;
  lastSeen: Date;
  lastPath: string | null;
  source: string;
};

/** Errors grouped by message, worst offenders first. */
export async function getErrorGroups(
  days: InsightsWindow,
  limit = 20
): Promise<ErrorGroup[]> {
  try {
    const rows = await controlPlaneClient().telemetryEvent.findMany({
      where: { kind: "ERROR", createdAt: { gte: since(days) } },
      select: { label: true, path: true, source: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const map = new Map<string, ErrorGroup>();
    for (const r of rows) {
      const label = r.label || "(no message)";
      const hit = map.get(label);
      if (hit) {
        hit.count += 1;
      } else {
        map.set(label, {
          label,
          count: 1,
          lastSeen: r.createdAt,
          lastPath: r.path,
          source: r.source,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  } catch {
    return [];
  }
}

export type LiveDemo = {
  schemaName: string;
  startedAt: Date;
  lastActiveAt: Date;
  minutes: number;
  pages: number;
};

/**
 * Test drives with activity in the last `idleMinutes` — i.e. people who are
 * (almost certainly) on the demo right now.
 */
export async function getLiveDemos(idleMinutes = 10): Promise<LiveDemo[]> {
  try {
    const db = controlPlaneClient();
    const cutoff = new Date(Date.now() - idleMinutes * 60_000);
    const tenants = await db.tenant.findMany({
      where: { isDemo: true, status: "ACTIVE", lastActiveAt: { gte: cutoff } },
      select: { schemaName: true, createdAt: true, lastActiveAt: true },
      orderBy: { lastActiveAt: "desc" },
      take: 50,
    });
    if (tenants.length === 0) return [];

    const counts = await db.telemetryEvent.groupBy({
      by: ["sessionId"],
      where: {
        kind: "PAGE",
        sessionId: { in: tenants.map((t) => t.schemaName) },
      },
      _count: { sessionId: true },
    });
    const pageBySession = new Map(
      counts.map((c) => [c.sessionId as string, c._count.sessionId])
    );

    return tenants.map((t) => ({
      schemaName: t.schemaName,
      startedAt: t.createdAt,
      lastActiveAt: t.lastActiveAt,
      minutes: Math.max(
        0,
        Math.round((t.lastActiveAt.getTime() - t.createdAt.getTime()) / 60_000)
      ),
      pages: pageBySession.get(t.schemaName) ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Daily demo starts for a simple sparkline/bar strip. */
export async function getDailyStarts(days: InsightsWindow): Promise<Counted[]> {
  try {
    const rows = await controlPlaneClient().telemetryEvent.findMany({
      where: { kind: "DEMO_START", createdAt: { gte: since(days) } },
      select: { createdAt: true },
      take: 5000,
    });
    const byDay = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      const k = r.createdAt.toISOString().slice(0, 10);
      if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
    return [...byDay.entries()].map(([key, count]) => ({ key, count }));
  } catch {
    return [];
  }
}
