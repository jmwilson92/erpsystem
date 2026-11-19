/**
 * Resolve “take me to X” / “open WO-00008” into a permitted href.
 * Pages come from the nav registry; records use the lookup store under *.view.
 */
import type { AiPendingAction } from "@/lib/services/ai";
import type { LookupCanView, LookupStore } from "./lookup";
import { createLookupApi } from "./lookup";
import type { LookupHit } from "./lookup-policy";
import {
  LOOKUP_LABELS,
  LOOKUP_PERMISSIONS,
  isExcludedLookupQuery,
  isLookupEntity,
  parseRecordHints,
  type LookupEntityId,
} from "./lookup-policy";
import {
  buildNavRegistry,
  carinaTargetSelector,
  looksLikeHowto,
  looksLikeNavigate,
  resolveNavRoutes,
  type NavMatch,
  type NavRoute,
} from "./nav-registry";

export type NavigateHighlight = { target: string; route?: string; label?: string; selector?: string };

export type NavigationResult = {
  ok: boolean;
  kind: "navigate" | "howto" | "ambiguous" | "denied" | "not-found";
  text: string;
  href?: string;
  highlight?: NavigateHighlight;
  pendingAction?: AiPendingAction | null;
  matches?: { label: string; href: string }[];
};

export type NavigateDeps = {
  userId?: string;
  store: LookupStore;
  canView?: LookupCanView;
  hasPermission?: (userId: string, permission: string) => Promise<boolean>;
  registry?: NavRoute[];
};

function highlightFor(route: NavRoute): NavigateHighlight | undefined {
  if (!route.highlight) return undefined;
  const selector = carinaTargetSelector(route.highlight);
  return { target: route.highlight, route: route.href, label: route.label, selector };
}

export function looksLikeRecordNav(text: string): boolean {
  if (parseRecordHints(text).length) return true;
  return /\b(part|project|work order|purchase request|purchase order|budget|customer|vendor|bom)\s+[A-Za-z0-9][A-Za-z0-9._\/-]*/i.test(
    text
  );
}

