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

  // Air-gapped posture is checked in every environment, not just production: an
  // on-premise operator testing the install locally should hit this immediately,
  // not discover it after go-live.
  const { airgapEnabled, conflictingIntegrations } = await import("@/lib/airgap");
  if (airgapEnabled()) {
    const conflicts = conflictingIntegrations();
    if (conflicts.length > 0) {
      console.error(
        [
          "",
          "══════════════════════════════════════════════════════════════",
          "  FATAL: AIRGAP=1 but external integrations are configured",
          "",
          ...conflicts.map((c) => `    ${c.service}: ${c.vars.join(", ")}`),
          "",
          "  Air-gapped deployments must not reach a third party. Unset",
          "  these, or drop AIRGAP if this install is allowed outbound",
          "  access. Refusing to start rather than leak.",
          "══════════════════════════════════════════════════════════════",
          "",
        ].join("\n")
      );
      throw new Error(
        `AIRGAP=1 conflicts with configured integrations: ${conflicts
          .flatMap((c) => c.vars)
          .join(", ")}`
      );
    }
    // Stated plainly so it lands in the boot log a customer's security officer
    // will be shown.
    console.info(
      "[protessera] AIRGAP=1 — analytics off, address lookup off, no third-party integrations configured"
    );
  }

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const demoOff = process.env.DEMO_MODE === "0";
  const allowDemo = process.env.ALLOW_DEMO_IN_PRODUCTION === "1";

  if (!demoOff && !allowDemo) {
    console.error(
      [
        "",
        "══════════════════════════════════════════════════════════════",
        "  FATAL: Protessera production requires DEMO_MODE=0",
        "",
        "  Set DEMO_MODE=0 and SEED_ON_FIRST_BOOT=0 for plant deploys.",
        "  Intentional public demo: ALLOW_DEMO_IN_PRODUCTION=1",
        "══════════════════════════════════════════════════════════════",
        "",
      ].join("\n")
    );
    // Throwing (not process.exit) kills startup the same way without
    // tripping Next's Edge-runtime static analysis warning.
    throw new Error("Protessera production requires DEMO_MODE=0 (or ALLOW_DEMO_IN_PRODUCTION=1)");
  }

  if (demoOff) {
    console.info("[protessera] Production auth: DEMO_MODE=0 (login required)");
  } else {
    console.warn(
      "[protessera] DEMO_MODE is ON in production (ALLOW_DEMO_IN_PRODUCTION=1)"
    );
  }
}
