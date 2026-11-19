/**
 * Carina “plan this demand” flow. Reads CompanySettings.bomPrototypeRequired
 * and BomHeader.prototypeRequired (the path comes from those settings, plus a per-request override). Reuses
 * existing supply netting, calendar math, forecast/budget/MRS/WO/PR services.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { userHasPermission } from "@/lib/auth";
import { createForecast, getPartSupplySnapshot } from "@/lib/services/planning";
import { createBudget } from "@/lib/services/budgets";
import { createWorkOrder } from "@/lib/services/work-orders";
import { createStandalonePurchaseRequest } from "@/lib/services/purchase-requests";
import {
  DEFAULT_BUY_LEAD_DAYS,
  DEFAULT_STAGING_BUFFER_MINUTES,
  buildCalendarContext,
  defaultChildOffsetMinutes,
  estimateMinutesForWorkInstructions,
  isWorkingDay,
  neededByFromLead,
  resolveBuyLeadDays,
  subtractWorkingMinutes,
  type CalendarContext,
} from "@/lib/services/schedule";

export type PlanPath = "PROTOTYPE" | "PRODUCTION_HELD" | "PRODUCTION";
export type PathOverride = "none" | "skip_prototype" | "plan_as_production";
export type PlanLineAction = "BUILD" | "BUY" | "STOCK";

export type PlanningPart = {
  id: string;
  partNumber: string;
  description: string;
  sourcingMethod: string;
  uom: string;
};

export type PlanningBomLine = {
  componentPartId: string;
  componentPartNumber: string;
  componentSourcingMethod: string;
  quantity: number;
  scrapFactor: number;
};

export type PlanningBom = {
  id: string;
  partId: string;
  revision: string;
  status: string;
  prototypeRequired: boolean;
  lines: PlanningBomLine[];
};

export type PlanningSupply = { onHand: number; openWoQty: number; openPoQty: number; total: number };

export type PlanningStore = {
  findPart: (token: string) => Promise<PlanningPart | null>;
  companyBomPrototypeRequired: () => Promise<boolean>;
  latestBom: (partId: string) => Promise<PlanningBom | null>;
  supply: (partId: string) => Promise<PlanningSupply>;
  buyLeadDays: (partId: string) => Promise<number>;
  buildMinutes: (partId: string, qty: number) => Promise<number>;
  calendar: () => Promise<CalendarContext>;
  findUser?: (hint: string) => Promise<{ id: string; name: string } | null>;
};

export type DemandPlanInput = {
  partNumber: string;
  quantity: number;
  dueDate: Date;
  budgetAmount?: number | null;
  budgetOwnerId?: string | null;
  budgetOwnerName?: string | null;
  chargeCode?: string | null;
  skipBudget?: boolean;
  override?: PathOverride;
  forecastName?: string;
};

export type DemandPlanLine = {
  partId: string;
  partNumber: string;
  action: PlanLineAction;
  requiredQty: number;
  onHandQty: number;
  shortQty: number;
  level: number;
  parentPartId: string | null;
  dueDate: Date | null;
  neededBy?: Date | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  leadDays?: number;
  buildMinutes?: number;
  bomId?: string | null;
  notes: string;
};

export type DemandPlan = {
  input: DemandPlanInput;
  part: PlanningPart;
  bom: PlanningBom | null;
  prototypeRequired: boolean;
  path: PlanPath;
  pathReason: string;
  override: PathOverride;
  offerCertify: boolean;
  todos: string[];
  lines: DemandPlanLine[];
  feasible: boolean;
  earliestFeasibleDate: Date | null;
  infeasibleWarning: string | null;
  summary: string;
};

const MAX_DEPTH = 10;

export function parsePathOverride(text: string): PathOverride {
  const t = text.toLowerCase();
  if (/\b(skip(?: the)? prototype|plan as production|direct certify|skip proto)\b/.test(t)) {
    return /\bplan as production\b|\bdirect certify\b/.test(t) ? "plan_as_production" : "skip_prototype";
  }
  return "none";
}

/** Header setting wins when a BOM exists; otherwise the company default (true if unset). */
export function resolvePrototypeRequired(opts: {
  companyDefault: boolean | null | undefined;
  bomPrototypeRequired: boolean | null | undefined;
  hasBom: boolean;
}): boolean {
  if (opts.hasBom && typeof opts.bomPrototypeRequired === "boolean") return opts.bomPrototypeRequired;
  if (typeof opts.companyDefault === "boolean") return opts.companyDefault;
  return true;
}

