import {
  Clock,
  ListChecks,
  Rocket,
  FileBarChart,
  LayoutDashboard,
  Factory,
  ClipboardList,
  FileText,
  Boxes,
  ShoppingCart,
  ShoppingBag,
  Building2,
  PackageCheck,
  Users2,
  Shield,
  FlaskConical,
  ClipboardCheck,
  Truck,
  Landmark,
  FolderKanban,
  GitBranch,
  Gauge,
  Monitor,
  Package,
  Package2,
  Award,
  Network,
  Briefcase,
  Bot,
  AlertTriangle,
  FileWarning,
  LineChart,
  CalendarRange,
  Crown,
  KeyRound,
  Layers,
  FileSpreadsheet,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra terms the command palette should match on. */
  keywords?: string[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Single source of truth for module navigation.
 * Used by the sidebar and the ⌘K command palette.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "kpi", "command center"] },
      { href: "/floor", label: "Production Floor", icon: Factory, keywords: ["shop floor", "live"] },
      { href: "/radiators", label: "Info Radiators", icon: Monitor, keywords: ["wall display", "big screen"] },
      { href: "/value-stream", label: "Value Stream", icon: Network, keywords: ["vsm", "flow", "constraint"] },
      { href: "/ai", label: "AI Assistant", icon: Bot, keywords: ["chat", "grok", "assistant"] },
      { href: "/approvals", label: "My Approvals", icon: ClipboardCheck, keywords: ["pending", "pto", "timesheet", "expense", "manager"] },
      { href: "/hr/timesheet", label: "My Timesheet", icon: Clock, keywords: ["time", "hours", "pay period", "charge"] },
    ],
  },
  {
    label: "Sales & Customers",
    items: [
      { href: "/sales/quotes", label: "Quotes", icon: FileSpreadsheet, keywords: ["rfq", "estimate", "quotation"] },
      { href: "/sales", label: "Sales Orders", icon: ShoppingBag, keywords: ["so", "order entry", "booking"] },
      { href: "/customers", label: "Customers", icon: Building2, keywords: ["crm", "accounts", "credit"] },
      { href: "/shipping", label: "Shipping", icon: Truck, keywords: ["pack", "ship", "logistics", "delivery"] },
    ],
  },
  {
    label: "Manufacturing",
    items: [
      { href: "/work-orders", label: "Work Orders", icon: ClipboardList, keywords: ["wo", "traveler", "job"] },
      { href: "/work-instructions", label: "Work Instructions", icon: FileText, keywords: ["wi", "router", "steps"] },
      { href: "/workcenters", label: "Workcenters", icon: Factory, keywords: ["machines", "cells", "capacity"] },
      { href: "/kitting", label: "Kitting", icon: Boxes, keywords: ["pick", "stage", "shortage"] },
      { href: "/planning", label: "Planning & MRP", icon: LineChart, keywords: ["forecast", "mrs", "capacity", "demand"] },
    ],
  },
  {
    label: "Engineering & PLM",
    items: [
      { href: "/engineering", label: "Engineering", icon: Briefcase, keywords: ["tasks", "board", "disciplines"] },
      { href: "/requirements", label: "Requirements", icon: ListChecks, keywords: ["jama", "trace", "verification", "shall", "coverage", "system requirements"] },
      { href: "/items", label: "Items", icon: Package, keywords: ["item master", "part number", "item cards"] },
      { href: "/bom", label: "BOMs", icon: Layers, keywords: ["bill of materials", "where used", "revision"] },
      { href: "/products", label: "Products (PLM)", icon: Package2, keywords: ["product lifecycle", "catalog"] },
      { href: "/cm", label: "Config Management", icon: GitBranch, keywords: ["ecr", "eco", "change", "baseline"] },
      { href: "/uom", label: "UOM Master", icon: Gauge, keywords: ["units", "conversion", "measure"] },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, keywords: ["pr", "po", "requisition", "buy"] },
      { href: "/receiving", label: "Receiving", icon: PackageCheck, keywords: ["dock", "inspection", "gfp", "traveler"] },
      { href: "/suppliers", label: "Suppliers / ASL", icon: Award, keywords: ["vendor", "scorecard", "approved supplier"] },
      { href: "/inventory", label: "Inventory", icon: Package, keywords: ["stock", "bins", "kanban", "quarantine"] },
      { href: "/government-property", label: "Gov Property", icon: Shield, keywords: ["gfp", "cap", "uid", "dfars"] },
      { href: "/assets", label: "Asset Tracker", icon: Briefcase, keywords: ["tools", "test equipment", "demo unit", "checkout", "check out"] },
      { href: "/virtual-assets", label: "Virtual Assets", icon: Package2, keywords: ["licenses", "software", "intangible"] },
    ],
  },
  {
    label: "Quality & Compliance",
    items: [
      { href: "/qa", label: "QA Inspection", icon: ClipboardCheck, keywords: ["visual", "gd&t", "first article"] },
      { href: "/test-center", label: "Test Center", icon: FlaskConical, keywords: ["ate", "burn-in", "test station"] },
      { href: "/test-procedures", label: "Test Procedures", icon: ClipboardList, keywords: ["atp", "test procedure", "acceptance test", "functional test", "cm controlled"] },
      { href: "/quality", label: "NCR / Quality", icon: AlertTriangle, keywords: ["nonconformance", "yield", "trend"] },
      { href: "/mrb", label: "MRB", icon: FileWarning, keywords: ["material review board", "disposition"] },
      { href: "/mrb?view=cars", label: "CAR", icon: FileWarning, keywords: ["corrective action", "8d", "root cause"] },
    ],
  },
  {
    label: "Programs & Business",
    items: [
      { href: "/reports", label: "Reports", icon: FileBarChart, keywords: ["export", "csv", "aging", "valuation", "wip", "print"] },
      { href: "/leadership", label: "Leadership", icon: Crown, keywords: ["executive", "senior", "strategy"] },
      { href: "/pmo", label: "PMO", icon: FolderKanban, keywords: ["programs", "projects", "wbs", "evm", "spi", "cpi"] },
      { href: "/pmo/pi", label: "PI Planning", icon: CalendarRange, keywords: ["program increment", "safe", "sprint"] },
      { href: "/pmo/alerts", label: "PM Alerts", icon: AlertTriangle, keywords: ["program alerts", "risk"] },
      { href: "/accounting", label: "Accounting", icon: Landmark, keywords: ["gl", "gaap", "p&l", "balance sheet", "ar", "ap"] },
      { href: "/accounting?tab=payroll", label: "Payroll", icon: Wallet, keywords: ["pay run", "wages", "salaries", "timecard payroll"] },
      { href: "/accounting?tab=banking", label: "Banking", icon: Landmark, keywords: ["bank feed", "credit card", "reconcile", "transactions", "import"] },
      { href: "/hr", label: "HR / Workforce", icon: Users2, keywords: ["time", "pto", "expenses", "reviews"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/permissions", label: "Roles & Permissions", icon: KeyRound, keywords: ["rbac", "access", "security"] },
      { href: "/setup", label: "Setup Wizard", icon: Rocket, keywords: ["onboarding", "company", "getting started", "plug and play"] },
      { href: "/admin/import", label: "Data Import", icon: FileSpreadsheet, keywords: ["csv", "excel", "migrate", "onboard", "item master", "upload"] },
      { href: "/demo", label: "Test Drive Page", icon: FlaskConical, keywords: ["demo", "sandbox", "trial", "landing", "prospects"] },
    ],
  },
];

/**
 * Returns the href of the nav item that should be highlighted for the
 * current location: the deepest (most specific) path match, with query
 * params used as a tie-breaker (e.g. /mrb vs /mrb?view=cars).
 */
export function activeNavHref(
  pathname: string,
  searchParams: URLSearchParams
): string | null {
  let best: string | null = null;
  let bestScore = -1;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const [itemPath, itemQuery] = item.href.split("?");
      const matches =
        itemPath === "/"
          ? pathname === "/"
          : pathname === itemPath || pathname.startsWith(itemPath + "/");
      if (!matches) continue;

      // Path depth wins; a matching query string outranks a bare path.
      let score = itemPath.length * 10;
      if (itemQuery) {
        const wanted = new URLSearchParams(itemQuery);
        let queryOk = true;
        for (const [k, v] of wanted) {
          if (searchParams.get(k) !== v) queryOk = false;
        }
        if (!queryOk) continue;
        score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = item.href;
      }
    }
  }
  return best;
}
