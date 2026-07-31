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
  encodeScanId,
  parseScan,
  isTypedScanId,
  SCAN_PREFIXES,
} from "../src/lib/scan-ids";
import {
  sequence,
  sortByRule,
  compareRules,
  dayDiff,
  isWeekend,
} from "../src/lib/services/finite-scheduling";
import {
  rollMaterial,
  rollLabor,
  priceFromCost,
  assembleEstimate,
  unitCost,
} from "../src/lib/services/estimating";
import {
  parseMeasurement,
  mean,
  stdDev,
  movingRanges,
  subgroups,
  controlChart,
  capability,
  violations,
} from "../src/lib/services/spc";
import {
  rollupTotals,
  countsTowardValue,
  isValidSlinNumber,
} from "../src/lib/services/contracts";
import {
  burden,
  wrapRate,
  actualRate,
  rateFor,
} from "../src/lib/services/rate-pools";
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


function testRatePools() {
  const round = (n: number) => Math.round(n * 100) / 100;

  // A conventional 30 / 50 / 12 stack.
  const stack = [
    { code: "FRINGE", poolType: "FRINGE", allocationBase: "DIRECT_LABOR", sequence: 10, rate: 0.3 },
    { code: "OH", poolType: "OVERHEAD", allocationBase: "DIRECT_LABOR_PLUS_FRINGE", sequence: 20, rate: 0.5 },
    { code: "GA", poolType: "G_AND_A", allocationBase: "TOTAL_COST_INPUT", sequence: 90, rate: 0.12 },
  ];

  const labourOnly = burden({ directLabor: 100000 }, stack);
  assert.equal(round(labourOnly.lines[0].amount), 30000, "fringe on labour");
  assert.equal(
    round(labourOnly.lines[1].amount),
    65000,
    "overhead burdens labour PLUS the fringe already applied, not labour alone"
  );
  assert.equal(round(labourOnly.totalCostInput), 195000);
  assert.equal(round(labourOnly.lines[2].amount), 23400, "G&A on total cost input");
  assert.equal(round(labourOnly.totalCost), 218400);

  // The compounding is the point: additive rates would give 1.92.
  assert.equal(round(labourOnly.wrapRate), 2.18);
  assert.notEqual(round(labourOnly.wrapRate), 1.92, "rates compound, they do not add");
  assert.equal(round(wrapRate(stack)), 2.18);

  // Material handling rides its own base and still lands inside G&A's base.
  const withMaterial = burden(
    { directLabor: 100000, directMaterial: 50000, otherDirect: 10000 },
    [
      ...stack,
      { code: "MH", poolType: "MATERIAL_HANDLING", allocationBase: "DIRECT_MATERIAL", sequence: 30, rate: 0.1 },
    ]
  );
  assert.equal(round(withMaterial.totalDirect), 160000);
  assert.equal(round(withMaterial.totalCostInput), 260000, "TCI excludes G&A itself");
  assert.equal(round(withMaterial.totalCost), 291200);

  // G&A never burdens itself.
  const ga = withMaterial.lines.find((l) => l.code === "GA")!;
  assert.equal(round(ga.base), 260000);

  // Order is honoured regardless of the order pools arrive in.
  const shuffled = burden({ directLabor: 100000 }, [stack[2], stack[0], stack[1]]);
  assert.equal(round(shuffled.totalCost), 218400, "sequence sorts, input order does not matter");

  // No labour must not divide by zero.
  assert.equal(burden({ directMaterial: 1000 }, stack).wrapRate, 0);
  assert.equal(actualRate({ poolAmount: 100, baseAmount: 0 }), 0, "unbooked base is not Infinity");
  assert.equal(actualRate({ poolAmount: 60, baseAmount: 200 }), 0.3);

  // Basis selection, including the fallback for an unnegotiated year.
  const year = { provisionalRate: 0.32, poolAmount: 60, baseAmount: 200, finalRate: null };
  assert.equal(rateFor(year, "PROVISIONAL"), 0.32);
  assert.equal(rateFor(year, "ACTUAL"), 0.3);
  assert.equal(rateFor(year, "FINAL"), 0.3, "falls back to actual when unnegotiated");
  assert.equal(
    rateFor({ provisionalRate: 0.32, poolAmount: 0, baseAmount: 0, finalRate: null }, "FINAL"),
    0.32,
    "an unbooked year prices at provisional, not zero"
  );
  assert.equal(rateFor({ ...year, finalRate: 0.28 }, "FINAL"), 0.28);

  console.log("  \u2713 indirect rate pools");
}


