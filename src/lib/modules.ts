/**
 * Per-module enable/disable — "buy the whole system or just the parts."
 * A company can turn modules off; disabled modules disappear from the nav
 * and their routes are blocked until re-enabled. The set of disabled module
 * keys is stored on CompanySettings.disabledModules (JSON string array).
 *
 * This file is pure (no DB / server imports) so it is safe to use from both
 * server components and client components (sidebar, command palette).
 */
export type ModuleDef = {
  key: string;
  label: string;
  description: string;
  /** Route prefixes owned by this module (used for nav filtering + guarding). */
  prefixes: string[];
};

export const MODULES: ModuleDef[] = [
  {
    key: "sales",
    label: "Sales & Customers",
    description: "Quotes, sales orders, customers, shipping",
    prefixes: ["/sales", "/customers", "/shipping"],
  },
  {
    key: "manufacturing",
    label: "Manufacturing",
    description: "Work orders, work instructions, workcenters, kitting, planning",
    prefixes: [
      "/work-orders",
      "/work-instructions",
      "/workcenters",
      "/kitting",
      "/planning",
    ],
  },
  {
    key: "engineering",
    label: "Engineering & PLM",
    description: "Engineering, requirements, BOMs, products, config management, UOM",
    prefixes: [
      "/engineering",
      "/requirements",
      "/bom",
      "/products",
      "/cm",
      "/uom",
    ],
  },
  {
    key: "supplychain",
    label: "Supply Chain",
    description:
      "Items, purchasing, receiving, suppliers, inventory, gov property, assets",
    prefixes: [
      "/items",
      "/purchasing",
      "/receiving",
      "/suppliers",
      "/inventory",
      "/government-property",
      "/assets",
      "/virtual-assets",
    ],
  },
  {
    key: "quality",
    label: "Quality & Compliance",
    description: "QA inspection, test center, test procedures, NCR, MRB / CAR",
    prefixes: ["/qa", "/test-center", "/test-procedures", "/quality", "/mrb"],
  },
  {
    key: "accounting",
    label: "Accounting",
    description: "General ledger, AR / AP, payroll, banking",
    prefixes: ["/accounting"],
  },
  {
    key: "hr",
    label: "HR & Workforce",
    description: "People, time off, reviews, goals, training",
    prefixes: ["/hr"],
  },
  {
    key: "pmo",
    label: "Programs & PMO",
    description: "Programs, PMO, PI planning, leadership",
    prefixes: ["/pmo", "/leadership"],
  },
];

/**
 * Routes that stay available even when their module is off — personal
 * self-service that every employee needs regardless of what's licensed.
 */
const CORE_EXCEPTIONS = ["/hr/timesheet"];

function pathHasPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** The module key that owns a path, or null for core / unmapped routes. */
export function moduleKeyForPath(pathname: string): string | null {
  const clean = pathname.split("?")[0];
  if (CORE_EXCEPTIONS.some((p) => pathHasPrefix(clean, p))) return null;
  let best: string | null = null;
  let bestLen = 0;
  for (const m of MODULES) {
    for (const pre of m.prefixes) {
      if (pathHasPrefix(clean, pre) && pre.length > bestLen) {
        bestLen = pre.length;
        best = m.key;
      }
    }
  }
  return best;
}

/** True when the module owning `pathname` is enabled (or it's a core route). */
export function isPathEnabled(pathname: string, disabled: string[]): boolean {
  const key = moduleKeyForPath(pathname);
  return !key || !disabled.includes(key);
}

export function moduleLabel(key: string): string {
  return MODULES.find((m) => m.key === key)?.label || key;
}
