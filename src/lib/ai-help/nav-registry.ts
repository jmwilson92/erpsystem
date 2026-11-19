/**
 * Carina navigation registry, generated at runtime from NAV_GROUPS
 * (sidebar / command-palette labels and keywords) plus a small set of
 * tab and settings routes that users ask for by name.
 */
import { NAV_GROUPS } from "@/lib/navigation";

export type NavRoute = {
  href: string;
  label: string;
  synonyms: string[];
  /** `<module>.view` permission, or null when any signed-in user may open it. */
  permission: string | null;
  /** Optional default highlight target id (data-carina-target). */
  highlight?: string;
  group?: string;
};

/** Longest-prefix wins. `null` means no view permission is required. */
const PATH_VIEW_PERMISSION: [string, string | null][] = [
  ["/admin", "admin.view"],
  ["/work-orders", "work-orders.view"],
  ["/work-instructions", "work-instructions.view"],
  ["/workcenters", "workcenters.view"],
  ["/test-center", "test-center.view"],
  ["/test-procedures", "quality.view"],
  ["/planning", "planning.view"],
  ["/kitting", "kitting.view"],
  ["/maintenance", null],
  ["/sales/quotes", "sales.view"],
  ["/sales", "sales.view"],
  ["/customers", "customers.view"],
  ["/shipping", "shipping.view"],
  ["/purchasing", "purchasing.view"],
  ["/receiving", "receiving.view"],
  ["/suppliers", "suppliers.view"],
  ["/inventory", "inventory.view"],
  ["/items", "items.view"],
  ["/assets", "inventory.view"],
  ["/virtual-assets", "virtual-assets.view"],
  ["/government-property", "government-property.view"],
  ["/bom", "bom.view"],
  ["/products", "products.view"],
  ["/engineering", "engineering.view"],
  ["/requirements", "engineering.view"],
  ["/cm", "cm.view"],
  ["/uom", "uom.view"],
  ["/quality", "quality.view"],
  ["/qa", "qa.view"],
  ["/mrb", "mrb.view"],
  ["/rma", "rma.view"],
  ["/trace", "inventory.view"],
  ["/pmo", "pmo.view"],
  ["/budgets", "pmo.view"],
  ["/leadership", "leadership.view"],
  ["/accounting", "accounting.view"],
  ["/hr/timesheet", null],
  ["/hr", "hr.view"],
  ["/recruiting", "hr.view"],
  ["/approvals", null],
  ["/support", null],
  ["/account", null],
  ["/docs", "docs.view"],
  ["/ai", "ai.view"],
  ["/floor", "floor.view"],
  ["/radiators", "radiators.view"],
  ["/value-stream", "value-stream.view"],
  ["/guides", null],
  ["/setup", "admin.view"],
  ["/billing", "admin.view"],
  ["/email", "admin.view"],
  ["/demo", "admin.view"],
  ["/reports", "dashboard.view"],
  ["/service", null],
  ["/fleet", null],
  ["/logistics", null],
  ["/crm", null],
  ["/", "dashboard.view"],
];

const EXTRA_ROUTES: Omit<NavRoute, "permission">[] = [
  {
    href: "/planning?tab=capacity",
    label: "Capacity planning",
    synonyms: ["capacity planning", "capacity plan", "work center capacity", "go to capacity"],
    highlight: "planning-capacity",
    group: "Manufacturing",
  },
  {
    href: "/planning?tab=forecast",
    label: "Forecasts & MRS",
    synonyms: ["forecasts", "planning worksheet", "material requisition", "mrs"],
    group: "Manufacturing",
  },
  {
    href: "/purchasing?tab=prs",
    label: "Purchase requests",
    synonyms: [
      "purchase requests",
      "open purchase requests",
      "purchasing requests",
      "pr list",
      "prs",
    ],
    highlight: "pr-po-tabs",
    group: "Supply Chain",
  },
  {
    href: "/purchasing?tab=pos",
    label: "Purchase orders",
    synonyms: ["purchase orders", "open purchase orders", "po list", "pos"],
    highlight: "pr-po-tabs",
    group: "Supply Chain",
  },
  {
    href: "/admin/settings",
    label: "BOM prototype settings",
    synonyms: [
      "settings for bom prototype",
      "bom prototype settings",
      "bom prototype",
      "prototype default",
      "certification default",
      "bom certification default",
    ],
    highlight: "bom-prototype-default",
    group: "Administration",
  },
];

export function viewPermissionForHref(href: string): string | null {
  const path = (href.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const rows = [...PATH_VIEW_PERMISSION].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, perm] of rows) {
    if (prefix === "/") return path === "/" ? perm : null;
    if (path === prefix || path.startsWith(`${prefix}/`)) return perm;
  }
  return null;
}