function testClinRollup() {
  // A header CLIN with two priced SLINs beneath it. The header's own value
  // must not be counted or the contract rolls up at double.
  const priced = [
    { id: "p", parentId: null, totalValue: 1000000, fundedValue: 500000 },
    { id: "a", parentId: "p", totalValue: 500000, fundedValue: 250000 },
    { id: "b", parentId: "p", totalValue: 500000, fundedValue: 250000 },
  ];
  const r1 = rollupTotals(priced);
  assert.equal(r1.totalValue, 1000000, "SLINs count, the header does not");
  assert.equal(r1.fundedValue, 500000);
  assert.equal(countsTowardValue(priced[0], priced), false, "header is skipped");
  assert.equal(countsTowardValue(priced[1], priced), true);

  // Informational SLINs subdivide funding only — the parent keeps the money.
  const info = [
    { id: "p", parentId: null, totalValue: 1000000, fundedValue: 400000 },
    { id: "a", parentId: "p", isInformational: true, totalValue: 0, fundedValue: 200000 },
    { id: "b", parentId: "p", isInformational: true, totalValue: 0, fundedValue: 200000 },
  ];
  const r2 = rollupTotals(info);
  assert.equal(r2.totalValue, 1000000, "parent still carries the price");
  assert.equal(
    r2.fundedValue,
    400000,
    "informational SLIN funding is a breakdown, not an addition"
  );

  // Unexercised options stay out, at any level.
  const opts = [
    { id: "p", parentId: null, totalValue: 100, fundedValue: 100 },
    { id: "o", parentId: null, totalValue: 900, fundedValue: 0, isOption: true },
  ];
  assert.equal(rollupTotals(opts).totalValue, 100);
  assert.equal(
    rollupTotals([
      opts[0],
      { ...opts[1], optionExercisedAt: new Date() },
    ]).totalValue,
    1000,
    "once exercised it counts"
  );

  // A flat contract is unaffected by any of this.
  assert.equal(
    rollupTotals([
      { id: "a", parentId: null, totalValue: 10, fundedValue: 5 },
      { id: "b", parentId: null, totalValue: 20, fundedValue: 5 },
    ]).totalValue,
    30
  );

  // SLIN numbering extends the parent by two digits or two letters.
  assert.equal(isValidSlinNumber("0001", "000101"), true);
  assert.equal(isValidSlinNumber("0001", "0001AA"), true);
  assert.equal(isValidSlinNumber("0001", "0001a1"), false, "no mixed suffix");
  assert.equal(isValidSlinNumber("0001", "000201"), false, "different parent");
  assert.equal(isValidSlinNumber("0001", "0001001"), false, "three characters");
  assert.equal(isValidSlinNumber("0001", "0001"), false, "a CLIN is not its own SLIN");

  console.log("  \u2713 CLIN/SLIN rollup");
}


