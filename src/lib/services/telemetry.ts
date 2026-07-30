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
import { checkModuleHealth, isMissingTableError } from "@/lib/services/module-health";

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

export type TelemetryHealth =
  | { ok: true; total: number }
  | { ok: false; reason: "missing_table" | "unavailable"; detail: string };

/**
 * Is telemetry actually recording?
 *
 * Writes are deliberately fire-and-forget, which is right for a hot path but
 * means a missing table fails *silently* — the dashboard would just show zeros
 * forever and look like "nobody used the demo". This separates "set up, no data
 * yet" from "not set up", so the dashboard can say which.
 */
export async function getTelemetryHealth(): Promise<TelemetryHealth> {
  try {
    const total = await controlPlaneClient().telemetryEvent.count();
    return { ok: true, total };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Postgres 42P01 = undefined_table; Prisma surfaces it in the message.
    const missing =
      /42P01|does not exist|relation .* does not exist|Unknown table|TelemetryEvent/i.test(
        detail
      );
    return {
      ok: false,
      reason: missing ? "missing_table" : "unavailable",
      detail: detail.slice(0, 300),
    };
  }
}

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

export const ISSUE_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "ON_HOLD",
  "RESOLVED",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/**
 * How far an error reaches.
 *   TENANT    — one paying customer's schema, and only that one
 *   SYSTEM    — more than one schema, or a mix of demo and tenant: the bug is
 *               in the product, not in one customer's data
 *   DEMO      — test drives only
 *   MARKETING — public pages, nobody signed in
 *   PLATFORM  — your own dogfood schema
 * Blast radius is the first thing worth knowing about an error, so it's derived
 * here rather than left for someone to eyeball across rows.
 */
export type ErrorScope =
  | "TENANT"
  | "SYSTEM"
  | "DEMO"
  | "MARKETING"
  | "PLATFORM";

/**
 * Stable key for an error group.
 *
 * NOT the raw label. Error messages are multi-line, and a browser normalizes
 * line breaks to CRLF when it submits a form — so a raw label sent through a
 * hidden input comes back with different bytes than the one that was stored,
 * and the lookup silently misses. Collapsing every whitespace run to a single
 * space makes the key survive the round trip, and groups messages that differ
 * only in formatting.
 */
export function issueFingerprint(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 300);
}

export type ErrorGroup = {
  /** Round-trip-safe key — use this for triage writes, never the label. */
  fingerprint: string;
  label: string;
  count: number;
  lastSeen: Date;
  lastPath: string | null;
  source: string;
  /** Every source this error was seen from, e.g. ["TENANT", "DEMO"]. */
  sources: string[];
  scope: ErrorScope;
  /** Distinct schemas affected — 1 means isolated, more means systemic. */
  schemaCount: number;
  /** The single affected schema when scope is TENANT, else null. */
  schemaName: string | null;
  status: IssueStatus;
  note: string | null;
  /** RESOLVED but seen again since — it came back. */
  regressed: boolean;
};

function deriveScope(sources: Set<string>, tenantSchemas: Set<string>): ErrorScope {
  // Reaching more than one tenant means it isn't that customer's data.
  if (tenantSchemas.size > 1) return "SYSTEM";
  // Both a real customer and the demo hit it — same conclusion.
  if (sources.has("TENANT") && sources.size > 1) return "SYSTEM";
  if (sources.has("TENANT")) return "TENANT";
  if (sources.has("PLATFORM")) return "PLATFORM";
  if (sources.has("DEMO")) return "DEMO";
  if (sources.has("MARKETING")) return "MARKETING";
  return "SYSTEM";
}

