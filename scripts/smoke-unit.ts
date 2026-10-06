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
  demoModeEnabled,
  sessionIdleMinutes,
  lastSeenRefreshMs,
  assertPasswordStrength,
} from "../src/lib/auth-core";
import { redactSecrets } from "../src/lib/redact-secrets";
import { deriveClaim } from "../src/lib/services/tenant-activity";
import { COMPARE_PAGES, prepareComparePage } from "../src/lib/compare/pages";
import {
  externalLinkAttrs,
  faqPageJsonLd,
  visibleText,
  walkLinks,
} from "../src/lib/compare/model";
import {
  TRIAL_DAYS,
  formatPlanMoney,
  getPlan,
  shopFirstYearMonthly,
} from "../src/lib/services/subscription-plans";
import sitemap from "../src/app/sitemap";
import {
  TRIAL_DAYS,
  STRIPE_FIRST_YEAR_PRICE_ENV,
  STRIPE_STANDARD_PRICE_ENV,
  firstYearBillingCycles,
  firstYearOfferSummary,
  firstYearPeriodPriceForPlan,
  periodPriceForPlan,
  planPriceView,
  shopFirstYearMonthly,
} from "../src/lib/services/subscription-plans";
import { buildIntroScheduleUpdate } from "../src/lib/services/stripe-intro";
import { LEGAL_DOCS } from "../src/lib/legal-content";

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

function testSecretRedaction() {
  const token = "ab".repeat(24);
  assert.equal(token.length, 48);
  const claimUrl = `https://www.protessera.com/onboard/${token}`;
  const redacted = redactSecrets(
    `[onboarding] tenant tenant_sjcsa9pe1kib (a@b.co) — claim link: ${claimUrl}`
  );
  assert.equal(redacted.includes(token), false);
  assert.equal(redacted.includes(claimUrl), false);
  assert.equal(redactSecrets(`/invite/${token}`), "/invite/[redacted]");
  assert.equal(redactSecrets(`/support/t/${token}`), "/support/t/[redacted]");
  assert.equal(redactSecrets(`Bearer ${token}`), "Bearer [redacted]");
  assert.equal(
    redactSecrets("password=hunter2"),
    "password=[redacted]"
  );
  // Ordinary routes and short ids stay readable.
  assert.equal(redactSecrets("/work-orders/clxyz"), "/work-orders/clxyz");
  assert.equal(redactSecrets("/admin/tenants"), "/admin/tenants");
  console.log("  ✓ secret redaction");
}

function testComparePages() {
  const shop = getPlan("SHOP");
  const starter = getPlan("STARTER");
  const growth = getPlan("GROWTH");
  const business = getPlan("BUSINESS");
  assert.ok(shop && starter && growth && business);
  const allowedDollars = new Set<number>([
    shop.firstYearPrice ?? -1,
    shop.firstYearAdditionalPerSeat ?? -1,
    shop.pricePerSeatMonthly ?? -1,
    shopFirstYearMonthly(shop.maxSeats ?? 10),
    starter.firstYearPrice ?? -1,
    starter.price,
    growth.firstYearPrice ?? -1,
    growth.price,
    business.firstYearPrice ?? -1,
    business.price,
  ]);

  const expectedSlugs = [
    "/compare/protessera-vs-proshop",
    "/compare/protessera-vs-jobboss",
  ];
  assert.deepEqual(
    COMPARE_PAGES.map((page) => page.slug),
    expectedSlugs
  );

  const sitemapUrls = sitemap().map((entry) => entry.url);
  for (const slug of expectedSlugs) {
    assert.ok(
      sitemapUrls.some((url) => url.endsWith(slug)),
      `sitemap missing ${slug}`
    );
  }

  for (const page of COMPARE_PAGES) {
    assert.equal(page.rawBody.includes("$"), false, `${page.slug} hardcodes a price`);
    assert.equal(/\{\{[A-Z0-9_]+\}\}/.test(page.rawBody), true);
    const prepared = prepareComparePage(page);
    assert.equal(prepared.markdown.includes("{{"), false, `${page.slug} left a token`);
    assert.equal(prepared.markdown.includes(`${TRIAL_DAYS}-day`), true);
    assert.equal(prepared.markdown.includes(`day ${TRIAL_DAYS}`), true);
    assert.equal(prepared.faqs.length >= 6, true, `${page.slug} faqs`);

    const dollars = [...prepared.markdown.matchAll(/\$[\d,]+/g)].map((match) =>
      Number(match[0].slice(1).replace(/,/g, ""))
    );
    assert.ok(dollars.length > 0, `${page.slug} shows no prices`);
    for (const amount of dollars) {
      assert.ok(allowedDollars.has(amount), `${page.slug} unexpected price $${amount}`);
    }
    assert.ok(prepared.markdown.includes(formatPlanMoney(shop.firstYearPrice ?? 0)));
    assert.ok(prepared.markdown.includes(formatPlanMoney(business.price)));

    const banned = ["ITAR-ready", "CUI-ready", "700+", "9,000", "50% off", "45-day"];
    for (const phrase of banned) {
      assert.equal(prepared.markdown.includes(phrase), false, `${page.slug} says ${phrase}`);
    }

    assert.equal(
      visibleText(prepared.blocks),
      draftVisibleText(prepared.markdown),
      `${page.slug} rendered copy drifted from the draft`
    );

    const links = walkLinks(prepared.blocks);
    const external = links.filter((link) => link.external);
    assert.ok(external.length > 5, `${page.slug} missing competitor links`);
    for (const link of external) {
      assert.ok(link.href.startsWith("https://"), link.href);
      assert.equal(externalLinkAttrs(link).rel, "noopener noreferrer");
      assert.equal(externalLinkAttrs(link).target, "_blank");
    }
    const internal = links.filter((link) => !link.external);
    assert.ok(internal.length >= 1);
    for (const link of internal) {
      assert.equal(link.href, "/demo");
      assert.equal(externalLinkAttrs(link).rel, undefined);
    }

    const jsonLd = faqPageJsonLd(prepared.faqs);
    assert.equal(jsonLd["@type"], "FAQPage");
    assert.equal(jsonLd.mainEntity.length, prepared.faqs.length);
    assert.equal(jsonLd.mainEntity[0]["@type"], "Question");
    assert.equal(jsonLd.mainEntity[0].acceptedAnswer["@type"], "Answer");
    assert.equal(jsonLd.mainEntity[0].name.includes("**"), false);
    assert.ok(jsonLd.mainEntity.some((item) => item.acceptedAnswer.text.includes("DFARS 252.204-7012")));
    assert.ok(
      jsonLd.mainEntity.some((item) =>
        item.acceptedAnswer.text.includes(formatPlanMoney(shop.pricePerSeatMonthly ?? 0))
      )
    );
  }

  console.log("  ✓ comparison pages");
}

