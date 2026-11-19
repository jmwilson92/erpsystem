import assert from "node:assert/strict";
import {
  alertsToNotify,
  answerFloorStatus,
  buildFloorSnapshot,
  evaluateCapacity,
  evaluateLowStock,
  formatFloorDetail,
  formatFloorOverview,
  formatLowStockMessage,
  isFloorPrOfferAccept,
  looksLikeFloorStatus,
  parseFloorDetailTopic,
  runFloorMonitor,
  type CapacityWeekInput,
  type FloorAlertRecord,
  type FloorSignals,
  type PartStockInput,
} from "../src/lib/services/carina-floor";

assert.equal(looksLikeFloorStatus("Give me the status of my floor"), true);
assert.equal(looksLikeFloorStatus("what's the status of the shop floor?"), true);
assert.equal(looksLikeFloorStatus("How's my production floor looking"), true);
assert.equal(looksLikeFloorStatus("How do I give the status of my floor"), false);
assert.equal(looksLikeFloorStatus("add to your list: count open work orders"), false);
assert.equal(parseFloorDetailTopic("tell me more about the low-stock parts"), "low_stock");
assert.equal(parseFloorDetailTopic("which work center is overloaded"), "capacity");
assert.equal(parseFloorDetailTopic("which work orders are late"), "late");
assert.equal(parseFloorDetailTopic("what about quality holds"), "quality");
assert.equal(isFloorPrOfferAccept("yes, draft a PR"), true);
assert.equal(isFloorPrOfferAccept("go ahead"), true);
assert.equal(isFloorPrOfferAccept("count open work orders"), false);
assert.equal(formatLowStockMessage("BOLT-4", 3.2), "You're running low on BOLT-4 (~3 days of cover)");
assert.equal(formatLowStockMessage("BOLT-4", 1), "You're running low on BOLT-4 (~1 day of cover)");
assert.equal(formatLowStockMessage("BOLT-4", null), "You're running low on BOLT-4");

const parts: PartStockInput[] = [
  {
    id: "p-bolt",
    partNumber: "BOLT-4",
    href: "/parts/p-bolt",
    onHand: 10,
    inbound: 0,
    woDemand: 8,
    forecastDemand: 0,
    minStock: 0,
    reorderPoint: 0,
    safetyStock: 0,
    usage30: 90, // 3/day → ~3 days of cover
    usage90: 200,
  },
  {
    id: "p-slow",
    partNumber: "GASKET-1",
    href: "/parts/p-slow",
    onHand: 2,
    inbound: 0,
    woDemand: 0,
    forecastDemand: 0,
    minStock: 5,
    reorderPoint: 5,
    safetyStock: 0,
    usage30: 2, // low usage, below ROP
    usage90: 6,
  },
  {
    id: "p-ok",
    partNumber: "WIDGET-20",
    href: "/parts/p-ok",
    onHand: 400,
    inbound: 50,
    woDemand: 20,
    forecastDemand: 10,
    minStock: 20,
    reorderPoint: 40,
    safetyStock: 10,
    usage30: 30,
    usage90: 90,
  },
  {
    id: "p-demand",
    partNumber: "PIN-9",
    href: "/parts/p-demand",
    onHand: 4,
    inbound: 1,
    woDemand: 12,
    forecastDemand: 0,
    minStock: 0,
    reorderPoint: 0,
    safetyStock: 0,
    usage30: 0,
    usage90: 0,
  },
];