export function resolveDemandPlanPath(opts: {
  bomStatus: string | null;
  prototypeRequired: boolean;
  override?: PathOverride;
}): { path: PlanPath; reason: string; offerCertify: boolean; todos: string[] } {
  const override = opts.override || "none";
  const certified = opts.bomStatus === "CERTIFIED";
  if (certified) {
    return {
      path: "PRODUCTION",
      reason: "The BOM is certified, so this is a production plan. Work orders will be saved as planned, not released.",
      offerCertify: false,
      todos: [],
    };
  }
  const forcedDirect = override === "skip_prototype" || override === "plan_as_production";
  const requirePrototype = forcedDirect ? false : opts.prototypeRequired;
  if (requirePrototype) {
    return {
      path: "PROTOTYPE",
      reason: "This BOM requires the prototype process and is not certified, so the plan uses prototype-phase work orders.",
      offerCertify: false,
      todos: opts.bomStatus === "DRAFT" ? ["Advance the BOM out of draft before a prototype work order can be created."] : [],
    };
  }
  const todos = ["Certify the BOM before production work orders can be created or released."];
  if (forcedDirect && opts.prototypeRequired) {
    todos.push("Override: plan as production / skip prototype — production work orders stay held until the BOM is certified.");
  }
  return {
    path: "PRODUCTION_HELD",
    reason: forcedDirect
      ? "You asked to skip prototype and plan as production. Work orders stay held until the BOM is certified."
      : "Direct certification is allowed for this BOM. The plan is production, with work orders held until the BOM is certified.",
    offerCertify: true,
    todos,
  };
}

export function looksLikeDemandPlan(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(planning worksheet|material requisition|\bmrs\b)\b/.test(t) && /\b(create|generate|make|open|new|plan)\b/.test(t)) {
    return true;
  }
  return (
    /\b(plan|planning)\b/.test(t) &&
    /\b(demand|forecast|build|process|make)\b/.test(t)
  );
}

export function looksLikePlanningWorksheet(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(planning worksheet|material requisition|\bmrs\b)\b/.test(t) && /\b(create|generate|make|open|new|plan)\b/.test(t);
}

export function isSkipBudgetUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(skip( (all|it|them|that|those|budget|the rest))?|later|leave (it|them|those)? ?blank|fill later|none|n\/?a|don't know|not sure|no budget)([.!]*)?$/.test(
    t
  ) || /\b(skip (the )?(budget|rest|those|them)|leave (it|them) blank|fill (it|them) later|no budget( for now)?)\b/.test(t);
}

export function parseDemandPlanUtterance(text: string): Partial<DemandPlanInput> & { forecastNumber?: string; raw: string } {
  const t = text.trim();
  const override = parsePathOverride(t);
  const fc = t.match(/\b(FC-\d+)\b/i);
  const qty =
    Number(after(t, /\bbuild\s+(\d+(?:\.\d+)?)\b/i) || after(t, /\b(\d+(?:\.\d+)?)\s+(?:of|x|units?|pcs|pieces)\b/i) || "") ||
    undefined;
  const partNumber =
    after(t, /\b(?:of|part(?: number)?)\s+(&?[A-Za-z0-9._\/-]{2,})\b/i)?.replace(/^&/, "") ||
    after(t, /\b([A-Z]{2,}[A-Z0-9._\/-]*-\d+[A-Z0-9._\/-]*)\b/) ||
    undefined;
  const dueDate = parsePlanDate(t);
  const budgetAmount = parseBudgetAmount(t);
  const chargeCode = after(t, /\bcharge(?:\s+code)?\s+([A-Za-z0-9._\/-]{2,})\b/i);
  const owner = after(t, /\b(?:owner|responsible(?: person)?)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?:[,.]|$)/i);
  return {
    raw: t,
    partNumber,
    quantity: qty && Number.isFinite(qty) && qty > 0 ? qty : undefined,
    dueDate: dueDate || undefined,
    budgetAmount,
    budgetOwnerName: owner,
    chargeCode,
    override,
    forecastNumber: fc?.[1]?.toUpperCase(),
    forecastName: undefined,
    skipBudget: isSkipBudgetUtterance(t),
  };
}

