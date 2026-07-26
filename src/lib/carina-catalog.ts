/**
 * Carina UI catalog (Approach B).
 *
 * She may ONLY navigate/highlight entries from this file. No free-form CSS.
 * Keep it immaculate:
 *   1. Every selector must exist as data-tour on a real page
 *   2. Every route must match a real Next.js path (no query strings in route
 *      for the tour engine — put tab hints in body text)
 *   3. keywords power local matching when the model is off or forgets an id
 *   4. Prefer region anchors (tables, forms, tabs) over tiny icons
 *
 * Adding a highlight: put data-tour="foo" on the element, then add a CatalogAnchor.
 */

export type CatalogAnchor = {
  /** Stable id Carina references — never change casually */
  id: string;
  /** Human label for speech + UI */
  label: string;
  /** Bare pathname (no ?query) — tour engine compares to usePathname() */
  route: string;
  /** Must be `[data-tour="…"]` from this app */
  selector: string;
  /** What this region is for (spoken + model context) */
  description: string;
  /** Match terms for invent / local fallback */
  keywords: string[];
  /** Nav group for grouping in prompts */
  area:
    | "shell"
    | "overview"
    | "sales"
    | "manufacturing"
    | "engineering"
    | "supply"
    | "quality"
    | "programs"
    | "admin";
  /** Prefer when inventing multi-step flows for this domain */
  priority?: number;
};

/**
 * Master anchor list. page-header is valid on almost every module page.
 * Prefer a specific region when one exists.
 */