function testSpc() {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  // Measurements arrive as free text; a non-measurement must not become NaN.
  assert.equal(parseMeasurement("0.5005"), 0.5005);
  assert.equal(parseMeasurement(" 12.7 mm "), 12.7);
  assert.equal(parseMeasurement("-3"), -3);
  assert.equal(parseMeasurement("PASS"), null, "text is not a measurement");
  assert.equal(parseMeasurement(null), null);
  assert.equal(parseMeasurement(""), null);

  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(stdDev([2]), 0, "one point has no spread");
  assert.equal(r3(stdDev([2, 4, 4, 4, 5, 5, 7, 9])), 2.138);
  assert.deepEqual(movingRanges([1, 4, 2]), [3, 2]);
  assert.deepEqual(subgroups([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4]], "short tail dropped");

  // Individuals chart: limits come from the moving range, not from any spec.
  const vals = [10, 12, 11, 13, 10, 12, 11, 12];
  const chart = controlChart(vals, 1);
  assert.equal(chart.chartType, "I_MR");
  const mrBar = mean(movingRanges(vals));
  assert.equal(r3(chart.centerLine), r3(mean(vals)));
  assert.equal(r3(chart.ucl), r3(mean(vals) + 2.66 * mrBar));
  assert.equal(r3(chart.sigmaWithin), r3(mrBar / 1.128));

  // X-bar/R with a known subgroup size uses the Shewhart constants.
  const xbar = controlChart([2, 4, 6, 8, 10, 12], 3);
  assert.equal(xbar.chartType, "XBAR_R");
  assert.deepEqual(xbar.points, [4, 10], "subgroup means");
  assert.deepEqual(xbar.ranges, [4, 4]);
  assert.equal(r3(xbar.ucl), r3(7 + 1.023 * 4));
  assert.equal(r3(xbar.rangeUcl), r3(2.574 * 4));

  // Capability: Cpk takes the NEARER limit, so an off-centre process scores
  // worse than Cp alone would suggest.
  const centred = capability([9, 10, 11, 10, 9, 11, 10, 10], { usl: 13, lsl: 7 });
  const off = capability([11, 12, 13, 12, 11, 13, 12, 12], { usl: 13, lsl: 7 });
  assert.ok(centred.cpk !== null && off.cpk !== null);
  assert.equal(r3(centred.cp!), r3(off.cp!), "same spread gives the same Cp");
  assert.ok(off.cpk! < centred.cpk!, "off-centre must lower Cpk but not Cp");

  // A one-sided spec has no Cp but still has Cpk.
  const oneSided = capability([9, 10, 11, 10], { usl: 13 });
  assert.equal(oneSided.cp, null, "Cp needs both limits");
  assert.ok(oneSided.cpk !== null);

  // No variation must not divide by zero.
  const flat = capability([5, 5, 5, 5], { usl: 6, lsl: 4 });
  assert.equal(flat.cp, null, "zero sigma yields no index rather than Infinity");
  assert.equal(flat.cpk, null);

  // Within and overall sigma are different numbers and both are reported.
  const drifting = capability([1, 1, 1, 9, 9, 9], { usl: 12, lsl: 0, subgroupSize: 3 });
  assert.ok(
    drifting.sigmaOverall > drifting.sigmaWithin,
    "drift between subgroups shows up in overall sigma, not within"
  );

  // Nelson rule 1 fires on a point outside the limits.
  const spike = controlChart([10, 10, 10, 10, 10, 10, 10, 40], 1);
  assert.ok(violations(spike).some((v) => v.rule === 1), "beyond a control limit");

  // Rule 3 catches a steady trend that never leaves the limits.
  const trend = controlChart([1, 2, 3, 4, 5, 6, 7], 1);
  assert.ok(violations(trend).some((v) => v.rule === 3), "six-point trend");

  console.log("  \u2713 SPC control charts and capability");
}


