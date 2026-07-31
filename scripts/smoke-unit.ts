/**
 * Fast offline smoke — no server required.
 * Validates auth helpers, module packaging, charge-code scheme.
 */
import assert from "node:assert/strict";
import {
  chargeCodeFromBudgetName,
  projectWbsChargeCode,
  sanitizeChargeCode,
} from "../src/lib/services/budgets";
import {
  MODULES,
  moduleKeyForPath,
  isPathEnabled,
} from "../src/lib/modules";
import {
  hasBound,
  forceState,
  isInForce,
} from "../src/lib/services/deviations";
import {
  isValidUsml,
  isValidEccn,
  normalizeUsml,
  normalizeEccn,
  usmlCategoryOf,
  isExportControlled,
} from "../src/lib/services/export-control";
import {
  demoModeEnabled,
  sessionIdleMinutes,
  lastSeenRefreshMs,
  assertPasswordStrength,
} from "../src/lib/auth-core";

function testChargeCodes() {
  assert.equal(sanitizeChargeCode("  Foo Bar!  "), "Foo-Bar");
  assert.equal(
    projectWbsChargeCode("Atlas Probe", ["1.0", "1.1"]),
    "Atlas-Probe-1.0-1.1"
  );
  assert.equal(
    chargeCodeFromBudgetName("Production LRIP"),
    "Production-LRIP"
  );
  console.log("  ✓ charge code scheme");
}

function testModules() {
  assert.ok(MODULES.length >= 6);
  assert.equal(moduleKeyForPath("/work-orders/abc"), "manufacturing");
  assert.equal(moduleKeyForPath("/pmo/projects/x"), "pmo");
  assert.equal(moduleKeyForPath("/hr/timesheet"), null); // core exception
  assert.equal(isPathEnabled("/sales", ["pmo"]), true);
  assert.equal(isPathEnabled("/pmo", ["pmo"]), false);
  console.log("  ✓ module packaging");
}

function testDemoModeHelper() {
  // Function is pure env read — just ensure it is callable
  const v = demoModeEnabled();
  assert.equal(typeof v, "boolean");
  console.log(`  ✓ demoModeEnabled() → ${v}`);
}

function testSessionIdleTimeout() {
  const saved = {
    idle: process.env.SESSION_IDLE_MINUTES,
    airgap: process.env.AIRGAP,
  };
  try {
    // Hosted default: off. An ERP that logs you out mid-drawing is worse than
    // one that does not, and hosted customers carry no CUI obligation.
    delete process.env.SESSION_IDLE_MINUTES;
    delete process.env.AIRGAP;
    assert.equal(sessionIdleMinutes(), 0);

    // Air-gapped default: on, because 800-171 3.1.11 requires it.
    process.env.AIRGAP = "1";
    assert.equal(sessionIdleMinutes(), 15);

    // Explicit always wins, in either posture.
    process.env.SESSION_IDLE_MINUTES = "30";
    assert.equal(sessionIdleMinutes(), 30);
    delete process.env.AIRGAP;
    assert.equal(sessionIdleMinutes(), 30);

    // "0" must disable rather than fall through to a default — a truthiness
    // check here would silently re-enable the timeout for someone who turned
    // it off on purpose.
    process.env.SESSION_IDLE_MINUTES = "0";
    assert.equal(sessionIdleMinutes(), 0);

    // Garbage falls back rather than producing NaN minutes.
    process.env.SESSION_IDLE_MINUTES = "banana";
    assert.equal(sessionIdleMinutes(), 0);

    // THE INVARIANT THAT MATTERS: lastSeenAt is only refreshed once per
    // interval, so for an active user it always lags. If that lag could reach
    // the idle timeout, the timeout would fire on people who never stopped
    // working. The refresh must stay strictly inside the window for every
    // timeout anyone might configure.
    for (const minutes of [1, 5, 10, 15, 20, 30, 60, 120, 480]) {
      const idleMs = minutes * 60_000;
      const refresh = lastSeenRefreshMs(idleMs);
      assert.ok(
        refresh < idleMs,
        `refresh ${refresh}ms must be < idle ${idleMs}ms (${minutes}m)`
      );
      assert.ok(refresh > 0, `refresh must be positive at ${minutes}m`);
    }

    // Timeout disabled → keep the original hourly cadence, not a hot loop.
    assert.equal(lastSeenRefreshMs(0), 3_600_000);

    console.log("  \u2713 session idle timeout + refresh coupling");
  } finally {
    if (saved.idle === undefined) delete process.env.SESSION_IDLE_MINUTES;
    else process.env.SESSION_IDLE_MINUTES = saved.idle;
    if (saved.airgap === undefined) delete process.env.AIRGAP;
    else process.env.AIRGAP = saved.airgap;
  }
}

