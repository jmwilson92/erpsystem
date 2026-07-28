/**
 * "Is this module's schema actually deployed?"
 *
 * A module whose tables haven't been migrated yet should say so, not throw a
 * route error. Adding models to schema.prisma only changes the *code* — until
 * `prisma db push` runs against a given database, every query against the new
 * tables fails with Postgres 42P01 (undefined_table). That is a deployment
 * step, not a bug, and the page should tell you which one you're missing.
 *
 * Same detection the telemetry dashboard uses, pulled out so any module can
 * reuse it.
 */

/** True when an error is "that table isn't there", not a real failure. */
export function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // Prisma P2021 = table does not exist; Postgres 42P01 = undefined_table.
  return /P2021|42P01|does not exist|Unknown table/i.test(msg);
}

export type ModuleHealth =
  | { ok: true }
  | { ok: false; reason: "missing_table" | "unavailable"; detail: string };

/**
 * Run a module's cheapest query and classify the outcome. Pass the probe as a
 * thunk so the caller decides which table proves the module is deployed.
 */
export async function checkModuleHealth(
  probe: () => Promise<unknown>
): Promise<ModuleHealth> {
  try {
    await probe();
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: isMissingTableError(e) ? "missing_table" : "unavailable",
      detail: detail.slice(0, 300),
    };
  }
}
