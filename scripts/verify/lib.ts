/**
 * Shared harness for chunked verification.
 */
import { prisma } from "../../src/lib/db";

export type Result = {
  chunk: string;
  name: string;
  ok: boolean;
  detail?: string;
  ms: number;
};

let results: Result[] = [];

export function resetResults() {
  results = [];
}

export function record(
  chunk: string,
  name: string,
  ok: boolean,
  detail?: string,
  ms = 0
) {
  results.push({ chunk, name, ok, detail, ms });
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} [${chunk}] ${name}${detail ? ` — ${detail}` : ""}`);
}

export async function check(
  chunk: string,
  name: string,
  fn: () => Promise<void> | void
) {
  const t0 = Date.now();
  try {
    await fn();
    record(chunk, name, true, undefined, Date.now() - t0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record(chunk, name, false, msg, Date.now() - t0);
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function summary() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n────────────────────────────────────");
  console.log(`Results: ${pass} passed, ${fail} failed, ${results.length} total`);
  if (fail) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ✗ [${r.chunk}] ${r.name}: ${r.detail}`);
    }
  }
  return { pass, fail, results };
}

export async function adminUser() {
  const u = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });
  assert(u, "No ADMIN user in DB — run npm run db:seed");
  return u;
}

export async function userByRole(role: string) {
  const u = await prisma.user.findFirst({
    where: { role, isActive: true },
  });
  assert(u, `No ${role} user in DB`);
  return u;
}

export { prisma };