export function parseBudgetClarify(text: string): {
  budgetAmount?: number | null;
  budgetOwnerName?: string | null;
  chargeCode?: string | null;
  skipBudget?: boolean;
} {
  if (isSkipBudgetUtterance(text)) return { skipBudget: true };
  const budgetAmount = parseBudgetAmount(text);
  const chargeCode = after(text, /\bcharge(?:\s+code)?\s+([A-Za-z0-9._\/-]{2,})\b/i);
  const owner =
    after(text, /\b(?:owner|responsible(?: person)?|owned by)\s+(?:is\s+)?([A-Za-z][A-Za-z .'-]{1,60}?)(?:[,.]|$)/i) ||
    (budgetAmount == null && !/\d/.test(text) && !/\bcharge\b/i.test(text) ? text.trim() : undefined);
  const out: { budgetAmount?: number | null; budgetOwnerName?: string | null; chargeCode?: string | null } = {};
  if (budgetAmount != null) out.budgetAmount = budgetAmount;
  if (owner) out.budgetOwnerName = owner;
  if (chargeCode) out.chargeCode = chargeCode;
  return out;
}

function after(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v || undefined;
}

function parseBudgetAmount(text: string): number | undefined {
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/) || text.match(/\b(?:budget(?: amount)?|amount)\s*(?:of\s*|is\s*|at\s*)?\$?\s*([\d,]+(?:\.\d+)?)\b/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parsePlanDate(text: string): Date | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    const d = new Date(Number(y), Number(us[1]) - 1, Number(us[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const by = text.match(/\bby\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:,?\s*\d{4})?)\b/i);
  if (by) {
    const raw = by[1];
    const withYear = /\d{4}/.test(raw) ? raw : `${raw}, ${new Date().getFullYear()}`;
    const d = new Date(withYear);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function buildDemandPlan(input: DemandPlanInput, store: PlanningStore): Promise<DemandPlan> {
  const part = await store.findPart(input.partNumber);
  if (!part) throw new Error(`I couldn’t find part ${input.partNumber}. Check the part number and try again.`);
  if (!input.quantity || input.quantity <= 0) throw new Error("How many do you need to build?");
  if (!input.dueDate) throw new Error("What date do you need this by?");

  const [companyDefault, bom, calendar] = await Promise.all([
    store.companyBomPrototypeRequired(),
    store.latestBom(part.id),
    store.calendar(),
  ]);
  if (!bom) {
    throw new Error(`There’s no BOM on file for ${part.partNumber}, so I can’t explode a build plan. Add a BOM first.`);
  }
  const prototypeRequired = resolvePrototypeRequired({
    companyDefault,
    bomPrototypeRequired: bom.prototypeRequired,
    hasBom: true,
  });
  const resolved = resolveDemandPlanPath({
    bomStatus: bom.status,
    prototypeRequired,
    override: input.override,
  });

  const lines = await explodeAndNet({
    part,
    quantity: input.quantity,
    dueDate: input.dueDate,
    store,
  });
  const scheduled = await schedulePlan(lines, input.dueDate, calendar, store);

  const todos = [...resolved.todos];
  if (input.skipBudget || (input.budgetAmount == null && !input.budgetOwnerId && !input.chargeCode)) {
    todos.push("Fill in the draft budget later (amount, owner, charge code).");
  }
  if (scheduled.infeasibleWarning) todos.push("Review the earliest feasible date before confirming.");

  const plan: DemandPlan = {
    input: { ...input, partNumber: part.partNumber },
    part,
    bom,
    prototypeRequired,
    path: resolved.path,
    pathReason: resolved.reason,
    override: input.override || "none",
    offerCertify: resolved.offerCertify,
    todos,
    lines: scheduled.lines,
    feasible: scheduled.feasible,
    earliestFeasibleDate: scheduled.earliestFeasibleDate,
    infeasibleWarning: scheduled.infeasibleWarning,
    summary: "",
  };
  plan.summary = formatPlanSummary(plan);
  return plan;
}

async function explodeAndNet(opts: {
  part: PlanningPart;
  quantity: number;
  dueDate: Date;
  store: PlanningStore;
}): Promise<DemandPlanLine[]> {
  const drafts: DemandPlanLine[] = [];
  const supplyCache = new Map<string, PlanningSupply>();
  const allocated = new Map<string, number>();
  const partCache = new Map<string, PlanningPart>([[opts.part.id, opts.part]]);

  async function supplyFor(partId: string) {
    if (!supplyCache.has(partId)) supplyCache.set(partId, await opts.store.supply(partId));
    return supplyCache.get(partId)!;
  }

  async function explode(
    part: PlanningPart,
    qtyNeeded: number,
    parentPartId: string | null,
    level: number,
    chain: Set<string>
  ): Promise<void> {
    const snap = await supplyFor(part.id);
    const used = allocated.get(part.id) || 0;
    const available = Math.max(0, snap.total - used);
    const take = Math.min(available, qtyNeeded);
    allocated.set(part.id, used + take);
    const short = Math.max(0, qtyNeeded - available);
    const onHandDisplay = snap.onHand;

    if (short <= 0) {
      drafts.push({
        partId: part.id,
        partNumber: part.partNumber,
        action: "STOCK",
        requiredQty: qtyNeeded,
        onHandQty: onHandDisplay,
        shortQty: 0,
        level,
        parentPartId,
        dueDate: level === 0 ? opts.dueDate : null,
        notes: `Forecast ${qtyNeeded} covered by supply (stock ${snap.onHand} + WO ${snap.openWoQty} + PO ${snap.openPoQty})`,
      });
      return;
    }

    const sourcing = (part.sourcingMethod || "").toUpperCase();
    const bom = sourcing === "PURCHASE" ? null : await opts.store.latestBom(part.id);
    const canBuild = !!bom && bom.lines.length >= 0 && sourcing !== "PURCHASE";

    if (!canBuild) {
      drafts.push({
        partId: part.id,
        partNumber: part.partNumber,
        action: "BUY",
        requiredQty: qtyNeeded,
        onHandQty: onHandDisplay,
        shortQty: short,
        level,
        parentPartId,
        dueDate: level === 0 ? opts.dueDate : null,
        notes: `Buy ${short} (need ${qtyNeeded}; stock ${snap.onHand}, open WO ${snap.openWoQty}, open PO ${snap.openPoQty})`,
      });
      return;
    }

    drafts.push({
      partId: part.id,
      partNumber: part.partNumber,
      action: "BUILD",
      requiredQty: qtyNeeded,
      onHandQty: onHandDisplay,
      shortQty: short,
      level,
      parentPartId,
      dueDate: level === 0 ? opts.dueDate : null,
      notes: `Build ${short} of ${part.partNumber} (need ${qtyNeeded}; stock ${snap.onHand}, WO ${snap.openWoQty}, PO ${snap.openPoQty})`,
    });

    if (level >= MAX_DEPTH) return;
    for (const bl of bom!.lines) {
      if (chain.has(bl.componentPartId)) continue;
      const nextChain = new Set(chain);
      nextChain.add(part.id);
      const childQty = bl.quantity * short * (1 + (bl.scrapFactor || 0));
      let child = partCache.get(bl.componentPartId);
      if (!child) {
        child = {
          id: bl.componentPartId,
          partNumber: bl.componentPartNumber,
          description: bl.componentPartNumber,
          sourcingMethod: bl.componentSourcingMethod,
          uom: "EA",
        };
        const found = await opts.store.findPart(bl.componentPartNumber);
        if (found) child = found;
        partCache.set(child.id, child);
      }
      await explode(child, childQty, part.id, level + 1, nextChain);
    }
  }

  await explode(opts.part, opts.quantity, null, 0, new Set([opts.part.id]));

  const actionRank: Record<string, number> = { BUILD: 0, BUY: 1, STOCK: 2 };
  const byPart = new Map<string, DemandPlanLine>();
  for (const d of drafts) {
    const key = `${d.partId}:${d.parentPartId || ""}`;
    const existing = byPart.get(key);
    if (!existing) {
      byPart.set(key, { ...d });
      continue;
    }
    existing.requiredQty += d.requiredQty;
    existing.shortQty += d.shortQty;
    existing.onHandQty = Math.min(existing.onHandQty, d.onHandQty);
    if ((actionRank[d.action] ?? 9) < (actionRank[existing.action] ?? 9)) {
      existing.action = d.action;
      existing.notes = d.notes;
    }
  }
  return [...byPart.values()].sort((a, b) => a.level - b.level || a.partNumber.localeCompare(b.partNumber));
}

async function schedulePlan(
  lines: DemandPlanLine[],
  fgDue: Date,
  calendar: CalendarContext,
  store: PlanningStore
): Promise<{
  lines: DemandPlanLine[];
  feasible: boolean;
  earliestFeasibleDate: Date | null;
  infeasibleWarning: string | null;
}> {
  const byId = new Map(lines.map((l) => [l.partId, l]));
  const builds = lines.filter((l) => l.action === "BUILD").sort((a, b) => a.level - b.level);
  const startByPart = new Map<string, Date>();
  const endByPart = new Map<string, Date>();

  for (const line of builds) {
    const minutes = await store.buildMinutes(line.partId, line.shortQty || line.requiredQty);
    line.buildMinutes = minutes;
    let due = line.dueDate || fgDue;
    if (line.parentPartId && startByPart.has(line.parentPartId)) {
      const offset = defaultChildOffsetMinutes(minutes, DEFAULT_STAGING_BUFFER_MINUTES);
      due = subtractWorkingMinutes(startByPart.get(line.parentPartId)!, offset, calendar);
    }
    const plannedEnd = due;
    const plannedStart = subtractWorkingMinutes(plannedEnd, Math.max(minutes, 1), calendar);
    line.dueDate = due;
    line.plannedStart = plannedStart;
    line.plannedEnd = plannedEnd;
    startByPart.set(line.partId, plannedStart);
    endByPart.set(line.partId, plannedEnd);
  }

  for (const line of lines.filter((l) => l.action === "BUY")) {
    const lead = await store.buyLeadDays(line.partId);
    line.leadDays = lead;
    const parentStart = line.parentPartId ? startByPart.get(line.parentPartId) : undefined;
    const need = parentStart || line.dueDate || fgDue;
    line.neededBy = neededByFromLead(need, lead);
    line.dueDate = line.neededBy || line.dueDate;
  }

  const today = startOfWorkingDay(new Date(), calendar);
  let earliestStart: Date | null = null;
  for (const line of builds) {
    if (line.plannedStart && (!earliestStart || line.plannedStart < earliestStart)) earliestStart = line.plannedStart;
  }
  for (const line of lines.filter((l) => l.action === "BUY" && l.neededBy)) {
    const buyStart = subtractCalendarDays(line.neededBy!, line.leadDays || DEFAULT_BUY_LEAD_DAYS);
    if (!earliestStart || buyStart < earliestStart) earliestStart = buyStart;
  }

  let feasible = true;
  let earliestFeasibleDate: Date | null = null;
  let infeasibleWarning: string | null = null;
  if (earliestStart && earliestStart < today) {
    feasible = false;
    const slipMs = today.getTime() - earliestStart.getTime();
    const slipped = new Date(fgDue.getTime() + slipMs);
    earliestFeasibleDate = nextWorkingDay(slipped, calendar);
    infeasibleWarning = `This due date looks infeasible with current lead times, build times and capacity. Earliest feasible date is about ${ymd(earliestFeasibleDate)}.`;
  }

  return { lines, feasible, earliestFeasibleDate, infeasibleWarning };
}

function startOfWorkingDay(d: Date, _ctx: CalendarContext): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  while (!isWorkingDay(x)) x.setDate(x.getDate() + 1);
  return x;
}

function nextWorkingDay(d: Date, _ctx: CalendarContext): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  if (!isWorkingDay(x)) {
    while (!isWorkingDay(x)) x.setDate(x.getDate() + 1);
    return x;
  }
  return x;
}

function subtractCalendarDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - days);
  return x;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatPlanSummary(plan: DemandPlan): string {
  const q = plan.input.quantity;
  const due = ymd(plan.input.dueDate);
  const builds = plan.lines.filter((l) => l.action === "BUILD" && l.shortQty > 0);
  const buys = plan.lines.filter((l) => l.action === "BUY" && l.shortQty > 0);
  const pathLabel =
    plan.path === "PROTOTYPE"
      ? "prototype path"
      : plan.path === "PRODUCTION_HELD"
        ? "production path, held until the BOM is certified"
        : "production path (BOM is certified)";
  const buildBit = builds.length
    ? `Build ${builds.map((l) => `${trimQty(l.shortQty)} ${l.partNumber}`).join(", ")} as planned work orders.`
    : "No new work orders.";
  const buyBit = buys.length
    ? `Buy ${buys.map((l) => `${trimQty(l.shortQty)} ${l.partNumber}`).join(", ")} on draft purchase requests.`
    : "No buy shorts.";
  const dateBit = plan.feasible
    ? `Need-by ${due}.`
    : plan.infeasibleWarning || `Need-by ${due} looks tight.`;
  const certifyBit = plan.offerCertify ? " I can offer a PIN-gated BOM certification when you’re ready." : "";
  const budgetBit =
    plan.input.skipBudget || (plan.input.budgetAmount == null && !plan.input.chargeCode && !plan.input.budgetOwnerName)
      ? " Budget fields are left blank to fill later."
      : ` Draft budget${plan.input.budgetAmount != null ? ` ${plan.input.budgetAmount}` : ""}${
          plan.input.chargeCode ? ` / ${plan.input.chargeCode}` : ""
        }${plan.input.budgetOwnerName ? ` owned by ${plan.input.budgetOwnerName}` : ""}.`;
  return `Plan ${q} of ${plan.part.partNumber} by ${due} on the ${pathLabel}. ${plan.pathReason} ${dateBit} ${buildBit} ${buyBit}${budgetBit} I’ll also create a forecast and a draft planning worksheet (MRS). Nothing is written until you confirm.${certifyBit}`.replace(
    /\s+/g,
    " "
  ).trim();
}

function trimQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export const BUDGET_CLARIFY_PROMPT =
  "What budget amount, owner or responsible person, and charge code should I use? You can skip any of those and I’ll leave them blank to fill later.";

export function needsBudgetClarify(input: DemandPlanInput): boolean {
  if (input.skipBudget) return false;
  return input.budgetAmount == null && !input.budgetOwnerId && !input.budgetOwnerName && !input.chargeCode;
}

export function mergeClarifyIntoInput(input: DemandPlanInput, clarify: ReturnType<typeof parseBudgetClarify>): DemandPlanInput {
  if (clarify.skipBudget) return { ...input, skipBudget: true };
  return {
    ...input,
    budgetAmount: clarify.budgetAmount ?? input.budgetAmount,
    budgetOwnerName: clarify.budgetOwnerName ?? input.budgetOwnerName,
    chargeCode: clarify.chargeCode ?? input.chargeCode,
    skipBudget:
      input.skipBudget ||
      (clarify.budgetAmount == null && !clarify.budgetOwnerName && !clarify.chargeCode && false),
  };
}

export async function createPrismaPlanningStore(): Promise<PlanningStore> {
  const { ctx } = await buildCalendarContext({});
  return {
    async findPart(token) {
      const q = token.trim();
      if (!q) return null;
      const row = await prisma.part.findFirst({
        where: {
          isActive: true,
          OR: [
            { partNumber: { equals: q, mode: "insensitive" } },
            { partNumber: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, partNumber: true, description: true, sourcingMethod: true, uom: true },
        orderBy: { partNumber: "asc" },
      });
      return row
        ? {
            id: row.id,
            partNumber: row.partNumber,
            description: row.description || row.partNumber,
            sourcingMethod: row.sourcingMethod || "MAKE",
            uom: row.uom || "EA",
          }
        : null;
    },
    async companyBomPrototypeRequired() {
      const row = await prisma.companySettings.findUnique({
        where: { id: "default" },
        select: { bomPrototypeRequired: true },
      });
      return row?.bomPrototypeRequired ?? true;
    },
    async latestBom(partId) {
      const include = { lines: { include: { componentPart: { select: { id: true, partNumber: true, sourcingMethod: true } } } } } as const;
      const certified = await prisma.bomHeader.findFirst({
        where: { partId, status: "CERTIFIED" },
        orderBy: { revision: "desc" },
        include,
      });
      const row =
        certified ||
        (await prisma.bomHeader.findFirst({
          where: { partId, status: { notIn: ["OBSOLETE"] } },
          orderBy: { revision: "desc" },
          include,
        }));
      if (!row) return null;
      return {
        id: row.id,
        partId: row.partId,
        revision: String(row.revision),
        status: row.status,
        prototypeRequired: row.prototypeRequired,
        lines: row.lines.map((l) => ({
          componentPartId: l.componentPartId,
          componentPartNumber: l.componentPart.partNumber,
          componentSourcingMethod: l.componentPart.sourcingMethod || "PURCHASE",
          quantity: l.quantity,
          scrapFactor: l.scrapFactor || 0,
        })),
      };
    },
    async supply(partId) {
      return getPartSupplySnapshot(partId);
    },
    async buyLeadDays(partId) {
      return resolveBuyLeadDays(partId);
    },
    async buildMinutes(partId, qty) {
      const linked = await prisma.workInstruction.findMany({
        where: { partId, status: "RELEASED" },
        orderBy: { revision: "desc" },
        take: 1,
        select: { id: true },
      });
      if (!linked.length) return Math.max(60, qty * 30);
      const est = await estimateMinutesForWorkInstructions(
        linked.map((w) => w.id),
        qty
      );
      return est.estimatedMinutes || Math.max(60, qty * 30);
    },
    async calendar() {
      return ctx;
    },
    async findUser(hint) {
      const q = hint.trim();
      if (!q) return null;
      const row = await prisma.user.findFirst({
        where: { isActive: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
        select: { id: true, name: true },
      });
      return row;
    },
  };
}

export type DemandPlanExecuteResult = {
  forecastNumber: string;
  forecastId: string;
  budgetNumber?: string;
  budgetId?: string;
  mrsNumber: string;
  mrsId: string;
  workOrders: { number: string; id: string; type: string }[];
  purchaseRequests: { number: string; id: string }[];
  href: string;
  text: string;
};

function planName(plan: DemandPlan): string {
  return plan.input.forecastName?.trim() || `Plan ${plan.input.quantity} of ${plan.part.partNumber} by ${ymd(plan.input.dueDate)}`;
}


export function reviveDemandPlan(raw: unknown): DemandPlan {
  const plan = (typeof raw === "string" ? JSON.parse(raw) : raw) as DemandPlan;
  const asDate = (v: unknown): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  plan.input.dueDate = asDate(plan.input.dueDate) as Date;
  plan.earliestFeasibleDate = asDate(plan.earliestFeasibleDate);
  for (const line of plan.lines || []) {
    line.dueDate = asDate(line.dueDate);
    line.neededBy = asDate(line.neededBy);
    line.plannedStart = asDate(line.plannedStart);
    line.plannedEnd = asDate(line.plannedEnd);
  }
  return plan;
}

export async function executeDemandPlan(planInput: DemandPlan, userId: string): Promise<DemandPlanExecuteResult> {
  const plan = reviveDemandPlan(planInput);
  const needed = ["planning.forecast.create"] as string[];
  if (plan.lines.some((l) => l.action === "BUILD" && l.shortQty > 0 && plan.path === "PROTOTYPE" && plan.bom && plan.bom.status !== "DRAFT")) {
    needed.push("workorders.create");
  }
  if (plan.lines.some((l) => l.action === "BUILD" && l.shortQty > 0 && plan.path === "PRODUCTION" && plan.bom?.status === "CERTIFIED")) {
    needed.push("workorders.create");
  }
  if (plan.lines.some((l) => l.action === "BUY" && l.shortQty > 0)) needed.push("purchasing.pr.create");
  const wantsBudget = !plan.input.skipBudget && (plan.input.budgetAmount != null || !!plan.input.chargeCode || !!plan.input.budgetOwnerId || !!plan.input.budgetOwnerName);
  if (wantsBudget) needed.push("budgets.manage");
  const missing: string[] = [];
  for (const code of needed) {
    if (!(await userHasPermission(userId, code))) missing.push(code);
  }
  if (missing.length) {
    throw new Error(
      `You’re missing permission to finish this plan (${missing.join(", ")}). I didn’t create any records.`
    );
  }

  const created: {
    forecastId?: string;
    budgetId?: string;
    mrsId?: string;
    woIds: string[];
    prIds: string[];
  } = { woIds: [], prIds: [] };

  try {
    const forecast = await createForecast({
      name: planName(plan),
      periodEnd: plan.input.dueDate,
      notes: `Carina demand plan (${plan.path}). ${plan.pathReason}`,
      lines: [{ partId: plan.part.id, quantity: plan.input.quantity, dueDate: plan.input.dueDate }],
      userId,
    });
    created.forecastId = forecast.id;

    let budgetId: string | undefined;
    let budgetNumber: string | undefined;
    if (wantsBudget) {
      let ownerId = plan.input.budgetOwnerId || userId;
      if (!plan.input.budgetOwnerId && plan.input.budgetOwnerName) {
        const store = await createPrismaPlanningStore();
        const u = await store.findUser?.(plan.input.budgetOwnerName);
        if (u) ownerId = u.id;
      }
      const budget = await createBudget({
        name: plan.input.chargeCode || planName(plan),
        sourceType: "FORECAST",
        forecastIds: [forecast.id],
        ownerId,
        chargeCode: plan.input.chargeCode || null,
        totalAmount: plan.input.budgetAmount || 0,
        userId,
        enact: false,
      });
      created.budgetId = budget.id;
      budgetId = budget.id;
      budgetNumber = budget.number;
    }

    const mrsNumber = await nextMrsNumber();
    const mrs = await prisma.materialRequisition.create({
      data: {
        number: mrsNumber,
        status: "DRAFT",
        forecastId: forecast.id,
        name: planName(plan),
        notes: `Carina planning worksheet. ${plan.pathReason}`,
        createdById: userId,
        lines: {
          create: plan.lines.map((l) => ({
            partId: l.partId,
            requiredQty: l.requiredQty,
            onHandQty: l.onHandQty,
            shortQty: l.shortQty,
            action: l.action,
            parentPartId: l.parentPartId,
            level: l.level,
            notes: l.notes,
            dueDate: l.neededBy || l.dueDate,
          })),
        },
      },
      include: { lines: true },
    });
    created.mrsId = mrs.id;

    const workOrders: { number: string; id: string; type: string }[] = [];
    const canCreateProtoWo = plan.path === "PROTOTYPE" && plan.bom && ["PROTOTYPE", "CERTIFIED", "IN_REVIEW"].includes(plan.bom.status);
    const canCreateProdWo = plan.path === "PRODUCTION" && plan.bom?.status === "CERTIFIED";
    const woType = canCreateProtoWo ? "PROTOTYPE" : "PRODUCTION";
    if (canCreateProtoWo || canCreateProdWo) {
      const builds = plan.lines
        .filter((l) => l.action === "BUILD" && l.shortQty > 0)
        .sort((a, b) => a.level - b.level);
      const partWo = new Map<string, string>();
      for (const line of builds) {
        const parentWorkOrderId = line.parentPartId ? partWo.get(line.parentPartId) : undefined;
        const wo = await createWorkOrder({
          type: woType,
          sourceType: "MATERIAL_REQ",
          materialRequisitionId: mrs.id,
          bomHeaderId: line.bomId || (line.level === 0 ? plan.bom!.id : undefined),
          partId: line.partId,
          quantity: line.shortQty,
          createdById: userId,
          dueDate: line.dueDate || plan.input.dueDate,
          plannedStart: line.plannedStart || undefined,
          plannedEnd: line.plannedEnd || undefined,
          scheduleMode: "BACK",
          parentWorkOrderId,
          status: "PLANNED",
          description: `Carina ${woType.toLowerCase()} plan via ${mrs.number} — ${line.partNumber}`,
        });
        created.woIds.push(wo.id);
        workOrders.push({ number: wo.number, id: wo.id, type: woType });
        partWo.set(line.partId, wo.id);
        const mrsLine = mrs.lines.find((ml) => ml.partId === line.partId && ml.parentPartId === line.parentPartId);
        if (mrsLine) {
          await prisma.materialRequisitionLine.update({
            where: { id: mrsLine.id },
            data: { workOrderId: wo.id },
          });
        }
      }
    }

    const purchaseRequests: { number: string; id: string }[] = [];
    const buys = plan.lines.filter((l) => l.action === "BUY" && l.shortQty > 0);
    if (buys.length) {
      const neededBy = buys.map((l) => l.neededBy || l.dueDate || plan.input.dueDate).sort((a, b) => a.getTime() - b.getTime())[0];
      const pr = await createStandalonePurchaseRequest({
        lines: buys.map((l) => ({
          partId: l.partId,
          description: l.partNumber,
          quantity: l.shortQty,
          uom: "EA",
        })),
        purpose: "MANUFACTURING",
        justification: `Buy demand from Carina plan / ${mrs.number} (forecast ${forecast.number})`,
        department: "Planning",
        neededBy,
        budgetId,
        chargeCode: plan.input.chargeCode || null,
        submit: false,
        userId,
      });
      created.prIds.push(pr.id);
      purchaseRequests.push({ number: pr.number, id: pr.id });
      await prisma.materialRequisitionLine.updateMany({
        where: { materialRequisitionId: mrs.id, action: "BUY", shortQty: { gt: 0 } },
        data: { purchaseRequestId: pr.id },
      });
      if ("materialRequisitionId" in (pr as object) || true) {
        try {
          await prisma.purchaseRequest.update({
            where: { id: pr.id },
            data: { materialRequisitionId: mrs.id, triggerSource: "MATERIAL_REQ" },
          });
        } catch {
          // Link is optional if the column write is rejected by a status guard.
        }
      }
    }

    await logAudit({
      entityType: "Forecast",
      entityId: forecast.id,
      action: "CARINA_DEMAND_PLAN",
      userId,
      metadata: {
        via: "carina",
        path: plan.path,
        prototypeRequired: plan.prototypeRequired,
        override: plan.override,
        mrs: mrs.number,
        workOrders: workOrders.map((w) => w.number),
        purchaseRequests: purchaseRequests.map((p) => p.number),
      },
    });

    const woBit = workOrders.length ? ` Planned ${workOrders.map((w) => w.number).join(", ")} (${woType.toLowerCase()}).` : plan.path === "PRODUCTION_HELD" ? " Production work orders are held until the BOM is certified." : "";
    const prBit = purchaseRequests.length ? ` Draft ${purchaseRequests.map((p) => p.number).join(", ")} (not submitted).` : "";
    const budgetBit = budgetNumber ? ` Draft budget ${budgetNumber}.` : "";
    const text = `I created forecast ${forecast.number} and planning worksheet ${mrs.number}.${budgetBit}${woBit}${prBit} Humans still execute the PRs and work orders.`;
    return {
      forecastNumber: forecast.number,
      forecastId: forecast.id,
      budgetNumber,
      budgetId,
      mrsNumber: mrs.number,
      mrsId: mrs.id,
      workOrders,
      purchaseRequests,
      href: `/planning/mrs/${mrs.id}`,
      text,
    };
  } catch (e) {
    await compensateDemandPlan(created);
    throw e;
  }
}

async function nextMrsNumber(): Promise<string> {
  const rows = await prisma.materialRequisition.findMany({
    where: { number: { startsWith: "MRS-" } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (n > max) max = n;
  }
  return `MRS-${String(max + 1).padStart(5, "0")}`;
}

async function compensateDemandPlan(created: {
  forecastId?: string;
  budgetId?: string;
  mrsId?: string;
  woIds: string[];
  prIds: string[];
}) {
  try {
    if (created.prIds.length) {
      await prisma.purchaseRequest.deleteMany({ where: { id: { in: created.prIds } } });
    }
    if (created.woIds.length) {
      await prisma.workOrder.deleteMany({ where: { id: { in: created.woIds } } });
    }
    if (created.mrsId) {
      await prisma.materialRequisition.delete({ where: { id: created.mrsId } }).catch(() => undefined);
    }
    if (created.budgetId) {
      await prisma.budget.delete({ where: { id: created.budgetId } }).catch(() => undefined);
    }
    if (created.forecastId) {
      await prisma.forecast.delete({ where: { id: created.forecastId } }).catch(() => undefined);
    }
  } catch {
    // Best-effort compensation; the original error is still thrown to the caller.
  }
}

export async function executePlanningWorksheet(opts: {
  plan: DemandPlan;
  userId: string;
}): Promise<DemandPlanExecuteResult> {
  return executeDemandPlan(opts.plan, opts.userId);
}