function testEstimating() {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;

  const part = (id: string, cost: number) => ({
    id,
    partNumber: id,
    standardCost: cost,
    lastBuyCost: cost * 2,
    averageCost: cost * 1.5,
    sourcingMethod: "PURCHASE",
  });

  const parts = new Map([
    ["TOP", part("TOP", 0)],
    ["SUB", part("SUB", 0)],
    ["RAW", part("RAW", 10)],
  ]);

  assert.equal(unitCost(parts.get("RAW")!, "STANDARD"), 10);
  assert.equal(unitCost(parts.get("RAW")!, "LAST_BUY"), 20);
  assert.equal(unitCost(parts.get("RAW")!, "AVERAGE"), 15);

  // Scrap compounds down the levels: 1 x 1.05 x 1.05 = 1.1025, not 1.10.
  const bom = new Map([
    ["TOP", [{ componentPartId: "SUB", quantity: 1, scrapFactor: 0.05 }]],
    ["SUB", [{ componentPartId: "RAW", quantity: 1, scrapFactor: 0.05 }]],
  ]);
  const rolled = rollMaterial("TOP", { parts, bom, basis: "STANDARD" });
  assert.equal(rolled.length, 1, "a made sub-assembly contributes its components");
  assert.equal(r4(rolled[0].effectiveQty), 1.1025, "scrap multiplies, it does not add");
  assert.notEqual(r4(rolled[0].effectiveQty), 1.1);
  assert.equal(r2(rolled[0].extended), 11.03);

  // A BOM that references itself must terminate.
  const cyclic = new Map([
    ["TOP", [{ componentPartId: "SUB", quantity: 1, scrapFactor: 0 }]],
    ["SUB", [{ componentPartId: "TOP", quantity: 1, scrapFactor: 0 }]],
  ]);
  const cyc = rollMaterial("TOP", { parts, bom: cyclic, basis: "STANDARD" });
  assert.ok(Array.isArray(cyc), "cyclic BOM returns rather than hanging");

  // Efficiency DIVIDES: 60 standard minutes at 85% is 1.176 paid hours.
  const centers = new Map([
    ["CNC", { code: "CNC", laborRate: 100, efficiency: 0.85 }],
    ["ASSY", { code: "ASSY", laborRate: 50, efficiency: 1 }],
  ]);
  const labor = rollLabor(
    [
      { estimatedMinutes: 30, workCenter: "CNC" },
      { estimatedMinutes: 30, workCenter: "CNC" },
      { estimatedMinutes: 60, workCenter: "ASSY" },
    ],
    centers
  );
  const cnc = labor.find((l) => l.workCenter === "CNC")!;
  assert.equal(cnc.standardMinutes, 60, "steps at the same centre accumulate");
  assert.equal(r4(cnc.paidHours), 1.1765);
  assert.ok(cnc.paidHours > 1, "efficiency below 1 costs MORE time, not less");
  assert.equal(r2(cnc.extended), 117.65);

  // An unknown work centre must not silently make labour free of time.
  const orphan = rollLabor([{ estimatedMinutes: 60, workCenter: "NOPE" }], centers, 40);
  assert.equal(orphan[0].paidHours, 1, "missing efficiency falls back to 1");
  assert.equal(orphan[0].extended, 40, "fallback rate is used");

  // Margin is taken out of price; markup is added to cost.
  assert.equal(r2(priceFromCost(100, { margin: 0.3 })), 142.86);
  assert.equal(r2(priceFromCost(100, { markup: 0.3 })), 130);
  assert.notEqual(
    r2(priceFromCost(100, { margin: 0.3 })),
    r2(priceFromCost(100, { markup: 0.3 }))
  );
  assert.equal(priceFromCost(100, {}), 100);
  assert.throws(() => priceFromCost(100, { margin: 1 }), /no finite price/);

  // Full assembly, with the rate stack applied to the whole job.
  const est = assembleEstimate({
    quantity: 10,
    material: [{ partNumber: "RAW", effectiveQty: 1, unitCost: 10, extended: 10, level: 0 }],
    labor: [{ workCenter: "ASSY", standardMinutes: 60, paidHours: 1, rate: 50, extended: 50 }],
    pools: [
      { code: "OH", poolType: "OVERHEAD", allocationBase: "DIRECT_LABOR", sequence: 10, rate: 1 },
    ],
    pricing: { margin: 0.25 },
  });
  assert.equal(est.burdened.directLabor, 500, "per-unit labour times quantity");
  assert.equal(est.burdened.directMaterial, 100);
  assert.equal(est.totalCost, 1100, "500 labour + 500 overhead + 100 material");
  assert.equal(est.unitCost, 110);
  assert.equal(r2(est.totalPrice), 1466.67);
  assert.equal(r2(est.unitPrice), 146.67);

  // Zero quantity must not divide by zero.
  const none = assembleEstimate({ quantity: 0, material: [], labor: [], pools: [] });
  assert.equal(none.unitCost, 0);
  assert.equal(none.unitPrice, 0);

  console.log("  \u2713 estimating engine");
}


