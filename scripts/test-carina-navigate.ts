import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildNavRegistry,
  looksLikeHowto,
  looksLikeNavigate,
  normalizeNavQuery,
  resolveNavRoutes,
  viewPermissionForHref,
  carinaTargetSelector,
} from "../src/lib/ai-help/nav-registry";
import {
  looksLikeRecordNav,
  resolveNavigation,
  resolvePageNavigation,
  type NavigateDeps,
} from "../src/lib/ai-help/navigate";
import {
  HOWTO_PENDING_ACTION,
  advanceHowto,
  formatHowtoTurn,
  isNextStepUtterance,
  matchHowtoGuide,
  startHowto,
} from "../src/lib/ai-help/howto";
import type { LookupStore } from "../src/lib/ai-help/lookup";
import type { LookupHit } from "../src/lib/ai-help/lookup-policy";

const registry = buildNavRegistry();

assert.ok(registry.some((r) => r.href === "/work-orders" && r.permission === "work-orders.view"));
assert.ok(registry.some((r) => r.href === "/purchasing?tab=prs" && r.synonyms.includes("purchase requests")));
assert.ok(registry.some((r) => r.href === "/planning?tab=capacity"));
assert.equal(viewPermissionForHref("/purchasing?tab=prs"), "purchasing.view");
assert.equal(viewPermissionForHref("/admin/settings"), "admin.view");
assert.equal(viewPermissionForHref("/account"), null);
assert.equal(viewPermissionForHref("/hr/timesheet"), null);
assert.equal(carinaTargetSelector("wo-create"), '[data-carina-target="wo-create"]');

assert.equal(looksLikeNavigate("open purchase requests"), true);
assert.equal(looksLikeNavigate("Take me to project Alpha"), true);
assert.equal(looksLikeNavigate("go to capacity planning"), true);
assert.equal(looksLikeHowto("How do I create a purchase request?"), true);
assert.equal(looksLikeNavigate("How do I create a purchase request?"), false);
assert.equal(looksLikeRecordNav("open WO-00008"), true);
assert.equal(looksLikeRecordNav("show me part WIDGET-20"), true);

// Synonym / page resolution
const prs = resolveNavRoutes("open purchase requests");
assert.ok(prs.unique, "purchase requests should resolve uniquely");
assert.equal(prs.unique!.route.href, "/purchasing?tab=prs");

const cap = resolveNavRoutes("go to capacity planning");
assert.ok(cap.unique);
assert.equal(cap.unique!.route.href, "/planning?tab=capacity");
assert.equal(cap.unique!.route.highlight, "planning-capacity");

const bom = resolveNavRoutes("settings for BOM prototype");
assert.ok(bom.unique);
assert.equal(bom.unique!.route.href, "/admin/settings");
assert.equal(bom.unique!.route.highlight, "bom-prototype-default");

const woPage = resolveNavRoutes("take me to work orders");
assert.ok(woPage.unique);
assert.equal(woPage.unique!.route.href, "/work-orders");

// Ambiguous page: a query that hits two strong, close labels
const ambiguousQuery = "purchase"; // "Purchasing", "Purchase requests", "Purchase orders", "New PR"
const amb = resolveNavRoutes(ambiguousQuery);
assert.ok(amb.ambiguous.length > 1, `expected ambiguous purchase matches, got ${amb.ambiguous.map((m) => m.route.label).join(",")}`);

function memoryStore(records: LookupHit[]): LookupStore {
  return {
    async search(entity, query) {
      const q = query.toLowerCase();
      return records.filter(
        (r) =>
          r.entity === entity &&
          (r.number.toLowerCase().includes(q) ||
            r.title.toLowerCase().includes(q) ||
            r.summary.toLowerCase().includes(q))
      );
    },
    async get(entity, idOrNumber) {
      const q = idOrNumber.toLowerCase();
      return (
        records.find((r) => r.entity === entity && (r.id === idOrNumber || r.number.toLowerCase() === q)) ||
        records.find((r) => r.entity === entity && r.number.toLowerCase().includes(q)) ||
        null
      );
    },
    async count(entity) {
      const rows = records.filter((r) => r.entity === entity);
      return { total: rows.length, byStatus: {} };
    },
  };
}

