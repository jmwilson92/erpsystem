/**
 * Next.js instrumentation — runs once when the Node server starts.
 * Enforces production auth posture so a misconfigured plant deploy
 * cannot ship with open persona switching.
 *
 * Escape hatch for intentional public demo hosts:
 *   ALLOW_DEMO_IN_PRODUCTION=1
 */
export async function register() {
  // Node only — Edge has no process.exit
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (typeof process === "undefined" || typeof process.exit !== "function")
    return;

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const demoOff = process.env.DEMO_MODE === "0";
  const allowDemo = process.env.ALLOW_DEMO_IN_PRODUCTION === "1";

  if (!demoOff && !allowDemo) {
    console.error(
      [
        "",
        "══════════════════════════════════════════════════════════════",
        "  FATAL: ForgeRP production requires DEMO_MODE=0",
        "",
        "  Set DEMO_MODE=0 and SEED_ON_FIRST_BOOT=0 for plant deploys.",
        "  Intentional public demo: ALLOW_DEMO_IN_PRODUCTION=1",
        "══════════════════════════════════════════════════════════════",
        "",
      ].join("\n")
    );
    // Throwing (not process.exit) kills startup the same way without
    // tripping Next's Edge-runtime static analysis warning.
    throw new Error("ForgeRP production requires DEMO_MODE=0 (or ALLOW_DEMO_IN_PRODUCTION=1)");
  }

  if (demoOff) {
    console.info("[forgerp] Production auth: DEMO_MODE=0 (login required)");
  } else {
    console.warn(
      "[forgerp] DEMO_MODE is ON in production (ALLOW_DEMO_IN_PRODUCTION=1)"
    );
  }
}