function testPasswordPolicy() {
  const ok = (pw: string, why: string) =>
    assert.doesNotThrow(() => assertPasswordStrength(pw), `should accept ${why}`);
  const bad = (pw: string, why: string) =>
    assert.throws(() => assertPasswordStrength(pw), `should reject ${why}`);

  // Length-only path: a passphrase needs no symbol gymnastics.
  ok("correct horse battery", "a long passphrase");
  ok("thequickbrownfoxjumps", "21 lowercase chars");

  // Complexity path: shorter is allowed with three character classes.
  ok("Tr0ubadour", "10 chars, upper+lower+digit");
  ok("shop-Floor9", "11 chars, three classes");

  // Too short for either path.
  bad("abc", "3 chars");
  bad("shortpw", "7 chars");
  // 8-11 chars with only two classes satisfies neither rule.
  bad("lowercase1", "10 chars, only lower+digit");
  bad("SHOUTING99", "10 chars, only upper+digit");
  // 12 chars clears the length-only path even with one class — that is the point
  // of preferring length over composition, so assert it rather than assume it.
  ok("alllowercase", "12 lowercase chars");

  // Passwords that satisfy a composition rule and are still guessed first.
  bad("Password123", "a common password that passes three classes");
  bad("Qwerty123!", "another common one");

  // Respects PASSWORD_MIN_LENGTH for the length-only path.
  const savedMin = process.env.PASSWORD_MIN_LENGTH;
  try {
    process.env.PASSWORD_MIN_LENGTH = "20";
    bad("sixteencharacter", "16 chars when the floor is 20 and only one class");
    ok("Tr0ubadour", "short-but-complex still passes with a raised floor");
  } finally {
    if (savedMin === undefined) delete process.env.PASSWORD_MIN_LENGTH;
    else process.env.PASSWORD_MIN_LENGTH = savedMin;
  }

  console.log("  \u2713 password policy");
}


function testExportControl() {
  // A USML designation is a category I-XXI plus optional paragraphs.
  assert.equal(isValidUsml("XI"), true);
  assert.equal(isValidUsml("XI(c)"), true);
  assert.equal(isValidUsml("xi(c)(4)"), true);
  assert.equal(isValidUsml(" XI (c) "), true, "whitespace is stripped");
  assert.equal(isValidUsml("VIII"), true);
  assert.equal(isValidUsml("XXI"), true);

  // The category is whitelisted, so numeral-shaped non-categories are out.
  assert.equal(isValidUsml("XXII"), false, "there is no USML category XXII");
  assert.equal(isValidUsml("IIII"), false);
  assert.equal(isValidUsml("9A610"), false, "that is an ECCN, not a category");

  // Category uppercases, paragraphs lowercase — "xi(C)" is the same article.
  assert.equal(normalizeUsml("xi(C)"), "XI(c)");
  assert.equal(usmlCategoryOf("XI(c)(4)"), "XI");
  assert.equal(usmlCategoryOf(null), null);

  // ECCN: digit, group letter A-E, three digits, optional paragraphs.
  assert.equal(isValidEccn("9A610"), true);
  assert.equal(isValidEccn("3A001.b.1"), true);
  assert.equal(isValidEccn("EAR99"), true);
  assert.equal(isValidEccn("ear99"), true);
  assert.equal(normalizeEccn("3a001.B.1"), "3A001.b.1");
  assert.equal(isValidEccn("9Z610"), false, "Z is not a CCL group");
  assert.equal(isValidEccn("9A61"), false, "three digits required");

  // EAR99 is EAR jurisdiction but unlisted, so it is not "controlled".
  assert.equal(isExportControlled({ exportJurisdiction: "ITAR" }), true);
  assert.equal(
    isExportControlled({ exportJurisdiction: "EAR", eccn: "9A610" }),
    true
  );
  assert.equal(
    isExportControlled({ exportJurisdiction: "EAR", eccn: "EAR99" }),
    false
  );
  assert.equal(
    isExportControlled({ exportJurisdiction: "UNDETERMINED" }),
    false,
    "unclassified is not the same as cleared"
  );

  console.log("  \u2713 export control classification");
}


function testDeviations() {
  const day = 86400000;
  const now = new Date("2026-06-15T12:00:00Z");
  const past = new Date(now.getTime() - 30 * day);
  const future = new Date(now.getTime() + 30 * day);

  // An authorisation must be limited in at least one dimension.
  assert.equal(hasBound({}), false, "no bound at all");
  assert.equal(hasBound({ quantityLimit: 10 }), true);
  assert.equal(hasBound({ effectiveTo: future }), true);
  assert.equal(hasBound({ units: [{ id: "u1" }] }), true);
  assert.equal(hasBound({ quantityLimit: 0 }), false, "zero is not a bound");
  assert.equal(
    hasBound({ effectiveFrom: past }),
    false,
    "a start date alone leaves it open-ended"
  );

  // Only APPROVED can be in force.
  assert.equal(forceState({ status: "DRAFT", quantityLimit: 5 }, now), "NOT_APPROVED");
  assert.equal(forceState({ status: "CLOSED", quantityLimit: 5 }, now), "CLOSED");
  assert.equal(
    forceState({ status: "INTERNAL_APPROVED", quantityLimit: 5 }, now),
    "NOT_APPROVED",
    "internal approval alone is not authorisation"
  );

  // The window and the counter are evaluated against the clock, not stored.
  assert.equal(
    forceState({ status: "APPROVED", effectiveTo: past }, now),
    "EXPIRED",
    "an approved row past its window must not read as usable"
  );
  assert.equal(
    forceState({ status: "APPROVED", effectiveFrom: future }, now),
    "NOT_YET_EFFECTIVE"
  );
  assert.equal(
    forceState({ status: "APPROVED", quantityLimit: 5, quantityUsed: 5 }, now),
    "EXHAUSTED"
  );
  assert.equal(
    forceState({ status: "APPROVED", quantityLimit: 5, quantityUsed: 4 }, now),
    "IN_FORCE"
  );
  assert.equal(
    forceState(
      { status: "APPROVED", effectiveFrom: past, effectiveTo: future },
      now
    ),
    "IN_FORCE"
  );
  assert.equal(isInForce({ status: "APPROVED", effectiveTo: future }, now), true);

  console.log("  \u2713 deviations and waivers");
}

console.log("smoke-unit");
testChargeCodes();
testModules();
testDemoModeHelper();
testSessionIdleTimeout();
testPasswordPolicy();
testExportControl();
testDeviations();
console.log("smoke-unit: all passed");
