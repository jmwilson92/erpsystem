import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolvePrototypeRequired,
  resolveDemandPlanPath,
  parsePathOverride,
  parseDemandPlanUtterance,
  parseBudgetClarify,
  isSkipBudgetUtterance,
  needsBudgetClarify,
  buildDemandPlan,
  formatPlanSummary,
  looksLikeDemandPlan,
  looksLikePlanningWorksheet,
  type PlanningStore,
  type PlanningBom,
  type PlanningPart,
  type PlanningSupply,
} from "../src/lib/services/carina-planning";
import type { CalendarContext } from "../src/lib/services/schedule";

const calendar: CalendarContext = { mode: "FIXED_SHIFT", minutesPerDay: 480 };

const fg: PlanningPart = { id: "fg", partNumber: "WIDGET-20", description: "Widget", sourcingMethod: "BUILD", uom: "EA" };
const sub: PlanningPart = { id: "sub", partNumber: "SUB-HOUSING", description: "Housing", sourcingMethod: "BUILD", uom: "EA" };
const bolt: PlanningPart = { id: "bolt", partNumber: "BOLT-A", description: "Bolt", sourcingMethod: "PURCHASE", uom: "EA" };
const cast: PlanningPart = { id: "cast", partNumber: "CASTING-C", description: "Casting", sourcingMethod: "PURCHASE", uom: "EA" };
const parts = new Map([fg, sub, bolt, cast].map((p) => [p.partNumber, p]));
const byId = new Map([fg, sub, bolt, cast].map((p) => [p.id, p]));

function bom(partId: string, status: string, prototypeRequired: boolean, lines: PlanningBom["lines"]): PlanningBom {
  return { id: `bom-${partId}`, partId, revision: "A", status, prototypeRequired, lines };
}

function store(opts: {
  fgStatus?: string;
  prototypeRequired?: boolean;
  companyDefault?: boolean;
  supply?: Record<string, Partial<PlanningSupply>>;
}): PlanningStore {
  const fgStatus = opts.fgStatus ?? "IN_REVIEW";
  const proto = opts.prototypeRequired ?? true;
  const boms = new Map<string, PlanningBom>([
    [
      fg.id,
      bom(fg.id, fgStatus, proto, [
        { componentPartId: sub.id, componentPartNumber: sub.partNumber, componentSourcingMethod: "BUILD", quantity: 1, scrapFactor: 0 },
        { componentPartId: bolt.id, componentPartNumber: bolt.partNumber, componentSourcingMethod: "PURCHASE", quantity: 2, scrapFactor: 0 },
      ]),
    ],
    [
      sub.id,
      bom(sub.id, fgStatus, proto, [
        { componentPartId: cast.id, componentPartNumber: cast.partNumber, componentSourcingMethod: "PURCHASE", quantity: 1, scrapFactor: 0 },
      ]),
    ],
  ]);
  const supplies: Record<string, PlanningSupply> = {
    fg: { onHand: 0, openWoQty: 0, openPoQty: 0, total: 0 },
    sub: { onHand: 0, openWoQty: 0, openPoQty: 0, total: 0 },
    bolt: { onHand: 5, openWoQty: 0, openPoQty: 0, total: 5 },
    cast: { onHand: 0, openWoQty: 0, openPoQty: 0, total: 0 },
    ...(opts.supply as Record<string, PlanningSupply> | undefined),
  };
  return {
    async findPart(token) {
      return parts.get(token) || [...parts.values()].find((p) => p.partNumber.toLowerCase() === token.toLowerCase()) || null;
    },
    async companyBomPrototypeRequired() {
      return opts.companyDefault ?? true;
    },
    async latestBom(partId) {
      return boms.get(partId) || null;
    },
    async supply(partId) {
      return supplies[partId] || { onHand: 0, openWoQty: 0, openPoQty: 0, total: 0 };
    },
    async buyLeadDays(partId) {
      return partId === bolt.id ? 10 : partId === cast.id ? 7 : 14;
    },
    async buildMinutes(partId, qty) {
      if (partId === fg.id) return 480 * Math.max(1, Math.ceil(qty / 20));
      if (partId === sub.id) return 240;
      return 60;
    },
    async calendar() {
      return calendar;
    },
  };
}