export const CATALOG_ANCHORS: CatalogAnchor[] = [
  // ── Shell (always available) ───────────────────────────────────────
  {
    id: "shell-sidebar",
    label: "Sidebar navigation",
    route: "/",
    selector: '[data-tour="sidebar"]',
    description: "Module map — every area of the ERP lives here.",
    keywords: ["sidebar", "module menu", "navigation rail", "main menu"],
    area: "shell",
    priority: 1,
  },
  {
    id: "shell-search",
    label: "Global search",
    route: "/",
    selector: '[data-tour="global-search"]',
    description: "⌘K / Ctrl-K search for work orders, POs, parts, customers.",
    keywords: ["search", "find", "command palette", "jump"],
    area: "shell",
    priority: 2,
  },
  {
    id: "shell-notifications",
    label: "Notifications bell",
    route: "/",
    selector: '[data-tour="notifications"]',
    description: "Approvals, holds, and items waiting on you.",
    keywords: ["bell", "alerts", "notifications", "inbox"],
    area: "shell",
  },
  {
    id: "shell-help",
    label: "Help / Guides",
    route: "/",
    selector: '[data-tour="help"]',
    description: "Opens Guides hub for interactive tours.",
    keywords: ["help", "guides", "tours", "tutorial"],
    area: "shell",
  },
  {
    id: "shell-account",
    label: "Account menu",
    route: "/",
    selector: '[data-tour="account-menu"]',
    description: "Profile, sign out, account settings.",
    keywords: ["account", "profile", "sign out", "logout"],
    area: "shell",
  },
  {
    id: "nav-manufacturing",
    label: "Manufacturing nav group",
    route: "/",
    selector: '[data-tour="nav-group-manufacturing"]',
    description: "Work Orders, Workcenters, Test Center, Kitting, Planning.",
    keywords: ["manufacturing menu", "shop modules"],
    area: "shell",
  },
  {
    id: "nav-supply",
    label: "Supply chain nav group",
    route: "/",
    selector: '[data-tour="nav-group-supply-chain"]',
    description: "Items, Purchasing, Receiving, Inventory, Suppliers.",
    keywords: ["supply chain menu", "purchasing menu"],
    area: "shell",
  },
  {
    id: "nav-quality",
    label: "Quality nav group",
    route: "/",
    selector: '[data-tour="nav-group-quality-compliance"]',
    description: "QA, NCR, MRB, RMA, serial trace, QMS programs.",
    keywords: ["quality menu", "compliance menu"],
    area: "shell",
  },
  {
    id: "nav-engineering",
    label: "Engineering nav group",
    route: "/",
    selector: '[data-tour="nav-group-engineering-plm"]',
    description: "Requirements, BOMs, WI, products, CM.",
    keywords: ["engineering menu", "plm menu"],
    area: "shell",
  },
  {
    id: "nav-programs",
    label: "Programs & business nav group",
    route: "/",
    selector: '[data-tour="nav-group-programs-business"]',
    description: "Reports, PMO, budgets, accounting, HR.",
    keywords: ["finance menu", "pmo menu", "hr menu"],
    area: "shell",
  },

  // ── Overview ───────────────────────────────────────────────────────
  {
    id: "dashboard-header",
    label: "Dashboard",
    route: "/",
    selector: '[data-tour="page-header"]',
    description: "Home command center KPIs and pulse.",
    keywords: ["dashboard", "home", "kpi", "overview"],
    area: "overview",
  },
  {
    id: "floor-board",
    label: "Production floor board",
    route: "/floor",
    selector: '[data-tour="floor-board"]',
    description: "Live work orders by status / work center on the floor.",
    keywords: ["floor", "shop floor", "live jobs", "production board"],
    area: "overview",
    priority: 5,
  },
  {
    id: "floor-header",
    label: "Production floor",
    route: "/floor",
    selector: '[data-tour="page-header"]',
    description: "Production floor page.",
    keywords: ["floor page"],
    area: "overview",
  },
  {
    id: "radiators-kpis",
    label: "Info radiator tiles",
    route: "/radiators",
    selector: '[data-tour="radiator-kpis"]',
    description: "Wall-display KPIs for the shop.",
    keywords: ["radiator", "wall display", "big screen"],
    area: "overview",
  },
  {
    id: "vsm-stages",
    label: "Value stream stages",
    route: "/value-stream",
    selector: '[data-tour="vsm-stages"]',
    description: "Flow health by stage — constraints and bottlenecks.",
    keywords: ["value stream", "vsm", "bottleneck", "constraint"],
    area: "overview",
  },
  {
    id: "approvals-stats",
    label: "My approvals",
    route: "/approvals",
    selector: '[data-tour="approvals-stats"]',
    description: "Items waiting on your decision.",
    keywords: ["approvals", "approve", "pending me"],
    area: "overview",
  },
  {
    id: "timesheet-card",
    label: "My timesheet",
    route: "/hr/timesheet",
    selector: '[data-tour="timecard"]',
    description: "Log hours against charge codes / work orders.",
    keywords: ["timesheet", "time entry", "hours", "timecard"],
    area: "overview",
  },
  {
    id: "account-security",
    label: "Account security",
    route: "/account",
    selector: '[data-tour="account-security"]',
    description: "Password, sessions, electronic sign-off PIN.",
    keywords: ["password", "pin", "security", "my account"],
    area: "overview",
  },
  {
    id: "ai-header",
    label: "My AI assistant settings",
    route: "/ai",
    selector: '[data-tour="page-header"]',
    description: "Carina settings (wake name, diagnostics). Day-to-day use is the help bubble.",
    keywords: ["ai settings", "carina settings", "assistant settings", "wake word"],
    area: "admin",
  },
  {
    id: "settings-ai",
    label: "Company settings · AI",
    route: "/admin/settings",
    selector: '[data-tour="settings-ai"]',
    description: "Link to My AI assistant under company settings.",
    keywords: ["ai company settings", "my ai assistant"],
    area: "admin",
  },

  // ── Sales ──────────────────────────────────────────────────────────
  {
    id: "quote-new",
    label: "New quote button",
    route: "/sales/quotes",
    selector: '[data-tour="quote-new"]',
    description: "Start a customer quote.",
    keywords: ["quote", "rfq", "estimate", "quotation", "new quote"],
    area: "sales",
    priority: 8,
  },
  {
    id: "quotes-header",
    label: "Quotes list",
    route: "/sales/quotes",
    selector: '[data-tour="page-header"]',
    description: "All customer quotes.",
    keywords: ["quotes page"],
    area: "sales",
  },
  {
    id: "so-table",
    label: "Sales orders table",
    route: "/sales",
    selector: '[data-tour="so-table"]',
    description: "Open and in-progress sales orders.",
    keywords: ["sales order", "so", "booking", "customer order"],
    area: "sales",
    priority: 7,
  },
  {
    id: "customers-header",
    label: "Customers",
    route: "/customers",
    selector: '[data-tour="page-header"]',
    description: "Customer accounts, credit, terms.",
    keywords: ["customer", "crm", "account"],
    area: "sales",
  },
  {
    id: "shipping-header",
    label: "Shipping",
    route: "/shipping",
    selector: '[data-tour="page-header"]',
    description: "Pack and ship ready sales orders.",
    keywords: ["ship", "shipping", "pack", "packing list"],
    area: "sales",
  },

  // ── Manufacturing ──────────────────────────────────────────────────
  {
    id: "wo-create",
    label: "Create work order",
    route: "/work-orders",
    selector: '[data-tour="wo-create"]',
    description: "Form to create a production or prototype work order.",
    keywords: [
      "create work order",
      "new work order",
      "create wo",
      "new wo",
      "make job",
      "start work order",
      "open work order form",
    ],
    area: "manufacturing",
    priority: 10,
  },
  {
    id: "wo-list-header",
    label: "Work orders list",
    route: "/work-orders",
    selector: '[data-tour="page-header"]',
    description: "All work orders — filter, open, manage jobs.",
    keywords: ["work orders", "wo list", "all jobs", "list travelers"],
    area: "manufacturing",
    priority: 6,
  },
  {
    id: "kitting-board",
    label: "Kitting board",
    route: "/kitting",
    selector: '[data-tour="kitting-board"]',
    description: "Pull kits for released work orders; shortages show here.",
    keywords: ["kit", "kitting", "pick list", "shortage", "stage material"],
    area: "manufacturing",
    priority: 8,
  },
  {
    id: "kitting-header",
    label: "Kitting",
    route: "/kitting",
    selector: '[data-tour="page-header"]',
    description: "Kitting module.",
    keywords: ["kitting page"],
    area: "manufacturing",
  },
  {
    id: "planning-capacity",
    label: "Planning capacity",
    route: "/planning",
    selector: '[data-tour="planning-capacity"]',
    description: "Rough-cut capacity, load vs hours, backlog.",
    keywords: ["planning", "mrp", "capacity", "forecast", "mrs"],
    area: "manufacturing",
    priority: 7,
  },
  {
    id: "workcenters-header",
    label: "Workcenters",
    route: "/workcenters",
    selector: '[data-tour="page-header"]',
    description: "Cells, machines, queues, capacity.",
    keywords: ["workcenter", "cell", "machine", "station"],
    area: "manufacturing",
  },
  {
    id: "test-center-header",
    label: "Test center",
    route: "/test-center",
    selector: '[data-tour="page-header"]',
    description: "Functional / acceptance test runs.",
    keywords: ["test center", "functional test", "burn-in", "acceptance test"],
    area: "manufacturing",
  },

  // ── Engineering ────────────────────────────────────────────────────
  {
    id: "bom-header",
    label: "BOMs",
    route: "/bom",
    selector: '[data-tour="page-header"]',
    description: "Bills of material and revisions.",
    keywords: ["bom", "bill of materials", "structure", "revision"],
    area: "engineering",
    priority: 6,
  },
  {
    id: "requirements-header",
    label: "Requirements",
    route: "/requirements",
    selector: '[data-tour="page-header"]',
    description: "Shall statements, verification, coverage.",
    keywords: ["requirements", "shall", "trace", "verification"],
    area: "engineering",
  },
  {
    id: "wi-header",
    label: "Work instructions",
    route: "/work-instructions",
    selector: '[data-tour="page-header"]',
    description: "Released work instructions / routers.",
    keywords: ["work instruction", "wi", "router", "steps"],
    area: "engineering",
  },
  {
    id: "cm-tabs",
    label: "Configuration management tabs",
    route: "/cm",
    selector: '[data-tour="cm-tabs"]',
    description: "ECR/ECO change control workspace.",
    keywords: ["ecr", "eco", "change control", "cm", "configuration"],
    area: "engineering",
    priority: 6,
  },
  {
    id: "products-header",
    label: "Products PLM",
    route: "/products",
    selector: '[data-tour="page-header"]',
    description: "Product catalog / lifecycle.",
    keywords: ["product", "plm", "catalog"],
    area: "engineering",
  },
  {
    id: "engineering-header",
    label: "Engineering board",
    route: "/engineering",
    selector: '[data-tour="page-header"]',
    description: "Engineering tasks by discipline.",
    keywords: ["engineering tasks", "discipline board"],
    area: "engineering",
  },

  // ── Supply chain ───────────────────────────────────────────────────
  {
    id: "items-table",
    label: "Items table",
    route: "/items",
    selector: '[data-tour="items-table"]',
    description: "Item master — part numbers and cards.",
    keywords: ["item", "part", "item master", "part number"],
    area: "supply",
    priority: 6,
  },
  {
    id: "pr-po-tabs",
    label: "Purchasing PR/PO tabs",
    route: "/purchasing",
    selector: '[data-tour="pr-po-tabs"]',
    description: "Switch between purchase requests and purchase orders.",
    keywords: [
      "purchasing",
      "purchase order",
      "purchase request",
      "buy parts",
      "requisition",
      "buyer",
      "open po",
      "new pr",
    ],
    area: "supply",
    priority: 8,
  },
  {
    id: "purchasing-header",
    label: "Purchasing",
    route: "/purchasing",
    selector: '[data-tour="page-header"]',
    description: "Purchasing module home.",
    keywords: ["purchasing page"],
    area: "supply",
  },
  {
    id: "receiving-queue",
    label: "Receiving queue",
    route: "/receiving",
    selector: '[data-tour="receiving-queue"]',
    description: "Dock receipts, inspection, putaway travelers.",
    keywords: ["receiving", "dock", "receipt", "putaway", "incoming"],
    area: "supply",
    priority: 8,
  },
  {
    id: "receiving-header",
    label: "Receiving",
    route: "/receiving",
    selector: '[data-tour="page-header"]',
    description: "Receiving module.",
    keywords: ["receiving page"],
    area: "supply",
  },
  {
    id: "inventory-table",
    label: "Inventory table",
    route: "/inventory",
    selector: '[data-tour="inventory-table"]',
    description: "On-hand stock by part and location.",
    keywords: ["inventory", "stock", "on hand", "bin", "kanban"],
    area: "supply",
    priority: 7,
  },
  {
    id: "suppliers-table",
    label: "Suppliers table",
    route: "/suppliers",
    selector: '[data-tour="suppliers-table"]',
    description: "ASL, scores, on-time delivery.",
    keywords: ["supplier", "vendor", "asl", "scorecard"],
    area: "supply",
    priority: 6,
  },
  {
    id: "gfp-table",
    label: "Government property",
    route: "/government-property",
    selector: '[data-tour="gfp-table"]',
    description: "GFP / CAP / UID property tracking.",
    keywords: ["gfp", "government property", "dfars", "uid"],
    area: "supply",
  },
  {
    id: "assets-stats",
    label: "Asset tracker",
    route: "/assets",
    selector: '[data-tour="assets-stats"]',
    description: "Tools and equipment checkout.",
    keywords: ["asset", "tool checkout", "equipment"],
    area: "supply",
  },

  // ── Quality ────────────────────────────────────────────────────────
  {
    id: "mrb-board",
    label: "MRB board",
    route: "/mrb",
    selector: '[data-tour="mrb-board"]',
    description: "Open material review board cases.",
    keywords: ["mrb", "material review", "disposition", "quarantine"],
    area: "quality",
    priority: 9,
  },
  {
    id: "mrb-header",
    label: "MRB",
    route: "/mrb",
    selector: '[data-tour="page-header"]',
    description: "MRB module.",
    keywords: ["mrb page"],
    area: "quality",
  },
  {
    id: "mrb-quality-links",
    label: "MRB quality links",
    route: "/mrb",
    selector: '[data-tour="mrb-quality-links"]',
    description: "Jump links between NCR/MRB/quality.",
    keywords: ["ncr link", "quality links"],
    area: "quality",
  },
  {
    id: "quality-header",
    label: "NCR / Quality",
    route: "/quality",
    selector: '[data-tour="page-header"]',
    description: "Nonconformances and quality register.",
    keywords: ["ncr", "nonconformance", "quality"],
    area: "quality",
    priority: 7,
  },
  {
    id: "qa-header",
    label: "QA inspection",
    route: "/qa",
    selector: '[data-tour="page-header"]',
    description: "Incoming / in-process inspection.",
    keywords: ["qa", "inspection", "first article", "visual"],
    area: "quality",
  },
  {
    id: "rma-list",
    label: "RMA list",
    route: "/rma",
    selector: '[data-tour="rma-list"]',
    description: "Customer returns and warranty.",
    keywords: ["rma", "return", "warranty"],
    area: "quality",
  },
  {
    id: "serial-list",
    label: "Serial trace",
    route: "/trace/serials",
    selector: '[data-tour="serial-list"]',
    description: "As-built serial genealogy.",
    keywords: ["serial", "trace", "as-built", "genealogy"],
    area: "quality",
  },
  {
    id: "qms-register",
    label: "QMS register",
    route: "/quality/programs",
    selector: '[data-tour="qms-register"]',
    description: "Quality programs register (calibration, ESD, FOD, etc.).",
    keywords: ["qms", "calibration", "quality program", "as9100"],
    area: "quality",
  },
  {
    id: "tools-add",
    label: "Tool control add",
    route: "/quality/programs/tools",
    selector: '[data-tour="tools-add"]',
    description: "Add / manage controlled tools.",
    keywords: ["tool control", "gage", "calibration tool"],
    area: "quality",
  },

  // ── Programs / business ────────────────────────────────────────────
  {
    id: "accounting-overview",
    label: "Accounting overview",
    route: "/accounting",
    selector: '[data-tour="accounting-overview"]',
    description: "GL / financial overview tiles.",
    keywords: ["accounting", "gl", "finance", "p&l", "books"],
    area: "programs",
    priority: 6,
  },
  {
    id: "accounting-tabs",
    label: "Accounting tabs",
    route: "/accounting",
    selector: '[data-tour="accounting-tabs"]',
    description: "AR, AP, journals, reports tabs.",
    keywords: ["ar", "ap", "journal", "ledger tabs"],
    area: "programs",
  },
  {
    id: "payroll-header",
    label: "Payroll",
    route: "/accounting/payroll",
    selector: '[data-tour="page-header"]',
    description: "Pay runs and stubs.",
    keywords: ["payroll", "pay run", "wages"],
    area: "programs",
  },
  {
    id: "pmo-programs",
    label: "PMO programs",
    route: "/pmo",
    selector: '[data-tour="pmo-programs"]',
    description: "Programs and projects list.",
    keywords: ["pmo", "program", "project", "evm"],
    area: "programs",
  },
  {
    id: "pi-board",
    label: "PI planning board",
    route: "/pmo/pi",
    selector: '[data-tour="pi-board"]',
    description: "Program increment planning.",
    keywords: ["pi planning", "safe", "increment"],
    area: "programs",
  },
  {
    id: "budgets-stats",
    label: "Budgets",
    route: "/budgets",
    selector: '[data-tour="budgets-stats"]',
    description: "Budget envelopes and charge codes.",
    keywords: ["budget", "charge code"],
    area: "programs",
  },
  {
    id: "hr-tabs",
    label: "HR tabs",
    route: "/hr",
    selector: '[data-tour="hr-tabs"]',
    description: "Workforce, PTO, reviews, onboarding.",
    keywords: ["hr", "workforce", "pto", "employee"],
    area: "programs",
  },
  {
    id: "recruiting-pipeline",
    label: "Recruiting pipeline",
    route: "/recruiting",
    selector: '[data-tour="recruiting-pipeline"]',
    description: "Hiring pipeline board.",
    keywords: ["recruiting", "hiring", "candidate", "ats"],
    area: "programs",
  },
  {
    id: "onboarding-list",
    label: "Onboarding list",
    route: "/hr/onboarding",
    selector: '[data-tour="onboarding-list"]',
    description: "New-hire onboarding checklists.",
    keywords: ["onboarding", "new hire", "i-9"],
    area: "programs",
  },
  {
    id: "reports-header",
    label: "Reports",
    route: "/reports",
    selector: '[data-tour="page-header"]',
    description: "Operational and financial reports.",
    keywords: ["report", "export", "csv"],
    area: "programs",
  },

  // ── Admin ──────────────────────────────────────────────────────────
  {
    id: "settings-company",
    label: "Company settings",
    route: "/admin/settings",
    selector: '[data-tour="settings-company"]',
    description: "Company profile and fiscal settings.",
    keywords: ["settings", "company settings", "config"],
    area: "admin",
  },
  {
    id: "setup-company",
    label: "Setup wizard company",
    route: "/setup",
    selector: '[data-tour="setup-company"]',
    description: "Guided first-time company setup.",
    keywords: ["setup", "wizard", "onboard company"],
    area: "admin",
  },
  {
    id: "import-wizard",
    label: "Data import",
    route: "/admin/import",
    selector: '[data-tour="import-wizard"]',
    description: "CSV/Excel import for items and masters.",
    keywords: ["import", "csv", "migrate", "upload data"],
    area: "admin",
  },
  {
    id: "email-panels",
    label: "Email center",
    route: "/email",
    selector: '[data-tour="email-panels"]',
    description: "Inbound/outbound plant email.",
    keywords: ["email", "smtp", "inbox"],
    area: "admin",
  },
  {
    id: "billing-header",
    label: "Plan & billing",
    route: "/billing",
    selector: '[data-tour="page-header"]',
    description: "Subscription plan and trial.",
    keywords: ["billing", "plan", "subscription", "upgrade"],
    area: "admin",
  },
  {
    id: "guides-header",
    label: "Guides hub",
    route: "/guides",
    selector: '[data-tour="page-header"]',
    description: "All interactive tours.",
    keywords: ["guides hub", "all tours"],
    area: "admin",
  },
];

