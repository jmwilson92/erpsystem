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

  // Licensing, checked before anything else so an operator sees the reason
  // first in `docker logs` rather than after a wall of startup output.
  //
  // Only a licence that is past expiry AND past its grace window stops the
  // server. Everything short of that warns and carries on: an ERP going dark
  // stops a shop's production, and the likeliest cause of an expired licence is
  // an invoice sitting in someone's inbox, not piracy.
  //
  // Wrapped in an explicit NEXT_RUNTIME check rather than relying on the early
  // return above: Next inlines NEXT_RUNTIME per runtime build, so this whole
  // block is dead-code-eliminated from the Edge bundle. An early `return` is a
  // RUNTIME branch, which leaves webpack still tracing the import — and
  // node:crypto has no Edge equivalent, so the build fails outright.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getLicenseStatus, licenseBootLine } =
      await import("@/lib/services/license");
    const license = await getLicenseStatus();
    if (license.state !== "not_required") {
      console.info(licenseBootLine(license));
    }
    if (
      license.state === "expired" ||
      license.state === "missing" ||
      license.state === "invalid"
    ) {
      console.error(
        [
          "",
          "══════════════════════════════════════════════════════════════",
          "  FATAL: this deployment is not licensed to run",
          "",
          `    ${license.reason}`,
          "",
          "  Your data is untouched — nothing has been deleted or locked.",
          "  Contact your Protessera representative for a licence key, set",
          "  LICENSE_KEY in .env, and restart.",
          "══════════════════════════════════════════════════════════════",
          "",
        ].join("\n"),
      );
      throw new Error(`Not licensed: ${license.reason}`);
    }
  }

  // Air-gapped posture is checked in every environment, not just production: an
  // on-premise operator testing the install locally should hit this immediately,
  // not discover it after go-live.
  const { airgapEnabled, conflictingIntegrations } =
    await import("@/lib/airgap");
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
        ].join("\n"),
      );
      throw new Error(
        `AIRGAP=1 conflicts with configured integrations: ${conflicts
          .flatMap((c) => c.vars)
          .join(", ")}`,
      );
    }
    // Stated plainly so it lands in the boot log a customer's security officer
    // will be shown.
    console.info(
      "[protessera] AIRGAP=1 — analytics off, address lookup off, no third-party integrations configured",
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
      ].join("\n"),
    );
    // Throwing (not process.exit) kills startup the same way without
    // tripping Next's Edge-runtime static analysis warning.
    throw new Error(
      "Protessera production requires DEMO_MODE=0 (or ALLOW_DEMO_IN_PRODUCTION=1)",
    );
  }

  if (demoOff) {
    console.info("[protessera] Production auth: DEMO_MODE=0 (login required)");
  } else {
    console.warn(
      "[protessera] DEMO_MODE is ON in production (ALLOW_DEMO_IN_PRODUCTION=1)",
    );
  }
}