const low = evaluateLowStock(parts);
assert.equal(low.some((a) => a.partNumber === "WIDGET-20"), false, "healthy part should not alert");
assert.ok(low[0], "expected low-stock alerts");
assert.equal(low[0].partNumber, "BOLT-4", "high-usage parts surface first");
assert.match(low[0].title, /You're running low on BOLT-4 \(~3 days of cover\)/);
assert.ok(low[0].daysOfCover != null && low[0].daysOfCover <= 4);
const gasket = low.find((a) => a.partNumber === "GASKET-1");
assert.ok(gasket, "below reorder point should alert");
assert.equal(gasket!.conditionKey, "below-threshold");
const pin = low.find((a) => a.partNumber === "PIN-9");
assert.ok(pin, "short vs open WO demand should alert");
assert.equal(pin!.conditionKey, "short-vs-demand");
assert.match(pin!.title, /You're running low on PIN-9/);

const week = new Date("2026-11-23T08:00:00");
const weeks: CapacityWeekInput[] = [
  {
    weekStart: week,
    workCenterId: "wc-mill",
    code: "MILL",
    name: "Milling",
    availableHours: 80,
    projectedHours: 120,
  },
  {
    weekStart: week,
    workCenterId: "wc-assy",
    code: "ASSY",
    name: "Assembly",
    availableHours: 80,
    projectedHours: 70,
  },
  {
    weekStart: new Date("2026-11-30T08:00:00"),
    workCenterId: "wc-mill",
    code: "MILL",
    name: "Milling",
    availableHours: 80,
    projectedHours: 80,
  },
];
const cap = evaluateCapacity(weeks);
assert.equal(cap.length, 1);
assert.equal(cap[0].workCenter, "MILL");
assert.match(
  cap[0].title,
  /Staffing needed: MILL is at 150% load the week of Nov 23, short about 40 hours/
);
assert.equal(cap[0].conditionKey, "pct:150");

const signals: FloorSignals = {
  openWorkOrders: 12,
  inProgressWorkOrders: 4,
  lateWorkOrders: [
    { id: "wo1", number: "WO-00008", dueDate: new Date("2026-11-10"), href: "/work-orders/wo1" },
  ],
  overAllocatedWorkOrders: [
    { id: "wo2", number: "WO-00009", percent: 118, href: "/work-orders/wo2" },
  ],
  pastDuePurchaseOrders: [
    { id: "po1", number: "PO-00021", promisedDate: new Date("2026-11-12"), href: "/purchasing/po/po1" },
  ],
  openNcrs: [{ id: "n1", number: "NCR-00004", href: "/quality/ncr/n1" }],
  openMrb: 1,
  pendingApprovals: 2,
};

const snapshot = buildFloorSnapshot({ now: week, parts, weeks, signals });
const overview = formatFloorOverview(snapshot);
assert.match(overview, /12 open work orders/);
assert.match(overview, /1 late/);
assert.match(overview, /You're running low on BOLT-4/);
assert.match(overview, /Staffing needed: MILL/);
assert.match(overview, /Want more detail/);
// Voice-friendly: a few short sentences, not a dump
assert.ok(overview.split(/(?<=\.)\s+/).length <= 8);

const stockDetail = formatFloorDetail(snapshot, "low_stock");
assert.match(stockDetail.text, /You're running low on BOLT-4/);
assert.match(stockDetail.text, /Want me to draft a purchase request for BOLT-4/);
assert.equal(stockDetail.offerPrPart?.partNumber, "BOLT-4");
assert.equal(stockDetail.href, "/parts/p-bolt");

const capDetail = formatFloorDetail(snapshot, "capacity");
assert.match(capDetail.text, /Staffing needed: MILL/);
assert.equal(capDetail.href, "/planning?tab=capacity");

const existing: FloorAlertRecord[] = [
  { type: "LOW_STOCK", fingerprint: "p-bolt", conditionKey: "1-3" },
];
const first = alertsToNotify(snapshot, []);
assert.ok(first.some((a) => a.type === "LOW_STOCK" && a.fingerprint === "p-bolt"));
assert.ok(first.some((a) => a.type === "CAPACITY"));
assert.ok(first.some((a) => a.type === "DIGEST"));
const same = alertsToNotify(snapshot, first.map((a) => ({ type: a.type, fingerprint: a.fingerprint, conditionKey: a.conditionKey })));
assert.equal(same.length, 0, "same condition should not re-notify");
const changed = alertsToNotify(snapshot, [{ type: "LOW_STOCK", fingerprint: "p-bolt", conditionKey: "0" }, ...existing.filter((e) => e.fingerprint !== "p-bolt")]);
assert.ok(changed.some((a) => a.fingerprint === "p-bolt"), "changed cover bucket should re-notify");

async function main() {
  let lastMonitor: Date | null = new Date("2026-11-19T08:00:00");
  const stored: FloorAlertRecord[] = [];
  const notices: string[] = [];
  const depsBase = {
    now: () => new Date("2026-11-19T08:20:00"),
    loadSnapshot: async () => snapshot,
    getLastMonitorAt: async () => lastMonitor,
    markMonitorRun: async (at: Date) => {
      lastMonitor = at;
    },
    existingAlerts: async () => stored,
    recordAlert: async (alert: FloorAlertRecord) => {
      const i = stored.findIndex((s) => s.type === alert.type && s.fingerprint === alert.fingerprint);
      if (i >= 0) stored[i] = alert;
      else stored.push(alert);
    },
    notify: async (params: { title: string }) => {
      notices.push(params.title);
      return 1;
    },
  };

  const skipped = await runFloorMonitor(depsBase);
  assert.equal(skipped.ran, false, "hourly debounce should skip a 20-minute follow-up");
  assert.equal(notices.length, 0);

  lastMonitor = new Date("2026-11-19T07:00:00");
  const ran = await runFloorMonitor({ ...depsBase, now: () => new Date("2026-11-19T08:20:00") });
  assert.equal(ran.ran, true);
  assert.ok(ran.notified > 0);
  assert.ok(notices.some((t) => /You're running low on BOLT-4/.test(t)));
  assert.ok(notices.some((t) => /Staffing needed: MILL/.test(t)));
  const countAfterFirst = notices.length;

  const again = await runFloorMonitor({ ...depsBase, now: () => new Date("2026-11-19T10:00:00") });
  assert.equal(again.ran, true);
  assert.equal(notices.length, countAfterFirst, "unchanged conditions should not notify again");

  const overviewTurn = await answerFloorStatus({
    question: "Give me the status of my floor",
    pending: null,
    loadSnapshot: async () => snapshot,
  });
  assert.ok(overviewTurn);
  assert.match(overviewTurn!.text, /Want more detail/);
  assert.equal(overviewTurn!.pendingAction.action, "FLOOR_STATUS");

  const detailTurn = await answerFloorStatus({
    question: "tell me more about the low-stock parts",
    pending: overviewTurn!.pendingAction,
    loadSnapshot: async () => snapshot,
  });
  assert.ok(detailTurn);
  assert.match(detailTurn!.text, /draft a purchase request for BOLT-4/);

  const genericWithoutPending = await answerFloorStatus({
    question: "tell me more",
    pending: null,
    loadSnapshot: async () => snapshot,
  });
  assert.equal(genericWithoutPending, null);

  const standaloneCap = await answerFloorStatus({
    question: "which work center is overloaded",
    pending: null,
    loadSnapshot: async () => snapshot,
  });
  assert.ok(standaloneCap);
  assert.match(standaloneCap!.text, /Staffing needed: MILL/);

  console.log("test-carina-floor: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