function testFiniteScheduling() {
  const d = (iso: string) => new Date(iso + "T00:00:00Z");
  // 2026-06-01 is a Monday.
  const start = d("2026-06-01");
  const centers = [{ code: "CNC", minutesPerDay: 480 }];

  assert.equal(isWeekend(d("2026-06-06")), true, "Saturday");
  assert.equal(isWeekend(d("2026-06-01")), false, "Monday");
  assert.equal(dayDiff(d("2026-06-05"), d("2026-06-01")), 4);

  // THE invariant: a centre never gets more minutes in a day than it has.
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `J${i}`,
    label: `J${i}`,
    workCenter: "CNC",
    minutes: 300,
    dueDate: d("2026-06-30"),
    sequence: i,
  }));
  const r = sequence(many, centers, { start, rule: "FIFO" });
  const perDay = new Map<number, number>();
  for (const j of r.scheduled) {
    for (const day of j.days) {
      const k = day.date.getTime();
      perDay.set(k, (perDay.get(k) || 0) + day.minutes);
    }
  }
  for (const [k, mins] of perDay) {
    assert.ok(mins <= 480, `day ${new Date(k).toISOString()} booked ${mins} > 480`);
  }
  assert.equal(r.scheduled.length, 12, "everything placed");

  // Weekends are skipped entirely.
  for (const j of r.scheduled) {
    for (const day of j.days) {
      assert.equal(isWeekend(day.date), false, "no work booked on a weekend");
    }
  }

  // A job larger than one day spans days rather than being crammed in.
  const big = sequence(
    [{ id: "B", label: "B", workCenter: "CNC", minutes: 1200, dueDate: d("2026-06-30") }],
    centers,
    { start }
  );
  assert.equal(big.scheduled[0].days.length, 3, "1200 min over 480/day is three days");
  assert.equal(big.scheduled[0].days[2].minutes, 240, "remainder on the last day");

  // Finite capacity finds lateness that the infinite view cannot see.
  const overload = [
    { id: "A", label: "A", workCenter: "CNC", minutes: 480, dueDate: d("2026-06-01"), sequence: 0 },
    { id: "B", label: "B", workCenter: "CNC", minutes: 480, dueDate: d("2026-06-01"), sequence: 1 },
    { id: "C", label: "C", workCenter: "CNC", minutes: 480, dueDate: d("2026-06-01"), sequence: 2 },
  ];
  const finite = sequence(overload, centers, { start, rule: "FIFO" });
  assert.equal(finite.lateCount, 2, "only one of three can finish on the due date");
  assert.equal(finite.maxLatenessDays, 2);

  // EDD beats SPT on worst-case lateness for a set where the long job is due first.
  const mixed = [
    { id: "LONG", label: "LONG", workCenter: "CNC", minutes: 1440, dueDate: d("2026-06-03"), sequence: 0 },
    { id: "S1", label: "S1", workCenter: "CNC", minutes: 240, dueDate: d("2026-06-30"), sequence: 1 },
    { id: "S2", label: "S2", workCenter: "CNC", minutes: 240, dueDate: d("2026-06-30"), sequence: 2 },
  ];
  const edd = sequence(mixed, centers, { start, rule: "EDD" });
  const spt = sequence(mixed, centers, { start, rule: "SPT" });
  assert.ok(
    edd.maxLatenessDays <= spt.maxLatenessDays,
    "earliest due date should not do worse on worst-case lateness"
  );

  // Sorting rules actually reorder.
  const sorted = sortByRule(mixed, "SPT", start).map((j) => j.id);
  assert.deepEqual(sorted, ["S1", "S2", "LONG"], "shortest first");
  assert.deepEqual(sortByRule(mixed, "EDD", start)[0].id, "LONG", "earliest due first");

  // A centre with no capacity reports unschedulable rather than looping.
  const dead = sequence(
    [{ id: "X", label: "X", workCenter: "CNC", minutes: 60, dueDate: d("2026-06-10") }],
    [{ code: "CNC", minutesPerDay: 0 }],
    { start }
  );
  assert.equal(dead.scheduled.length, 0);
  assert.equal(dead.unschedulable.length, 1);

  // An unknown work centre is reported, not silently dropped.
  const unknown = sequence(
    [{ id: "Y", label: "Y", workCenter: "NOPE", minutes: 60, dueDate: d("2026-06-10") }],
    centers,
    { start }
  );
  assert.equal(unknown.unschedulable.length, 1);
  assert.match(unknown.unschedulable[0].reason, /No work centre/);

  // Work past the horizon is reported rather than compressed.
  const tooMuch = sequence(
    [{ id: "Z", label: "Z", workCenter: "CNC", minutes: 480 * 40, dueDate: d("2026-06-10") }],
    centers,
    { start, horizonDays: 5 }
  );
  assert.equal(tooMuch.unschedulable.length, 1);

  // Every rule runs and returns comparable numbers.
  const cmp = compareRules(mixed, centers, { start });
  assert.equal(cmp.length, 5);
  assert.ok(cmp.every((c) => typeof c.maxLatenessDays === "number"));

  console.log("  \u2713 finite-capacity scheduling");
}