/** Independent of the parser, so a dropped word fails the smoke test. */
function draftVisibleText(md: string): string {
  const parts: string[] = [];
  const push = (value: string) => {
    const text = value
      .replace(/^#{1,6}\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (text) parts.push(text);
  };
  for (const raw of md.replace(/\r\n/g, "\n").trim().split(/\n\n+/)) {
    const lines = raw
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.length === 1 && lines[0] === "---") continue;
    if (lines.every((line) => line.startsWith("|"))) {
      for (const line of lines) {
        const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
        for (const cell of cells) push(cell);
      }
      continue;
    }
    if (lines.every((line) => line.startsWith("- "))) {
      for (const line of lines) push(line.slice(2));
      continue;
    }
    if (lines.length >= 2 && /^\*\*[^*]+\*\*$/.test(lines[0])) {
      push(lines[0]);
      push(lines.slice(1).join(" "));
      continue;
    }
    push(lines.join(" "));
  }
  return parts.join("\n");
}

function testClaimDerivation() {
  const claimedAt = new Date("2026-03-01T00:00:00Z");
  assert.deepEqual(
    deriveClaim({ isDemo: true, setupTokenHash: "abc", instanceClaimedAt: claimedAt }),
    { claimed: false, claimReason: "demo", claimedAt: null }
  );
  assert.deepEqual(
    deriveClaim({ isDemo: false, setupTokenHash: "abc", instanceClaimedAt: claimedAt }),
    { claimed: true, claimReason: "audit", claimedAt }
  );
  assert.deepEqual(
    deriveClaim({ isDemo: false, setupTokenHash: null, instanceClaimedAt: null }),
    { claimed: true, claimReason: "token_consumed", claimedAt: null }
  );
  assert.deepEqual(
    deriveClaim({ isDemo: false, setupTokenHash: "abc", instanceClaimedAt: null }),
    { claimed: false, claimReason: "pending", claimedAt: null }
  );
  console.log("  ✓ tenant claim derivation");
}

