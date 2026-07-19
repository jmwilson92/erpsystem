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
import { demoModeEnabled } from "../src/lib/auth-core";

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

console.log("smoke-unit");
testChargeCodes();
testModules();
testDemoModeHelper();
console.log("smoke-unit: all passed");
