import {
  Clock,
  ListChecks,
  Mail,
  Rocket,
  CreditCard,
  FileBarChart,
  LayoutDashboard,
  Factory,
  ClipboardList,
  FileText,
  FileInput,
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
  SlidersHorizontal,
  RotateCcw,
  ScanBarcode,
  Compass,
  LifeBuoy,
  MessagesSquare,
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
      { href: "/support", label: "Help & Support", icon: MessagesSquare, keywords: ["ticket", "chat", "helpdesk", "help", "support", "ask"] },
      { href: "/account", label: "My Account", icon: KeyRound, keywords: ["password", "login", "sign out", "sessions", "security"] },
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
      { href: "/workcenters", label: "Workcenters", icon: Factory, keywords: ["machines", "cells", "capacity"] },
      { href: "/test-center", label: "Test Center", icon: FlaskConical, keywords: ["ate", "burn-in", "test station"] },
      { href: "/kitting", label: "Kitting", icon: Boxes, keywords: ["pick", "stage", "shortage"] },
      { href: "/planning", label: "Planning & MRP", icon: LineChart, keywords: ["forecast", "mrs", "capacity", "demand"] },
    ],
  },
  {
    label: "Engineering & PLM",
    items: [
      { href: "/engineering", label: "Engineering", icon: Briefcase, keywords: ["tasks", "board", "disciplines"] },
      { href: "/requirements", label: "Requirements", icon: ListChecks, keywords: ["jama", "trace", "verification", "shall", "coverage", "system requirements"] },
      { href: "/bom", label: "BOMs", icon: Layers, keywords: ["bill of materials", "where used", "revision"] },
      { href: "/work-instructions", label: "Work Instructions", icon: FileText, keywords: ["wi", "router", "steps"] },
      { href: "/test-procedures", label: "Test Procedures", icon: ClipboardList, keywords: ["atp", "test procedure", "acceptance test", "functional test", "cm controlled"] },
      { href: "/products", label: "Products (PLM)", icon: Package2, keywords: ["product lifecycle", "catalog"] },
      { href: "/cm", label: "Config Management", icon: GitBranch, keywords: ["ecr", "eco", "change", "baseline"] },
      { href: "/uom", label: "UOM Master", icon: Gauge, keywords: ["units", "conversion", "measure"] },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/items", label: "Items", icon: Package, keywords: ["item master", "part number", "item cards"] },
      { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, keywords: ["pr", "po", "requisition", "buy", "purchase request"] },
      { href: "/purchasing/pr/new", label: "New PR", icon: FileInput, keywords: ["purchase request", "standalone pr", "buy", "requisition"] },
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
      { href: "/quality", label: "NCR / Quality", icon: AlertTriangle, keywords: ["nonconformance", "yield", "trend"] },
      { href: "/mrb", label: "MRB", icon: FileWarning, keywords: ["material review board", "disposition"] },
      { href: "/mrb?view=cars", label: "CAR", icon: FileWarning, keywords: ["corrective action", "8d", "root cause"] },
      { href: "/rma", label: "RMA", icon: RotateCcw, keywords: ["return", "warranty", "repair", "customer return"] },
      { href: "/trace/serials", label: "Serial trace", icon: ScanBarcode, keywords: ["as-built", "genealogy", "serial number", "sn tree"] },
      { href: "/quality/programs", label: "Quality Programs", icon: Shield, keywords: ["qms", "program", "compliance", "as9100", "calibration", "gage", "tool control", "toolbox", "hazmat", "sds", "esd", "humidity", "fod", "safety", "ehs", "internal audit", "as9101", "ncr", "ofi", "counterfeit", "as5553", "as6174", "policy"] },
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
      { href: "/budgets", label: "Budgets", icon: Landmark, keywords: ["budget", "charge code", "direct", "indirect", "enact"] },
      { href: "/accounting", label: "Accounting", icon: Landmark, keywords: ["gl", "gaap", "p&l", "balance sheet", "ar", "ap", "payroll", "banking", "reconcile"] },
      { href: "/accounting/banking", label: "Bank Connections", icon: CreditCard, keywords: ["plaid", "bank", "connect account", "feed", "transactions", "reconcile", "link"] },
      { href: "/accounting/payroll", label: "Payroll", icon: Users2, keywords: ["pay run", "net pay", "withholding", "w-4", "paystub", "wages"] },
      { href: "/hr", label: "HR / Workforce", icon: Users2, keywords: ["time", "pto", "expenses", "reviews", "recruiting", "ats", "hiring", "candidate", "requisition", "applicant", "job", "pipeline", "recruiter", "onboarding", "new hire", "i-9", "w-4", "background check", "orientation"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/settings", label: "Company Settings", icon: SlidersHorizontal, keywords: ["settings", "config", "preferences", "company", "fiscal", "basis", "admin"] },
      { href: "/admin/permissions", label: "Roles & Permissions", icon: KeyRound, keywords: ["rbac", "access", "security"] },
      { href: "/admin/support", label: "Support Desk", icon: LifeBuoy, keywords: ["ticket", "chat", "helpdesk", "support", "staff", "notes"] },
      { href: "/billing", label: "Plan & Billing", icon: CreditCard, keywords: ["subscription", "trial", "plan", "upgrade", "invoice", "stripe", "payment"] },
      { href: "/setup", label: "Setup Wizard", icon: Rocket, keywords: ["onboarding", "company", "getting started", "plug and play"] },
      { href: "/guides", label: "Guides & Tours", icon: Compass, keywords: ["help", "tour", "walkthrough", "interactive", "tutorial", "how to", "getting started", "narration", "voice"] },
      { href: "/admin/import", label: "Data Import", icon: FileSpreadsheet, keywords: ["csv", "excel", "migrate", "onboard", "item master", "upload"] },
      { href: "/email", label: "Email Center", icon: Mail, keywords: ["inbox", "outbound", "rfq", "acknowledge", "parse", "smtp"] },
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