function testScanIds() {
  // Round trip.
  assert.equal(encodeScanId("PART", "ABC-123"), "PN-ABC-123");
  assert.equal(encodeScanId("BIN", "WH1-A01"), "BIN-WH1-A01");
  assert.equal(encodeScanId("WORK_ORDER", "SWO-1001"), "WO-SWO-1001");
  assert.throws(() => encodeScanId("PART", "  "), /empty/i);

  // A typed scan resolves unambiguously even when the value itself has dashes.
  const part = parseScan("PN-ABC-123");
  assert.equal(part.ok && part.typed, true);
  assert.equal(part.ok && part.type, "PART");
  assert.equal(part.ok && part.value, "ABC-123", "only the first dash splits");

  const bin = parseScan("BIN-WH1-A01");
  assert.equal(bin.ok && bin.type, "BIN");
  assert.equal(bin.ok && bin.value, "WH1-A01");

  // Hardware wedges append Enter and may be configured lower case.
  const wedged = parseScan("  pn-abc-123\r\n");
  assert.equal(wedged.ok && wedged.type, "PART");
  assert.equal(wedged.ok && wedged.value, "ABC-123");

  // Legacy bare labels parse, but as explicitly untyped — never as a guess
  // dressed up as a fact.
  const legacy = parseScan("WH1-A01");
  assert.equal(legacy.ok && legacy.typed, false);
  assert.equal(legacy.ok && legacy.type, null, "no confident type without a prefix");
  assert.ok(
    legacy.ok && !legacy.typed && legacy.candidates.includes("BIN"),
    "a dash-joined code is plausibly a bin"
  );
  assert.ok(
    legacy.ok && !legacy.typed && legacy.candidates.includes("PART"),
    "but it could equally be a part number"
  );

  const legacyWo = parseScan("SWO-1001");
  assert.ok(legacyWo.ok && !legacyWo.typed && legacyWo.candidates.includes("WORK_ORDER"));

  // An unknown prefix is not silently accepted as a type.
  const unknown = parseScan("ZZZ-999");
  assert.equal(unknown.ok && unknown.typed, false);

  assert.equal(isTypedScanId("PN-ABC"), true);
  assert.equal(isTypedScanId("ABC"), false);
  assert.equal(parseScan("").ok, false);

  // Prefixes must stay distinct, or one label type shadows another.
  const prefixes = Object.values(SCAN_PREFIXES);
  assert.equal(new Set(prefixes).size, prefixes.length, "prefixes must be unique");
  // Code 39 encodes uppercase alphanumerics and a few symbols; ':' is not one.
  for (const p of prefixes) {
    assert.match(p, /^[A-Z0-9]+$/, `${p} must be Code 39 safe`);
  }

  console.log("  \u2713 scan identifiers");
}

console.log("smoke-unit");
testChargeCodes();
testModules();
testDemoModeHelper();
testSessionIdleTimeout();
testPasswordPolicy();
testExportControl();
testDeviations();
testRatePools();
testClinRollup();
testSpc();
testEstimating();
testFiniteScheduling();
testScanIds();
console.log("smoke-unit: all passed");