const records: LookupHit[] = [
  {
    entity: "work_order",
    id: "wo8",
    number: "WO-00008",
    title: "Assemble widget",
    href: "/work-orders/wo8",
    summary: "Assemble widget",
    fields: {},
  },
  {
    entity: "part",
    id: "p20",
    number: "WIDGET-20",
    title: "Widget",
    href: "/items/p20",
    summary: "Widget",
    fields: {},
  },
  {
    entity: "project",
    id: "prjA",
    number: "PRJ-00001",
    title: "Alpha",
    href: "/pmo/projects/prjA",
    summary: "Project Alpha",
    fields: {},
  },
  {
    entity: "project",
    id: "prjA2",
    number: "PRJ-00002",
    title: "Alpha Backup",
    href: "/pmo/projects/prjA2",
    summary: "Project Alpha Backup",
    fields: {},
  },
];

const allowAll: NavigateDeps = {
  userId: "u1",
  store: memoryStore(records),
  canView: async () => true,
  hasPermission: async () => true,
  registry,
};

const denyPurchasing: NavigateDeps = {
  ...allowAll,
  hasPermission: async (_id, perm) => perm !== "purchasing.view",
  canView: async (_id, module) => module !== "purchasing",
};

async function main() {
  const openPrs = await resolvePageNavigation("open purchase requests", allowAll);
  assert.ok(openPrs && openPrs.ok);
  assert.equal(openPrs!.href, "/purchasing?tab=prs");

  const denied = await resolvePageNavigation("open purchase requests", denyPurchasing);
  assert.ok(denied);
  assert.equal(denied!.kind, "denied");
  assert.match(denied!.text, /don’t have permission|don't have permission/i);
  assert.equal(denied!.href, undefined);

  const wo = await resolveNavigation("open WO-00008", allowAll);
  assert.equal(wo.kind, "navigate");
  assert.equal(wo.href, "/work-orders/wo8");
  assert.match(wo.text, /WO-00008/);

  const part = await resolveNavigation("show me part WIDGET-20", allowAll);
  assert.equal(part.kind, "navigate");
  assert.equal(part.href, "/items/p20");

  const project = await resolveNavigation("take me to project Alpha", allowAll);
  assert.equal(project.kind, "ambiguous");
  assert.match(project.text, /Which one/i);
  assert.ok(project.matches && project.matches.length >= 2);

  const deniedPart = await resolveNavigation("show me part WIDGET-20", {
    ...allowAll,
    canView: async () => false,
    hasPermission: async () => false,
  });
  assert.equal(deniedPart.kind, "denied");
  assert.equal(deniedPart.href, undefined);

  const how = matchHowtoGuide("How do I create a purchase request?");
  assert.ok(how);
  assert.equal(how!.id, "create-purchase-request");
  const first = startHowto("How do I create a purchase request?");
  assert.ok(first);
  assert.equal(first!.href, "/purchasing?tab=prs");
  assert.ok(first!.highlight?.target === "pr-po-tabs" || first!.highlight?.selector?.includes("pr-po-tabs"));
  assert.match(first!.text, /Say next/i);
  assert.match(first!.text, /Want me to do it/i);
  assert.equal(first!.pendingAction?.action, HOWTO_PENDING_ACTION);
  assert.equal(first!.guide?.stepByStep, true);

  assert.equal(isNextStepUtterance("next"), true);
  const second = advanceHowto(first!.pendingAction!, "next");
  assert.ok(second);
  assert.equal(second!.highlight?.target, "new-purchase-request");
  assert.match(second!.text, /New purchase request/i);

  const proto = startHowto("How do I change settings for BOM prototype?");
  assert.ok(proto);
  assert.equal(proto!.href, "/admin/settings");

  // Source contracts
  const point = fs.readFileSync("src/components/ai/carina-point.tsx", "utf8");
  assert.match(point, /data-carina-target/);
  const bubble = fs.readFileSync("src/components/support/support-bubble.tsx", "utf8");
  assert.match(bubble, /data-carina-target|stepByStep|howto/);
  const reason = fs.readFileSync("src/lib/ai-help/reason-loop.ts", "utf8");
  assert.match(reason, /name: "navigate"/);
  assert.match(reason, /explain_howto/);
  const ai = fs.readFileSync("src/lib/services/ai.ts", "utf8");
  assert.match(ai, /resolveNavigation|startHowto|advanceHowto/);

  console.log("PASS Carina navigate: routes, synonyms, records, permission denial, ambiguity, how-to steps");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
