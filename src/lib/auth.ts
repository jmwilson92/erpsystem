import { prisma } from "./db";
import { cookies } from "next/headers";

export const DEMO_USER_COOKIE = "forge-demo-user";

/**
 * Identity chokepoint. Order:
 *  1. Real login session (email+password → HttpOnly cookie) always wins.
 *  2. DEMO_MODE (default on): the sidebar persona switcher cookie, then
 *     DEMO_USER_ROLE. Set DEMO_MODE=0 in production to require login.
 *
 * `roleHint` is **deprecated and ignored** for identity. Call sites that
 * used getCurrentUser("CM") used to impersonate a random user of that
 * role in demo mode (wrong audit trail). Use requirePermission() instead.
 */
// roleHint kept for call-site compatibility; intentionally unused
export async function getCurrentUser(roleHint?: string) {
  void roleHint;
  // 1. Real session
  try {
    const { getSessionUser } = await import("./auth-core");
    const sessionUser = await getSessionUser();
    if (sessionUser) return sessionUser;
  } catch {
    /* outside request scope */
  }

  // 2. Demo fallback (evaluation / test-drive) — off when DEMO_MODE=0
  if (process.env.DEMO_MODE === "0") return null;

  // Persona switcher cookie first (never skip for a role hint)
  try {
    const jar = await cookies();
    const demoId = jar.get(DEMO_USER_COOKIE)?.value;
    if (demoId) {
      const byCookie = await prisma.user.findUnique({
        where: { id: demoId },
      });
      if (byCookie?.isActive) return byCookie;
    }
  } catch {
    // outside a request scope (scripts) — fall through
  }

  const role = process.env.DEMO_USER_ROLE || "ADMIN";
  const user = await prisma.user.findFirst({
    where: { role, isActive: true },
  });
  if (user) return user;
  return prisma.user.findFirst({ where: { isActive: true } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

export const ROLES = [
  "ADMIN",
  "ENGINEERING",
  "CM",
  "QUALITY",
  "PURCHASING",
  "PRODUCTION",
  "ACCOUNTING",
  "HR",
  "OPERATOR",
  "VIEWER",
  "PM",
  "EXECUTIVE", // CEO / CFO / COO / VP
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Catalog of permission codes used across modules.
 *
 * Every module has a `<module>.view` permission gating read access, plus
 * action permissions gating writes. Groups (admin/permissions) can mix
 * these freely so companies can shape their own access model.
 */
const MODULE_VIEWS: [string, string][] = [
  ["dashboard", "Dashboard"],
  ["floor", "Production Floor"],
  ["radiators", "Info Radiators"],
  ["value-stream", "Value Stream"],
  ["ai", "AI Assistant"],
  ["sales", "Sales & Quotes"],
  ["customers", "Customers"],
  ["shipping", "Shipping"],
  ["work-orders", "Work Orders"],
  ["work-instructions", "Work Instructions"],
  ["workcenters", "Workcenters"],
  ["kitting", "Kitting"],
  ["planning", "Planning & MRP"],
  ["engineering", "Engineering"],
  ["items", "Items"],
  ["bom", "BOMs"],
  ["products", "Products (PLM)"],
  ["cm", "Config Management"],
  ["uom", "UOM Master"],
  ["purchasing", "Purchasing"],
  ["receiving", "Receiving"],
  ["suppliers", "Suppliers / ASL"],
  ["inventory", "Inventory"],
  ["virtual-assets", "Virtual Assets"],
  ["qa", "QA Inspection"],
  ["test-center", "Test Center"],
  ["quality", "Quality / NCR"],
  ["mrb", "MRB / CAR"],
  ["government-property", "Government Property"],
  ["leadership", "Leadership"],
  ["pmo", "PMO"],
  ["accounting", "Accounting"],
  ["hr", "HR / Workforce"],
  ["approvals", "My Approvals"],
  ["admin", "Administration"],
];

const ACTION_PERMISSIONS: { code: string; name: string; module: string }[] = [
  // Sales
  { code: "sales.quote.create", name: "Create quotes", module: "sales" },
  { code: "sales.order.create", name: "Create sales orders", module: "sales" },
  { code: "sales.order.plan", name: "Plan fulfillment", module: "sales" },
  { code: "sales.order.ship", name: "Ship sales orders", module: "shipping" },
  { code: "customers.manage", name: "Create / edit customers", module: "customers" },
  // Manufacturing
  { code: "workorders.create", name: "Create work orders", module: "work-orders" },
  { code: "workorders.status.update", name: "Change WO status", module: "work-orders" },
  { code: "workorders.signoff", name: "Sign off WO steps", module: "work-orders" },
  { code: "workorders.complete", name: "Complete WO to stock", module: "work-orders" },
  { code: "wi.create", name: "Create work instructions", module: "work-instructions" },
  { code: "wi.edit", name: "Edit work instructions", module: "work-instructions" },
  { code: "wi.release", name: "Advance / release WIs", module: "work-instructions" },
  { code: "workcenters.manage", name: "Manage workcenters", module: "workcenters" },
  { code: "kitting.create", name: "Create kit orders", module: "kitting" },
  { code: "kitting.complete", name: "Complete kits", module: "kitting" },
  { code: "planning.forecast.create", name: "Create forecasts", module: "planning" },
  { code: "planning.mrs.release", name: "Release material requisitions", module: "planning" },
  // Engineering & PLM
  { code: "engineering.lane.manage", name: "Manage swim lanes", module: "engineering" },
  { code: "engineering.task.create", name: "Create eng tasks", module: "engineering" },
  { code: "engineering.task.scan", name: "Scan into tasks", module: "engineering" },
  { code: "items.manage", name: "Create / edit items", module: "items" },
  { code: "bom.edit", name: "Edit BOMs", module: "bom" },
  { code: "bom.certify", name: "Certify BOM revisions", module: "bom" },
  { code: "products.manage", name: "Manage products", module: "products" },
  { code: "cm.ecr.create", name: "Create ECRs", module: "cm" },
  { code: "cm.ecr.manage", name: "Manage ECRs", module: "cm" },
  { code: "cm.vote", name: "Vote on change board", module: "cm" },
  { code: "uom.manage", name: "Manage UOM master", module: "uom" },
  // Supply chain
  { code: "purchasing.pr.create", name: "Create purchase requests", module: "purchasing" },
  { code: "purchasing.pr.approve", name: "Approve purchase requests", module: "purchasing" },
  { code: "purchasing.po.convert", name: "Convert PR to PO", module: "purchasing" },
  { code: "purchasing.po.close", name: "Close purchase orders", module: "purchasing" },
  { code: "purchasing.policy.manage", name: "Edit PR approval policy", module: "purchasing" },
  { code: "receiving.receive", name: "Receive material", module: "receiving" },
  { code: "receiving.putaway", name: "Put away stock", module: "receiving" },
  { code: "receiving.gfp.create", name: "Create GFP travelers", module: "receiving" },
  { code: "suppliers.manage", name: "Manage suppliers / ASL", module: "suppliers" },
  { code: "suppliers.scorecard.refresh", name: "Refresh scorecards", module: "suppliers" },
  { code: "inventory.putaway", name: "Inventory putaway / moves", module: "inventory" },
  { code: "va.manage", name: "Manage virtual assets", module: "virtual-assets" },
  // Quality
  { code: "qa.inspect", name: "Record QA inspections", module: "qa" },
  { code: "test.record", name: "Record test results", module: "test-center" },
  { code: "quality.ncr.create", name: "Create NCRs", module: "quality" },
  { code: "quality.ncr.manage", name: "Manage NCRs", module: "quality" },
  { code: "mrb.disposition", name: "Disposition MRB cases", module: "mrb" },
  { code: "mrb.car.manage", name: "Manage CARs", module: "mrb" },
  { code: "rma.view", name: "View RMAs", module: "quality" },
  { code: "rma.create", name: "Create RMA requests", module: "quality" },
  { code: "rma.issue", name: "Issue / approve RMAs", module: "quality" },
  { code: "rma.adjust_price", name: "Adjust RMA repair quote price", module: "quality" },
  { code: "serials.manage", name: "Install/remove serial as-built", module: "work-orders" },
  { code: "gfp.manage", name: "Manage government property", module: "government-property" },
  // Programs & business
  { code: "leadership.priority.read", name: "Read business priorities", module: "leadership" },
  { code: "leadership.priority.manage", name: "Publish business priorities", module: "leadership" },
  { code: "pmo.program.manage", name: "Manage programs", module: "pmo" },
  { code: "pmo.project.manage", name: "Manage projects", module: "pmo" },
  { code: "pmo.quarter.manage", name: "Manage PI quarters/sprints", module: "pmo" },
  { code: "pmo.alerts.read", name: "Read PM dependency alerts", module: "pmo" },
  { code: "budgets.manage", name: "Create / enact budgets & charge codes", module: "pmo" },
  { code: "accounting.journal.post", name: "Post journal entries", module: "accounting" },
  { code: "accounting.reports.read", name: "View GAAP reports", module: "accounting" },
  { code: "accounting.account.create", name: "Create GL accounts", module: "accounting" },
  // HR
  { code: "hr.admin", name: "HR administration (all employees)", module: "hr" },
  { code: "hr.pto.request", name: "Request PTO", module: "hr" },
  { code: "hr.pto.decide", name: "Approve / reject PTO", module: "hr" },
  { code: "hr.time.decide", name: "Approve / reject timesheets", module: "hr" },
  { code: "hr.expense.decide", name: "Approve / pay expenses", module: "hr" },
  { code: "hr.review.manage", name: "Write performance reviews", module: "hr" },
  { code: "hr.goal.manage", name: "Manage employee goals", module: "hr" },
  { code: "hr.docs.manage", name: "Manage employee documents", module: "hr" },
  // Admin
  { code: "admin.permissions", name: "Assign permissions", module: "admin" },
  { code: "admin.users.manage", name: "Manage users / org chart", module: "admin" },
];

export const PERMISSIONS: { code: string; name: string; module: string }[] = [
  ...MODULE_VIEWS.map(([module, label]) => ({
    code: `${module}.view`,
    name: `View ${label}`,
    module,
  })),
  ...ACTION_PERMISSIONS,
];

export function canAccess(role: string, module: string): boolean {
  if (role === "ADMIN") return true;
  const matrix: Record<string, string[]> = {
    ENGINEERING: [
      "bom",
      "work-instructions",
      "cm",
      "products",
      "engineering",
      "projects",
      "pmo",
      "dashboard",
      "sales",
      "leadership",
    ],
    CM: [
      "bom",
      "work-instructions",
      "cm",
      "products",
      "quality",
      "engineering",
      "dashboard",
      "leadership",
    ],
    QUALITY: [
      "quality",
      "mrb",
      "cm",
      "inventory",
      "suppliers",
      "dashboard",
      "work-orders",
      "test-center",
      "receiving",
      "leadership",
    ],
    PURCHASING: [
      "purchasing",
      "suppliers",
      "inventory",
      "value-stream",
      "dashboard",
      "sales",
      "customers",
      "leadership",
    ],
    PRODUCTION: [
      "work-orders",
      "work-instructions",
      "floor",
      "inventory",
      "dashboard",
      "shipping",
      "kitting",
      "sales",
      "customers",
      "test-center",
      "workcenters",
      "leadership",
    ],
    ACCOUNTING: [
      "accounting",
      "projects",
      "pmo",
      "dashboard",
      "leadership",
    ],
    HR: ["hr", "dashboard", "leadership"],
    OPERATOR: [
      "work-orders",
      "floor",
      "dashboard",
      "kitting",
      "test-center",
      "leadership",
    ],
    VIEWER: [
      "dashboard",
      "floor",
      "radiators",
      "value-stream",
      "sales",
      "test-center",
      "leadership",
    ],
    PM: ["pmo", "projects", "engineering", "products", "dashboard", "leadership", "cm"],
    EXECUTIVE: [
      "leadership",
      "dashboard",
      "pmo",
      "accounting",
      "products",
      "engineering",
      "sales",
      "projects",
    ],
  };
  return matrix[role]?.includes(module) ?? false;
}

/** Check fine-grained permission (group + direct grants). ADMIN always true. */
export async function userHasPermission(
  userId: string | undefined | null,
  permissionCode: string
): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  // Explicit deny / grant. Temporary grants (expiresAt) lapse silently.
  const direct = await prisma.userPermission.findFirst({
    where: {
      userId,
      permission: { code: permissionCode },
    },
    include: { permission: true },
  });
  if (direct && !direct.allowed) return false;
  if (direct?.allowed && (!direct.expiresAt || direct.expiresAt > new Date())) {
    return true;
  }

  const viaGroup = await prisma.userPermissionGroup.findFirst({
    where: {
      userId,
      group: {
        permissions: { some: { permission: { code: permissionCode } } },
      },
    },
  });
  if (viaGroup) return true;

  // View permissions default from the role/module matrix so groups only
  // need to encode deviations from it.
  if (permissionCode.endsWith(".view")) {
    const moduleKey = permissionCode.slice(0, -".view".length);
    if (moduleKey === "hr" || moduleKey === "approvals") return true; // own profile / own queue
    return canAccess(user.role, moduleKey);
  }

  // Action defaults per role (companies override via groups/grants)
  const roleDefaults: Record<string, string[]> = {
    PM: [
      "pmo.alerts.read",
      "pmo.project.manage",
      "pmo.program.manage",
      "pmo.quarter.manage",
      "budgets.manage",
      "purchasing.pr.create",
      "leadership.priority.read",
    ],
    EXECUTIVE: [
      "leadership.priority.manage",
      "leadership.priority.read",
      "accounting.reports.read",
      "pmo.alerts.read",
    ],
    ACCOUNTING: ["accounting.journal.post", "accounting.reports.read", "accounting.account.create", "hr.expense.decide"],
    ENGINEERING: [
      "engineering.task.create",
      "engineering.task.scan",
      "engineering.lane.manage",
      "items.manage",
      "bom.edit",
      "bom.certify",
      "cm.ecr.create",
      "cm.vote",
      "wi.create",
      "wi.edit",
      "purchasing.pr.create",
      "leadership.priority.read",
    ],
    CM: [
      "cm.ecr.create",
      "cm.ecr.manage",
      "cm.vote",
      "wi.release",
      "bom.certify",
      "products.manage",
    ],
    PURCHASING: ["purchasing.pr.create", "purchasing.pr.approve", "purchasing.po.convert", "purchasing.po.close", "receiving.receive", "receiving.putaway", "suppliers.manage", "suppliers.scorecard.refresh"],
    PRODUCTION: [
      "workorders.create",
      "workorders.status.update",
      "workorders.signoff",
      "workorders.complete",
      "kitting.create",
      "kitting.complete",
      "workcenters.manage",
      "inventory.putaway",
      "sales.order.ship",
      "receiving.receive",
      "receiving.putaway",
      "serials.manage",
      "purchasing.pr.create",
      "rma.view",
      "rma.create",
    ],
    QUALITY: [
      "qa.inspect",
      "test.record",
      "quality.ncr.create",
      "quality.ncr.manage",
      "mrb.disposition",
      "mrb.car.manage",
      "rma.view",
      "rma.create",
      "rma.issue",
      "rma.adjust_price",
      "serials.manage",
    ],
    OPERATOR: [
      "workorders.signoff",
      "kitting.complete",
      "test.record",
      "serials.manage",
    ],
    HR: ["hr.admin", "hr.pto.request", "hr.pto.decide", "hr.time.decide", "hr.expense.decide", "hr.review.manage", "hr.goal.manage", "hr.docs.manage", "admin.users.manage"],
    ADMIN: PERMISSIONS.map((p) => p.code),
  };
  if (roleDefaults[user.role]?.includes(permissionCode)) return true;

  // Everyone may request their own PTO by default.
  if (permissionCode === "hr.pto.request") return true;
  return false;
}

/** View gate for a module: `<module>.view` permission (group/grant aware). */
export async function userCanView(
  userId: string | undefined | null,
  module: string
): Promise<boolean> {
  return userHasPermission(userId, `${module}.view`);
}

/**
 * Whether a user may see money figures (revenue, cash, AR/AP, margins).
 * Gated on the GAAP-reports permission so financials stay need-to-know.
 */
export async function userCanSeeFinancials(
  userId: string | undefined | null
): Promise<boolean> {
  return userHasPermission(userId, "accounting.reports.read");
}

/** Require a signed-in user (session or demo persona). */
export async function requireUser(roleHint?: string) {
  const user = await getCurrentUser(roleHint);
  if (!user) {
    throw new Error("Sign in required");
  }
  return user;
}

/**
 * Hard gate for mutating server actions.
 * ADMIN always passes (via userHasPermission). Everyone else needs an
 * explicit grant / group / role default. Throws on deny — never soft-falls.
 */
export async function requirePermission(
  permissionCode: string,
  roleHint?: string
) {
  const user = await requireUser(roleHint);
  const ok = await userHasPermission(user.id, permissionCode);
  if (!ok) {
    // Land on the friendly no-access page (with a request-permission
    // button) instead of a masked server error.
    const { redirect } = await import("next/navigation");
    redirect(`/no-access?code=${encodeURIComponent(permissionCode)}`);
  }
  return user;
}