function testLaunchPricing() {
  assert.equal(TRIAL_DAYS, 60);
  assert.equal(shopFirstYearMonthly(1), 10);
  assert.equal(shopFirstYearMonthly(2), 12);
  assert.equal(shopFirstYearMonthly(10), 28);
  assert.equal(shopFirstYearMonthly(99), 28);
  assert.equal(periodPriceForPlan("SHOP", 1), 30);
  assert.equal(periodPriceForPlan("SHOP", 10), 300);
  assert.equal(firstYearPeriodPriceForPlan("STARTER"), 250);
  assert.equal(periodPriceForPlan("STARTER"), 3600);
  assert.equal(firstYearPeriodPriceForPlan("GROWTH"), 500);
  assert.equal(periodPriceForPlan("GROWTH"), 8400);
  assert.equal(firstYearPeriodPriceForPlan("BUSINESS"), 1000);
  assert.equal(periodPriceForPlan("BUSINESS"), 18000);
  assert.equal(firstYearPeriodPriceForPlan("ENTERPRISE"), 0);
  assert.equal(firstYearBillingCycles("SHOP"), 12);
  assert.equal(firstYearBillingCycles("STARTER"), 1);
  assert.equal(firstYearBillingCycles("GROWTH"), 1);
  assert.equal(firstYearBillingCycles("BUSINESS"), 1);

  const shop = planPriceView("SHOP");
  assert.equal(shop.primaryAmount, "$10");
  assert.match(shop.note ?? "", /\$28/);
  assert.match(shop.afterYearOne, /\$30\/user\/mo/);
  const ten = planPriceView("SHOP", { seats: 10 });
  assert.equal(ten.primaryAmount, "$28");
  assert.match(ten.afterYearOne, /\$300\/mo/);
  const starter = planPriceView("STARTER");
  assert.equal(starter.primaryAmount, "$250");
  assert.match(starter.afterYearOne, /\$3,600\/year/);

  const summary = firstYearOfferSummary();
  assert.match(summary, /\$250/);
  assert.match(summary, /\$500/);
  assert.match(summary, /\$1,000/);
  assert.match(summary, /\$3,600/);
  assert.match(summary, /\$8,400/);
  assert.match(summary, /\$18,000/);
  assert.doesNotMatch(summary, /50%/);

  const shopSchedule = buildIntroScheduleUpdate({
    plan: "SHOP",
    startDate: 1_700_000_000,
    quantity: 10,
    introPriceId: "price_intro",
    standardPriceId: "price_std",
    nowUnix: 1_700_000_000,
  });
  assert.equal(shopSchedule["phases[0][iterations]"], "12");
  assert.equal(shopSchedule["phases[0][items][0][price]"], "price_intro");
  assert.equal(shopSchedule["phases[0][items][0][quantity]"], "10");
  assert.equal(shopSchedule["phases[1][items][0][price]"], "price_std");
  assert.equal(shopSchedule["phases[1][items][0][quantity]"], "10");
  assert.equal(shopSchedule["phases[0][end_date]"], undefined);
  assert.equal(
    Object.keys(shopSchedule).some((k) => k.toLowerCase().includes("coupon")),
    false
  );

  const annual = buildIntroScheduleUpdate({
    plan: "STARTER",
    startDate: 1_700_000_000,
    quantity: 1,
    introPriceId: "price_intro",
    standardPriceId: "price_std",
    nowUnix: 1_700_000_000,
  });
  assert.equal(annual["phases[0][iterations]"], "1");

  const trialing = buildIntroScheduleUpdate({
    plan: "SHOP",
    startDate: 1_700_000_000,
    quantity: 3,
    introPriceId: "price_intro",
    standardPriceId: "price_std",
    trialEnd: 1_700_000_000 + 60 * 86400,
    nowUnix: 1_700_000_000,
  });
  assert.equal(trialing["phases[0][iterations]"], undefined);
  const trialEnd = Number(trialing["phases[0][trial_end]"]);
  const end = Number(trialing["phases[0][end_date]"]);
  assert.ok(end > trialEnd + 360 * 86400);
  assert.ok(end < trialEnd + 370 * 86400);

  assert.equal(STRIPE_FIRST_YEAR_PRICE_ENV.SHOP, "STRIPE_PRICE_SHOP_FIRST_YEAR");
  assert.equal(STRIPE_STANDARD_PRICE_ENV.SHOP, "STRIPE_PRICE_SHOP");
  assert.notEqual(
    STRIPE_FIRST_YEAR_PRICE_ENV.STARTER,
    STRIPE_STANDARD_PRICE_ENV.STARTER
  );

  const textOf = (slug: string) =>
    LEGAL_DOCS.find((d) => d.slug === slug)!
      .sections.flatMap((s) => s.paragraphs)
      .join("\n");
  const termsText = textOf("terms-of-service");
  const refundText = textOf("refund-policy");
  assert.match(termsText, /60 days/);
  assert.doesNotMatch(termsText, /45 days/);
  assert.match(termsText, /\$28/);
  assert.match(termsText, /\$250/);
  assert.match(termsText, /does not require a payment card/);
  assert.match(refundText, /\$500/);
  assert.match(refundText, /\$1,000/);
  assert.match(refundText, /\$18,000/);
  assert.doesNotMatch(`${termsText}\n${refundText}`, /50%/);
  console.log("  ✓ first-year pricing");
}

console.log("smoke-unit");
testChargeCodes();
testModules();
testDemoModeHelper();
testSessionIdleTimeout();
testPasswordPolicy();
testSecretRedaction();
testComparePages();
testClaimDerivation();
testLaunchPricing();
console.log("smoke-unit: all passed");