function uniqueSynonyms(label: string, extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [label, ...extra]) {
    const s = raw.trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Build the live registry from nav + extras. Pure; safe for unit tests. */
export function buildNavRegistry(): NavRoute[] {
  const byHref = new Map<string, NavRoute>();
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const permission = viewPermissionForHref(item.href);
      byHref.set(item.href, {
        href: item.href,
        label: item.label,
        synonyms: uniqueSynonyms(item.label, item.keywords || []),
        permission,
        group: group.label,
      });
    }
  }
  for (const extra of EXTRA_ROUTES) {
    const permission = viewPermissionForHref(extra.href);
    const existing = byHref.get(extra.href);
    if (existing) {
      existing.synonyms = uniqueSynonyms(existing.label, [
        ...existing.synonyms,
        extra.label,
        ...extra.synonyms,
      ]);
      if (extra.highlight && !existing.highlight) existing.highlight = extra.highlight;
      // Keep a distinct extra row under a more specific label when the href is shared
      // so “settings for BOM prototype” can resolve separately from “Company Settings”.
      if (extra.label.toLowerCase() !== existing.label.toLowerCase()) {
        byHref.set(`${extra.href}#${extra.label}`, {
          ...extra,
          permission,
        });
      }
    } else {
      byHref.set(extra.href, { ...extra, permission });
    }
  }
  return [...byHref.values()];
}

export function normalizeNavQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(
      /^(please\s+|hey\s+|hi\s+|carina,?\s+)?((can|could|would)\s+you\s+)?/i,
      ""
    )
    .replace(
      /\b(take me to|take us to|navigate to|bring me to|jump to|go to|open|show me|show)\b/gi,
      " "
    )
    .replace(/\b(the|a|an|page|module|screen|for me)\b/g, " ")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeNavigate(text: string): boolean {
  const t = text.trim();
  if (looksLikeHowto(t)) return false;
  return /^(?:please\s+|can you\s+|could you\s+|would you\s+|i (?:want|need) (?:you )?to\s+)?(?:take me|take us|go to|open|navigate to|bring me|jump to|show me|show)\b/i.test(
    t
  );
}

export function looksLikeHowto(text: string): boolean {
  return /\b(how do i|how do we|how to|show me how|walk me through|explain how|teach me how|what are the steps)\b/i.test(
    text
  );
}

export type NavMatch = { route: NavRoute; score: number; reason: string };

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Score a route against a normalized query. Higher is better. */
export function scoreNavRoute(query: string, route: NavRoute): NavMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const label = route.label.toLowerCase();
  if (q === label) return { route, score: 100, reason: "exact label" };
  if (route.synonyms.some((s) => s === q)) return { route, score: 96, reason: "exact synonym" };
  if (label.startsWith(q) || route.synonyms.some((s) => s.startsWith(q))) {
    return { route, score: 88, reason: "prefix" };
  }
  if (label.includes(q) || route.synonyms.some((s) => s.includes(q))) {
    return { route, score: 82, reason: "phrase" };
  }
  const qt = tokens(q);
  if (!qt.length) return null;
  const hay = new Set(tokens([label, ...route.synonyms].join(" ")));
  const hit = qt.filter((t) => hay.has(t)).length;
  if (hit === 0) return null;
  const ratio = hit / qt.length;
  if (ratio < 0.6 && hit < 2) return null;
  return { route, score: Math.round(50 + ratio * 30 + hit), reason: "tokens" };
}

export function resolveNavRoutes(
  query: string,
  registry: NavRoute[] = buildNavRegistry()
): { matches: NavMatch[]; unique: NavMatch | null; ambiguous: NavMatch[] } {
  const q = normalizeNavQuery(query) || query.trim().toLowerCase();
  const scored = registry
    .map((route) => scoreNavRoute(q, route))
    .filter((m): m is NavMatch => !!m && m.score >= 60)
    .sort((a, b) => b.score - a.score || a.route.label.localeCompare(b.route.label));
  // Deduplicate by href, keep the highest score (specific extra labels win ties via score).
  const seen = new Set<string>();
  const matches: NavMatch[] = [];
  for (const m of scored) {
    if (seen.has(m.route.href)) continue;
    seen.add(m.route.href);
    matches.push(m);
  }
  if (!matches.length) return { matches: [], unique: null, ambiguous: [] };
  const top = matches[0];
  const close = matches.filter((m) => top.score - m.score < 12 && m.score >= 70);
  if (close.length > 1) return { matches, unique: null, ambiguous: close.slice(0, 5) };
  if (top.score >= 70) return { matches, unique: top, ambiguous: [] };
  return { matches, unique: null, ambiguous: [] };
}

export function carinaTargetSelector(target: string): string {
  const id = target.replace(/^\[data-(?:carina-target|tour)="([^"]+)"\]$/, "$1");
  if (target.startsWith("[") || target.startsWith("#") || target.startsWith(".")) return target;
  return `[data-carina-target="${id}"]`;
}