const byId = new Map(CATALOG_ANCHORS.map((a) => [a.id, a]));

export function getCatalogAnchor(id: string): CatalogAnchor | undefined {
  return byId.get(id);
}

export function listCatalogForPrompt(): string {
  // Compact lines for the model — ids only she may use
  return CATALOG_ANCHORS.map(
    (a) =>
      `${a.id}|${a.route}|${a.label}|${a.keywords.slice(0, 6).join(",")}`
  ).join("\n");
}

/** Collapse filler words so "create a work order" ≈ "create work order". */
function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s/-]/g, " ")
    .replace(
      /\b(a|an|the|my|our|me|please|just|to|for|of|in|on|at|how|do|i|we|can|you|show|walk|through|about)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function phraseInQuery(qNorm: string, phrase: string): boolean {
  const p = normalizeQuery(phrase);
  if (!p) return false;
  const tokens = p.split(" ").filter((t) => t.length > 1);
  if (tokens.length === 0) return false;

  // Always whole-word match — never substring ("po" must not hit "disposition")
  const allWords = tokens.every((t) => {
    if (t.length < 2) return false;
    // 2-letter tokens only count as whole words (PO, PR, WO…)
    return new RegExp(`\\b${t}\\b`, "i").test(qNorm);
  });
  if (!allWords) return false;

  // Single ultra-short token alone is too noisy unless it's a known 2-letter code
  // used with another signal — require length >= 2 and for len==2 only if query
  // also has a manufacturing-ish neighbor (handled by multi-keyword scoring).
  if (tokens.length === 1 && tokens[0].length <= 2) {
    // Allow "mrb", "ncr", "wo" style 2–3 letter codes as whole words only when
    // length is 3+, or exact 2-letter with surrounding context words.
    return tokens[0].length >= 3;
  }
  return true;
}

/** Score anchors against free text; higher = better. */
export function scoreCatalogMatch(query: string, anchor: CatalogAnchor): number {
  const qNorm = normalizeQuery(query);
  if (!qNorm) return 0;
  let score = 0;
  let hits = 0;
  for (const kw of anchor.keywords) {
    if (phraseInQuery(qNorm, kw)) {
      hits += 1;
      const k = normalizeQuery(kw);
      // Longer phrase matches are much stronger ("create work order" >> "job")
      score += Math.min(14, 3 + Math.floor(k.length / 2));
    }
  }
  if (phraseInQuery(qNorm, anchor.label)) {
    hits += 1;
    score += 6;
  }
  const routeBits = anchor.route.replace(/^\//, "").replace(/-/g, " ");
  if (routeBits.length >= 4 && phraseInQuery(qNorm, routeBits)) {
    hits += 1;
    score += 4;
  }
  // No keyword/label/route hit → not a candidate (priority alone must not qualify)
  if (hits === 0) return 0;
  if (anchor.priority) score += anchor.priority * 0.2;
  // Prefer concrete UI regions over generic page titles
  if (anchor.selector.includes("page-header")) score *= 0.45;
  if (anchor.id.endsWith("-header") && !/header|title|page/i.test(qNorm)) {
    score *= 0.7;
  }
  // Prefer primary actions when user says create/new/add/button
  if (
    /\b(create|new|add|button|form|table|board|tabs)\b/.test(qNorm) &&
    !anchor.selector.includes("page-header")
  ) {
    score += 2;
  }
  return score;
}

/** True when user wants a quick “point at it” not a full multi-step tour. */
export function wantsPointOnly(query: string): boolean {
  return /\b(where is|where's|where'?s|point to|point at|highlight|find the|show me the|which button|where do i click|look for)\b/i.test(
    query
  );
}

/** Best single anchor for a point-at request (or null). */
export function bestPointAnchor(query: string) {
  const steps = inventStepsFromCatalog(query, 1);
  return steps[0] || null;
}

/**
 * Pick best anchors for an invent walkthrough (1–5 steps).
 * Dedupes by route (one highlight per page max, best score wins).
 */
export function inventStepsFromCatalog(
  query: string,
  maxSteps = 4
): CatalogAnchor[] {
  const scored = CATALOG_ANCHORS.map((a) => ({
    a,
    s: scoreCatalogMatch(query, a),
  }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);

  if (scored.length === 0) {
    // Generic orientation
    return [
      getCatalogAnchor("shell-sidebar")!,
      getCatalogAnchor("shell-search")!,
    ].filter(Boolean);
  }

  const byRoute = new Map<string, CatalogAnchor>();
  for (const { a } of scored) {
    const prev = byRoute.get(a.route);
    if (!prev) byRoute.set(a.route, a);
    // Prefer higher-priority / more specific (longer keywords already in score)
  }

  // Preserve score order across unique routes
  const ordered: CatalogAnchor[] = [];
  const seen = new Set<string>();
  for (const { a } of scored) {
    if (seen.has(a.route)) continue;
    // Use the best for this route from map
    const best = byRoute.get(a.route)!;
    if (seen.has(best.id)) continue;
    ordered.push(best);
    seen.add(a.route);
    seen.add(best.id);
    if (ordered.length >= maxSteps) break;
  }
  return ordered;
}

/** Validate model-proposed anchor ids; drop unknowns. */
export function resolveAnchorIds(ids: string[]): CatalogAnchor[] {
  const out: CatalogAnchor[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = (raw || "").trim();
    if (!id || seen.has(id)) continue;
    const a = byId.get(id);
    if (a) {
      out.push(a);
      seen.add(id);
    }
  }
  return out;
}

export function anchorsToTourSteps(
  anchors: CatalogAnchor[],
  spokenHints?: Record<string, string>
): {
  route?: string;
  selector?: string;
  title: string;
  body: string;
}[] {
  return anchors.map((a) => ({
    route: a.route,
    selector: a.selector,
    title: a.label,
    body:
      spokenHints?.[a.id] ||
      `${a.description} You're on ${a.route === "/" ? "the dashboard" : a.route}.`,
  }));
}
