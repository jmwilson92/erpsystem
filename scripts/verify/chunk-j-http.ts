/**
 * HTTP smoke — hits list routes on a running server.
 * Set VERIFY_BASE_URL (default http://127.0.0.1:3000).
 */
import { check, assert, summary, record, resetResults } from "./lib";

const BASE = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000";
/** Pause between routes (ms). Raise if SQLite times out under load. */
const ROUTE_GAP_MS = Number(process.env.VERIFY_HTTP_GAP_MS || 600);
/** Optional: only routes matching this prefix (e.g. /pmo) */
const ONLY_PREFIX = process.env.VERIFY_HTTP_PREFIX || "";

const LIST_ROUTES = [
  "/",
  "/approvals",
  "/floor",
  "/radiators",
  "/value-stream",
  "/ai",
  "/sales",
  "/sales/quotes",
  "/sales/new",
  "/customers",
  "/customers/new",
  "/shipping",
  "/work-orders",
  "/work-instructions",
  "/workcenters",
  "/kitting",
  "/planning",
  "/planning/forecasts",
  "/planning/mrs",
  "/budgets",
  "/engineering",
  "/requirements",
  "/items",
  "/items/new",
  "/bom",
  "/products",
  "/products/new",
  "/cm",
  "/uom",
  "/purchasing",
  "/purchasing/po",
  "/purchasing/approvals",
  "/receiving",
  "/suppliers",
  "/inventory",
  "/virtual-assets",
  "/government-property",
  "/assets",
  "/qa",
  "/test-center",
  "/test-procedures",
  "/quality",
  "/mrb",
  "/mrb/cars",
  "/leadership",
  "/pmo",
  "/pmo/projects",
  "/pmo/programs",
  "/pmo/pi",
  "/pmo/alerts",
  "/pmo/wbs",
  "/accounting",
  "/accounting/banking",
  "/accounting/payroll",
  "/hr",
  "/hr/timesheet",
  "/reports",
  "/reports/builder",
  "/email",
  "/admin/settings",
  "/admin/permissions",
  "/admin/import",
  "/setup",
  "/account",
  "/login",
  "/demo",
  "/api/health",
];

async function fetchStatus(
  path: string,
  retries = 2
): Promise<{ status: number; body: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { Accept: "text/html,application/json" },
      });
      const body = await res.text();
      return { status: res.status, body: body.slice(0, 2000) };
    } catch (e) {
      lastErr = e;
      // Server may be recompiling / recovering — wait and retry
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runChunkJ() {
  resetResults();
  console.log(`\n═══ Chunk J: HTTP routes @ ${BASE} ═══`);

  await check("J", "Health endpoint", async () => {
    const { status, body } = await fetchStatus("/api/health");
    assert(status === 200, `status ${status}`);
    assert(/ok|healthy/i.test(body), body.slice(0, 100));
  });

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const routes = LIST_ROUTES.filter(
    (p) => p !== "/api/health" && (!ONLY_PREFIX || p.startsWith(ONLY_PREFIX))
  );

  for (const path of routes) {
    // If server is wedged, wait and retry health before continuing
    for (let h = 0; h < 5; h++) {
      try {
        const health = await fetchStatus("/api/health", 0);
        if (health.status === 200) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1500));
      if (h === 4) {
        record("J", path, false, "server unreachable");
        failed += 1;
        failures.push(`${path}: server unreachable`);
        // still try remaining routes later — don't break entire suite
        continue;
      }
    }

    const t0 = Date.now();
    try {
      const { status, body } = await fetchStatus(path);
      // 307 redirects (e.g. /pmo/projects → list) are OK
      if (status >= 500) {
        throw new Error(`HTTP ${status}`);
      }
      if (/Application error/i.test(body) && body.length < 500) {
        throw new Error("Application error page");
      }
      record("J", path, true, `HTTP ${status}`, Date.now() - t0);
      passed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // One retry after short cool-down (SQLite lock recovery)
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { status, body } = await fetchStatus(path, 1);
        if (status >= 500) throw new Error(`HTTP ${status}`);
        if (/Application error/i.test(body) && body.length < 500) {
          throw new Error("Application error page");
        }
        record("J", path, true, `HTTP ${status} (retry)`, Date.now() - t0);
        passed += 1;
      } catch {
        record("J", path, false, msg, Date.now() - t0);
        failed += 1;
        failures.push(`${path}: ${msg}`);
      }
    }
    await new Promise((r) => setTimeout(r, ROUTE_GAP_MS));
  }

  console.log(`  HTTP list routes: ${passed} ok, ${failed} failed`);
  if (failures.length && failures.length <= 15) {
    for (const f of failures) console.log(`    · ${f}`);
  }

  return summary();
}

if (require.main === module) {
  runChunkJ()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