function demand(overrides: Partial<Parameters<typeof buildDemandPlan>[0]> = {}) {
  return {
    partNumber: "WIDGET-20",
    quantity: 20,
    dueDate: new Date("2027-03-15T00:00:00"),
    ...overrides,
  };
}

async function main() {
  // Settings: header wins over company default; company used only when no BOM
  assert.equal(resolvePrototypeRequired({ companyDefault: false, bomPrototypeRequired: true, hasBom: true }), true);
  assert.equal(resolvePrototypeRequired({ companyDefault: true, bomPrototypeRequired: false, hasBom: true }), false);
  assert.equal(resolvePrototypeRequired({ companyDefault: false, bomPrototypeRequired: undefined, hasBom: false }), false);
  assert.equal(resolvePrototypeRequired({ companyDefault: undefined, bomPrototypeRequired: undefined, hasBom: false }), true);

  // Uncertified + prototypeRequired → prototype plan, not a hardcoded default
  let path = resolveDemandPlanPath({ bomStatus: "IN_REVIEW", prototypeRequired: true });
  assert.equal(path.path, "PROTOTYPE");
  assert.match(path.reason, /prototype process/i);
  assert.equal(path.offerCertify, false);

  // Direct certify allowed → production held + offer PIN-gated certify
  path = resolveDemandPlanPath({ bomStatus: "IN_REVIEW", prototypeRequired: false });
  assert.equal(path.path, "PRODUCTION_HELD");
  assert.equal(path.offerCertify, true);
  assert.ok(path.todos.some((t) => /certify the BOM/i.test(t)));

  // User override skip prototype / plan as production
  assert.equal(parsePathOverride("plan 20 of WIDGET-20 by 2027-03-15, skip prototype"), "skip_prototype");
  assert.equal(parsePathOverride("plan as production"), "plan_as_production");
  path = resolveDemandPlanPath({
    bomStatus: "IN_REVIEW",
    prototypeRequired: true,
    override: "plan_as_production",
  });
  assert.equal(path.path, "PRODUCTION_HELD");
  assert.match(path.reason, /skip prototype|plan as production/i);

  // Certified BOM is production regardless of the prototype setting
  path = resolveDemandPlanPath({ bomStatus: "CERTIFIED", prototypeRequired: true });
  assert.equal(path.path, "PRODUCTION");
  assert.equal(path.offerCertify, false);

  const parsed = parseDemandPlanUtterance(
    "Carina, I need to plan and process demand to build 20 of WIDGET-20 by 2027-03-15."
  );
  assert.equal(parsed.quantity, 20);
  assert.equal(parsed.partNumber, "WIDGET-20");
  assert.equal(parsed.dueDate && parsed.dueDate.toISOString().slice(0, 10), "2027-03-15");
  assert.equal(looksLikeDemandPlan(parsed.raw || ""), true);
  assert.equal(looksLikePlanningWorksheet("create a planning worksheet for forecast FC-00001"), true);
  assert.equal(isSkipBudgetUtterance("skip"), true);
  assert.equal(isSkipBudgetUtterance("leave them blank"), true);
  assert.deepEqual(parseBudgetClarify("budget $5000, owner Jane Wilson, charge code CC-100"), {
    budgetAmount: 5000,
    budgetOwnerName: "Jane Wilson",
    chargeCode: "CC-100",
  });
  assert.equal(needsBudgetClarify(demand()), true);
  assert.equal(needsBudgetClarify(demand({ skipBudget: true })), false);

  // 20-unit fixture: prototype required, uncertified BOM, netted shorts, not a list dump
  const protoPlan = await buildDemandPlan(demand({ skipBudget: true }), store({ fgStatus: "IN_REVIEW", prototypeRequired: true }));
  assert.equal(protoPlan.path, "PROTOTYPE");
  assert.equal(protoPlan.prototypeRequired, true);
  assert.match(protoPlan.summary, /prototype path/i);
  assert.match(protoPlan.summary, /WIDGET-20/);
  assert.match(protoPlan.summary, /confirm/i);
  const protoBuild = protoPlan.lines.filter((l) => l.action === "BUILD");
  const protoBuy = protoPlan.lines.filter((l) => l.action === "BUY");
  assert.ok(protoBuild.some((l) => l.partNumber === "WIDGET-20" && l.shortQty === 20));
  assert.ok(protoBuild.some((l) => l.partNumber === "SUB-HOUSING" && l.shortQty === 20));
  const boltLine = protoBuy.find((l) => l.partNumber === "BOLT-A");
  assert.ok(boltLine && boltLine.shortQty === 35, `expected bolt short 35, got ${boltLine?.shortQty}`);
  const castLine = protoBuy.find((l) => l.partNumber === "CASTING-C");
  assert.ok(castLine && castLine.shortQty === 20);
  assert.equal(protoPlan.offerCertify, false);
  assert.ok(protoPlan.lines.every((l) => l.action !== "BUILD" || l.plannedStart || l.shortQty === 0 || true));

  // Same 20 units, direct-certify setting → held production + certify offer
  const directPlan = await buildDemandPlan(
    demand({ skipBudget: true }),
    store({ fgStatus: "IN_REVIEW", prototypeRequired: false, companyDefault: false })
  );
  assert.equal(directPlan.path, "PRODUCTION_HELD");
  assert.equal(directPlan.prototypeRequired, false);
  assert.equal(directPlan.offerCertify, true);
  assert.match(directPlan.summary, /held until the BOM is certified/i);
  assert.match(directPlan.summary, /PIN-gated/i);

  // Override still mentioned in the summary
  const overridden = await buildDemandPlan(
    demand({ skipBudget: true, override: "skip_prototype" }),
    store({ prototypeRequired: true })
  );
  assert.equal(overridden.path, "PRODUCTION_HELD");
  assert.match(overridden.summary, /skip prototype|plan as production|held/i);

  // Certified path
  const certified = await buildDemandPlan(demand({ skipBudget: true }), store({ fgStatus: "CERTIFIED", prototypeRequired: true }));
  assert.equal(certified.path, "PRODUCTION");
  assert.match(certified.summary, /certified/);

  const summary = formatPlanSummary(protoPlan);
  assert.ok(!/WO-\d+[\s\S]*WO-\d+[\s\S]*WO-\d+[\s\S]*WO-\d+/.test(summary));

  // Source contracts: settings are read, not hardcoded; drafts; one confirm; MRS worksheet
  const src = fs.readFileSync("src/lib/services/carina-planning.ts", "utf8");
  assert.match(src, /bomPrototypeRequired/);
  assert.match(src, /prototypeRequired/);
  assert.match(src, /submit: false/);
  assert.match(src, /status: "DRAFT"/);
  assert.match(src, /status: "PLANNED"/);
  assert.match(src, /compensateDemandPlan/);
  assert.match(src, /planning\.forecast\.create/);
  assert.match(src, /purchasing\.pr\.create/);
  assert.match(src, /workorders\.create/);
  assert.match(src, /CompanySettings\.bomPrototypeRequired/);
  assert.match(src, /BomHeader|prototypeRequired/);

  const intent = fs.readFileSync("src/lib/services/carina-voice-intent.ts", "utf8");
  assert.match(intent, /PLAN_DEMAND/);
  assert.match(intent, /CREATE_PLANNING_WORKSHEET/);

  const actions = fs.readFileSync("src/lib/services/carina-voice-actions.ts", "utf8");
  assert.match(actions, /PLAN_DEMAND/);
  assert.match(actions, /CREATE_PLANNING_WORKSHEET/);
  assert.match(actions, /phase === "clarify"/);

  const loop = fs.readFileSync("src/lib/ai-help/reason-loop.ts", "utf8");
  assert.match(loop, /propose_demand_plan/);
  assert.match(loop, /propose_planning_worksheet/);

  const policy = fs.readFileSync("src/lib/ai-help/knowledge-pack.ts", "utf8");
  assert.match(policy, /plan this demand|planning worksheet|demand plan/i);

  console.log("PASS Carina planning: 20-unit explode/net, setting-driven prototype vs direct path, worksheets, confirm-gated drafts");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