/** Errors grouped by message, worst offenders first, with triage state. */
export async function getErrorGroups(
  days: InsightsWindow,
  limit = 20
): Promise<ErrorGroup[]> {
  try {
    const rows = await controlPlaneClient().telemetryEvent.findMany({
      where: { kind: "ERROR", createdAt: { gte: since(days) } },
      select: {
        label: true,
        path: true,
        source: true,
        schemaName: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    type Acc = {
      fingerprint: string;
      label: string;
      count: number;
      lastSeen: Date;
      lastPath: string | null;
      source: string;
      sources: Set<string>;
      tenantSchemas: Set<string>;
      allSchemas: Set<string>;
    };
    const map = new Map<string, Acc>();
    for (const r of rows) {
      const label = r.label || "(no message)";
      const fingerprint = issueFingerprint(label);
      let hit = map.get(fingerprint);
      if (!hit) {
        hit = {
          fingerprint,
          label,
          count: 0,
          lastSeen: r.createdAt, // rows are newest-first, so the first wins
          lastPath: r.path,
          source: r.source,
          sources: new Set(),
          tenantSchemas: new Set(),
          allSchemas: new Set(),
        };
        map.set(fingerprint, hit);
      }
      hit.count += 1;
      hit.sources.add(r.source);
      if (r.schemaName) {
        hit.allSchemas.add(r.schemaName);
        if (r.source === "TENANT") hit.tenantSchemas.add(r.schemaName);
      }
    }

    const top = [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    if (top.length === 0) return [];

    // One query for the triage state of everything we're about to show.
    const issues = await controlPlaneClient()
      .telemetryIssue.findMany({
        where: { fingerprint: { in: top.map((g) => g.fingerprint) } },
      })
      .catch(() => []);
    const byFingerprint = new Map(issues.map((i) => [i.fingerprint, i]));

    return top.map((g) => {
      const issue = byFingerprint.get(g.fingerprint);
      const status = (issue?.status as IssueStatus) || "NEW";
      const scope = deriveScope(g.sources, g.tenantSchemas);
      return {
        fingerprint: g.fingerprint,
        label: g.label,
        count: g.count,
        lastSeen: g.lastSeen,
        lastPath: g.lastPath,
        source: g.source,
        sources: [...g.sources].sort(),
        scope,
        schemaCount: g.allSchemas.size,
        schemaName:
          scope === "TENANT" && g.tenantSchemas.size === 1
            ? [...g.tenantSchemas][0]
            : null,
        status,
        note: issue?.note ?? null,
        regressed:
          status === "RESOLVED" &&
          !!issue?.resolvedAt &&
          g.lastSeen > issue.resolvedAt,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Can triage state be stored on this database yet?
 *
 * getErrorGroups deliberately swallows a missing TelemetryIssue table so the
 * dashboard still renders — but that would leave triage controls on screen that
 * throw the moment they're used. The page asks this so it can explain instead.
 */
export async function getIssueTrackingHealth() {
  return checkModuleHealth(() => controlPlaneClient().telemetryIssue.count());
}

/**
 * Set an error's triage state. Upserts on the fingerprint so the first time you
 * touch an error is also when its issue row is created.
 *
 * Returns false when the table isn't on this database — the caller's page shows
 * the migration banner, so a route error would add nothing. Any other failure
 * still throws: a genuine bug should be loud.
 */
export async function setIssueStatus(params: {
  fingerprint: string;
  status: IssueStatus;
  note?: string | null;
  userId?: string;
}): Promise<boolean> {
  // Normalised again here so a caller passing a raw label still lands on the
  // same key the dashboard reads back.
  const fingerprint = issueFingerprint(params.fingerprint);
  const resolvedAt = params.status === "RESOLVED" ? new Date() : null;
  const note = params.note?.trim() || null;
  const data = {
    status: params.status,
    note,
    resolvedAt,
    updatedById: params.userId || null,
  };
  try {
    const cp = controlPlaneClient();
    // Read the prior status BEFORE the upsert, or fromStatus would just be the
    // value we are about to write and the trail would show every change as a
    // no-op.
    const previous = await cp.telemetryIssue
      .findUnique({ where: { fingerprint }, select: { status: true } })
      .catch(() => null);

    const issue = await cp.telemetryIssue.upsert({
      where: { fingerprint },
      create: { fingerprint, ...data },
      update: data,
    });

    // History is best-effort on purpose: losing the trail entry is bad, but
    // refusing the status change because the history table is missing (an
    // un-migrated deployment) would be worse. The issue row is the source of
    // truth for current state; this is the record of how it got there.
    await cp.telemetryIssueEvent
      .create({
        data: {
          issueId: issue.id,
          fromStatus: previous?.status ?? null,
          toStatus: params.status,
          note,
          changedById: params.userId || null,
        },
      })
      .catch(() => undefined);

    return true;
  } catch (e) {
    if (isMissingTableError(e)) return false;
    throw e;
  }
}

export type IssueEvent = {
  id: string;
  fromStatus: IssueStatus | null;
  toStatus: IssueStatus;
  note: string | null;
  changedByName: string | null;
  createdAt: Date;
};

/**
 * Triage trails for several errors at once, each oldest-first.
 *
 * Batched rather than one call per row: the dashboard renders ten-plus errors,
 * and a per-issue lookup would be thirty round trips on a page that already
 * refreshes itself every minute.
 *
 * Returns an empty map rather than throwing when the table has not been
 * migrated yet, so a deployment running ahead of its migration shows current
 * statuses with no history instead of failing the whole dashboard.
 */
export async function getIssueHistories(
  fingerprints: string[]
): Promise<Map<string, IssueEvent[]>> {
  const out = new Map<string, IssueEvent[]>();
  if (fingerprints.length === 0) return out;
  try {
    const cp = controlPlaneClient();
    const keys = fingerprints.map(issueFingerprint);
    const issues = await cp.telemetryIssue.findMany({
      where: { fingerprint: { in: keys } },
      select: { id: true, fingerprint: true },
    });
    if (issues.length === 0) return out;

    const fingerprintByIssueId = new Map(issues.map((i) => [i.id, i.fingerprint]));
    const rows = await cp.telemetryIssueEvent.findMany({
      where: { issueId: { in: issues.map((i) => i.id) } },
      orderBy: { createdAt: "asc" },
    });

    // Names resolved separately: changedById points at a platform user, and a
    // deleted account should degrade to "unknown" rather than drop the entry —
    // losing an entry would misrepresent the history, which defeats the point.
    const ids = [...new Set(rows.map((r) => r.changedById).filter(Boolean))] as string[];
    const users = ids.length
      ? await cp.user
          .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
          .catch(() => [])
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    for (const r of rows) {
      const fp = fingerprintByIssueId.get(r.issueId);
      if (!fp) continue;
      const list = out.get(fp) ?? [];
      list.push({
        id: r.id,
        fromStatus: (r.fromStatus as IssueStatus) ?? null,
        toStatus: r.toStatus as IssueStatus,
        note: r.note,
        changedByName: r.changedById ? nameById.get(r.changedById) ?? null : null,
        createdAt: r.createdAt,
      });
      out.set(fp, list);
    }
    return out;
  } catch (e) {
    if (isMissingTableError(e)) return out;
    throw e;
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