/** Extra name-style hints the prefix parser misses, e.g. “project Alpha”, “part WIDGET-20”. */
export function parseNamedRecordHints(text: string): { entity: LookupEntityId; idOrNumber: string }[] {
  const out: { entity: LookupEntityId; idOrNumber: string }[] = [];
  const pairs: [LookupEntityId, RegExp][] = [
    ["part", /\bpart(?: number)?\s+([A-Za-z0-9][A-Za-z0-9._\/-]{1,})\b/i],
    ["project", /\bprojects?\s+([A-Za-z0-9][A-Za-z0-9 ._-]{1,40}?)\s*$/i],
    ["work_order", /\b(?:work order|WO)\s+#?([A-Za-z0-9-]{2,})\b/i],
    ["purchase_request", /\b(?:purchase request|PR)\s+#?([A-Za-z0-9-]{2,})\b/i],
    ["budget", /\bbudgets?\s+([A-Za-z0-9][A-Za-z0-9 ._-]{1,40}?)\s*$/i],
    ["customer", /\bcustomers?\s+([A-Za-z0-9][A-Za-z0-9 ._-]{1,40}?)\s*$/i],
  ];
  for (const [entity, re] of pairs) {
    const m = text.match(re);
    if (m?.[1]) out.push({ entity, idOrNumber: m[1].trim() });
  }
  return out;
}

function deniedText(permission: string, label: string): string {
  return `You don’t have permission to open ${label} (${permission}). I didn’t navigate.`;
}

async function mayOpen(
  deps: NavigateDeps,
  permission: string | null
): Promise<boolean> {
  if (!permission) return true;
  if (!deps.userId) return false;
  if (deps.hasPermission) return deps.hasPermission(deps.userId, permission);
  const moduleName = permission.replace(/\.view$/, "");
  if (deps.canView) return deps.canView(deps.userId, moduleName);
  return false;
}

function uniqueHref(hits: LookupHit[]): LookupHit[] {
  const seen = new Set<string>();
  const out: LookupHit[] = [];
  for (const h of hits) {
    if (seen.has(h.href)) continue;
    seen.add(h.href);
    out.push(h);
  }
  return out;
}

export async function resolveRecordNavigation(
  question: string,
  deps: NavigateDeps
): Promise<NavigationResult | null> {
  if (isExcludedLookupQuery(question)) {
    return {
      ok: false,
      kind: "denied",
      text: "I don’t open payroll, HR, salary, financial balances or other tenants’ data.",
    };
  }
  const hints = [
    ...parseRecordHints(question),
    ...parseNamedRecordHints(question),
  ];
  if (!hints.length) return null;

  const api = createLookupApi({ store: deps.store, canView: deps.canView });
  const found: LookupHit[] = [];
  const denied: { entity: LookupEntityId; message: string }[] = [];

  for (const hint of hints) {
    if (!isLookupEntity(hint.entity)) continue;
    const got = await api.get({
      userId: deps.userId,
      entity: hint.entity,
      idOrNumber: hint.idOrNumber,
    });
    if (got.ok && got.hits.length) {
      found.push(...got.hits);
      continue;
    }
    if (!got.ok && got.reason === "permission-denied") {
      denied.push({ entity: hint.entity, message: got.message });
      continue;
    }
    const searched = await api.search({
      userId: deps.userId,
      entity: hint.entity,
      query: hint.idOrNumber,
    });
    if (searched.ok && searched.hits.length) {
      found.push(...searched.hits);
    } else if (!searched.ok && searched.reason === "permission-denied") {
      denied.push({ entity: hint.entity, message: searched.message });
    }
  }

  const hits = uniqueHref(found);
  if (hits.length === 1) {
    const hit = hits[0];
    return {
      ok: true,
      kind: "navigate",
      href: hit.href,
      text: `Opening ${hit.number}${hit.title && hit.title !== hit.number ? ` (${hit.title})` : ""}.`,
    };
  }
  if (hits.length > 1) {
    const short = hits.slice(0, 5);
    return {
      ok: false,
      kind: "ambiguous",
      text: `Which one did you mean? ${short.map((h) => `${h.number}${h.title ? ` — ${h.title}` : ""}`).join("; ")}.`,
      matches: short.map((h) => ({ label: `${h.number}${h.title ? ` — ${h.title}` : ""}`, href: h.href })),
    };
  }
  if (denied.length) {
    return { ok: false, kind: "denied", text: denied[0].message };
  }
  return {
    ok: false,
    kind: "not-found",
    text: "I couldn’t find that record. Check the number or name and try again.",
  };
}

export async function resolvePageNavigation(
  question: string,
  deps: NavigateDeps
): Promise<NavigationResult | null> {
  const registry = deps.registry || buildNavRegistry();
  const { unique, ambiguous } = resolveNavRoutes(question, registry);
  if (ambiguous.length) {
    return {
      ok: false,
      kind: "ambiguous",
      text: `Which one did you mean? ${ambiguous.map((m) => m.route.label).join("; ")}.`,
      matches: ambiguous.map((m) => ({ label: m.route.label, href: m.route.href })),
    };
  }
  if (!unique) return null;
  const allowed = await mayOpen(deps, unique.route.permission);
  if (!allowed) {
    return {
      ok: false,
      kind: "denied",
      text: deniedText(unique.route.permission || "view", unique.route.label),
    };
  }
  const highlight = highlightFor(unique.route);
  return {
    ok: true,
    kind: "navigate",
    href: unique.route.href,
    highlight,
    text: highlight
      ? `Opening ${unique.route.label}. I’ll highlight ${highlight.label || "the relevant control"} when we get there.`
      : `Opening ${unique.route.label}.`,
  };
}

/**
 * Resolve a take-me-to / open request. Records win when an identifier is
 * present; otherwise a page match is used.
 */
export async function resolveNavigation(
  question: string,
  deps: NavigateDeps
): Promise<NavigationResult> {
  const recordFirst = looksLikeRecordNav(question);
  if (recordFirst) {
    const rec = await resolveRecordNavigation(question, deps);
    if (rec && rec.kind !== "not-found") return rec;
    const page = await resolvePageNavigation(question, deps);
    if (page) return page;
    return rec || { ok: false, kind: "not-found", text: "I couldn’t find that page or record." };
  }
  const page = await resolvePageNavigation(question, deps);
  if (page) return page;
  const rec = await resolveRecordNavigation(question, deps);
  if (rec) return rec;
  return {
    ok: false,
    kind: "not-found",
    text: "I don’t have a page that matches that. Try a module name like work orders, or a record like WO-00008.",
  };
}

export { looksLikeNavigate, looksLikeHowto, type NavMatch };
export { LOOKUP_LABELS, LOOKUP_PERMISSIONS };
