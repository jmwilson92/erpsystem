/**
 * Reasoning-led Carina turn: the model chooses lookup, count, and
 * confirm-gated propose tools. Regex / instant replies stay as a
 * hearing-check fast path and as a fallback when this loop fails.
 */
import type { HelpCitation } from "./knowledge";
import type { AiGuideAction, AiPendingAction } from "@/lib/services/ai";
import { resolveNavigation } from "./navigate";
import { startHowto } from "./howto";
import {
  LOOKUP_ENTITIES,
  LOOKUP_EXCLUDED_MESSAGE,
  isExcludedLookupQuery,
  isLookupEntity,
  type LookupEntityId,
} from "./lookup-policy";
import { createLookupApi, type LookupCanView, type LookupStore } from "./lookup";
import { citationsFromHits } from "./lookup-loop";
import { buildReasonSystemPrompt, formatCountBreakdown, type CountBreakdown } from "./reason-policy";
import type { GrokToolCall, GrokToolDef } from "@/lib/services/grok";

export const REASON_MAX_HOPS = 4;
export const REASON_TIMEOUT_MS = 15000;

export const REASON_LOOKUP_TOOLS: GrokToolDef[] = [
  {
    type: "function",
    function: {
      name: "count_records",
      description:
        "Count live tenant records the user may view, grouped by status. Use for “how many” questions. Never dump the full list.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          entity: { type: "string", enum: LOOKUP_ENTITIES },
        },
        required: ["entity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_records",
      description:
        "Search live tenant records the signed-in user may view. Optional entity filter. Never use for payroll, HR, salary or financial balances.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          entity: { type: "string", enum: LOOKUP_ENTITIES },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_record",
      description: "Get one record by entity and id or document number. Cites the in-app href.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          entity: { type: "string", enum: LOOKUP_ENTITIES },
          idOrNumber: { type: "string" },
        },
        required: ["entity", "idOrNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_floor_status",
      description:
        "Production-floor monitor: a concise overview of open and late work, low-stock parts (days of cover, high-usage first), work-center staffing versus scheduled load for the coming weeks, past-due purchase orders, quality holds/NCRs, and pending approvals. Use for “status of my floor”, “running low on parts”, or “which work center is overloaded”. Set topic to drill in.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: {
            type: "string",
            enum: ["overview", "low_stock", "capacity", "late", "quality", "approvals"],
            description: "overview for the short rundown; otherwise the area to explain in more detail.",
          },
        },
      },
    },
  },
];

export const REASON_ACTION_TOOLS: GrokToolDef[] = [
  {
    type: "function",
    function: {
      name: "propose_purchase_request",
      description:
        "Prepare a confirm-gated draft to create a purchase request (saved as DRAFT, not auto-submitted). Use when the user wants to create a PR or buy something. Facilities/other may use a free-text description; manufacturing/project lines need a catalog part number.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          uom: { type: "string" },
          purpose: {
            type: "string",
            enum: ["FACILITIES", "OTHER", "MANUFACTURING", "PROJECT"],
          },
          justification: { type: "string" },
          department: { type: "string" },
          partNumber: { type: "string" },
        },
        required: ["description", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_change",
      description:
        "Prepare a confirm-gated draft for an allowed record change. Nothing is written until the user confirms.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["EDIT_PROJECT", "TIE_WO", "CYCLE_COUNT", "CONSUME_PARTS", "OUTPUT_WO"],
          },
          workOrderNumber: { type: "string" },
          projectNumber: { type: "string" },
          budgetNumber: { type: "string" },
          partNumber: { type: "string" },
          location: { type: "string" },
          countedQty: { type: "number" },
          projectName: { type: "string" },
          reason: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_demand_plan",
      description:
        "Prepare a confirm-gated demand plan: explode the BOM, net supply, backward-schedule, and propose a forecast, draft budget, planning worksheet (MRS), planned work orders and draft purchase requests. Follow the company/BOM prototypeRequired setting unless the user overrides (skip prototype / plan as production). Ask for budget amount, owner and charge code if missing (each skippable).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          partNumber: { type: "string" },
          quantity: { type: "number" },
          dueDate: { type: "string", description: "Need-by date YYYY-MM-DD" },
          budgetAmount: { type: "number" },
          budgetOwnerName: { type: "string" },
          chargeCode: { type: "string" },
          skipBudget: { type: "boolean" },
          override: { type: "string", enum: ["none", "skip_prototype", "plan_as_production"] },
        },
        required: ["partNumber", "quantity", "dueDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_planning_worksheet",
      description:
        "Prepare a confirm-gated planning worksheet (material requisition). Pass a forecast number, or a part number, quantity and due date.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          forecastNumber: { type: "string" },
          partNumber: { type: "string" },
          quantity: { type: "number" },
          dueDate: { type: "string" },
          override: { type: "string", enum: ["none", "skip_prototype", "plan_as_production"] },
        },
      },
    },
  },
];

export const REASON_NAV_TOOLS: GrokToolDef[] = [
  {
    type: "function",
    function: {
      name: "navigate",
      description:
        "Navigate the signed-in user to an app page or a specific record they may view. Use for “take me to”, “open”, “go to”, “show me WO-00008”. Returns an href the client will router.push. If several matches, ask which one. If permission is missing, say so and do not navigate.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "The place or record the user asked for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_howto",
      description:
        "Start a step-by-step how-to: navigate to the right page, explain the current step in one or two short sentences, and highlight the control. The user says “next” for the next step. Offer to do it when Carina has a confirm-gated action for the task.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
];

export function reasonTools(voiceActions: boolean): GrokToolDef[] {
  return voiceActions
    ? [...REASON_LOOKUP_TOOLS, ...REASON_NAV_TOOLS, ...REASON_ACTION_TOOLS]
    : [...REASON_LOOKUP_TOOLS, ...REASON_NAV_TOOLS];
}

export type ReasonChat = (params: {
  system: string;
  messages: {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: GrokToolCall[];
  }[];
  tools: GrokToolDef[];
}) => Promise<{ text?: string; toolCalls?: GrokToolCall[] }>;

export type ReasonActionPort = {
  proposePurchaseRequest: (input: {
    description: string;
    quantity: number;
    uom?: string;
    purpose?: string;
    justification?: string;
    department?: string;
    partNumber?: string;
  }) => Promise<{ ok: boolean; text: string; pendingAction?: AiPendingAction | null }>;
  proposeChange: (input: {
    kind: string;
    workOrderNumber?: string;
    projectNumber?: string;
    budgetNumber?: string;
    partNumber?: string;
    location?: string;
    countedQty?: number;
    projectName?: string;
    reason?: string;
  }) => Promise<{ ok: boolean; text: string; pendingAction?: AiPendingAction | null }>;
  proposeDemandPlan: (input: {
    partNumber: string;
    quantity: number;
    dueDate: string;
    budgetAmount?: number;
    budgetOwnerName?: string;
    chargeCode?: string;
    skipBudget?: boolean;
    override?: string;
  }) => Promise<{ ok: boolean; text: string; pendingAction?: AiPendingAction | null }>;
  proposePlanningWorksheet: (input: {
    forecastNumber?: string;
    partNumber?: string;
    quantity?: number;
    dueDate?: string;
    override?: string;
  }) => Promise<{ ok: boolean; text: string; pendingAction?: AiPendingAction | null }>;
};

export type ReasonTurnResult = {
  text: string;
  source: "grok" | "local";
  citations: HelpCitation[];
  pendingAction?: AiPendingAction | null;
  hops: number;
  toolNames: string[];
  href?: string;
  guide?: AiGuideAction;
};

function entityOf(value: unknown): LookupEntityId | null {
  return isLookupEntity(value) ? value : null;
}

export async function runCarinaReasonTurn(opts: {
  question: string;
  userId?: string;
  voiceActions: boolean;
  language?: string;
  page?: string | null;
  voice?: boolean;
  store: LookupStore;
  canView?: LookupCanView;
  chat?: ReasonChat;
  actions?: ReasonActionPort;
  onDelta?: (text: string) => void;
}): Promise<ReasonTurnResult | null> {
  if (isExcludedLookupQuery(opts.question)) {
    opts.onDelta?.(LOOKUP_EXCLUDED_MESSAGE);
    return { text: LOOKUP_EXCLUDED_MESSAGE, source: "local", citations: [], hops: 0, toolNames: [] };
  }
  if (!opts.chat) return null;

  const api = createLookupApi({ store: opts.store, canView: opts.canView });
  const system = buildReasonSystemPrompt({
    voiceActions: opts.voiceActions,
    language: opts.language,
    page: opts.page,
    voice: opts.voice,
  });
  const tools = reasonTools(opts.voiceActions);
  const messages: Parameters<ReasonChat>[0]["messages"] = [{ role: "user", content: opts.question }];
  const toolNames: string[] = [];
  let pendingAction: AiPendingAction | null | undefined;
  let href: string | undefined;
  let guide: AiGuideAction | undefined;
  const citations: HelpCitation[] = [];
  let hops = 0;

  while (hops < REASON_MAX_HOPS) {
    const turn = await opts.chat({ system, messages, tools });
    if (turn.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: turn.text || "",
        toolCalls: turn.toolCalls,
      });
      for (const call of turn.toolCalls) {
        if (hops >= REASON_MAX_HOPS) break;
        hops += 1;
        toolNames.push(call.name);
        const payload = await executeReasonTool(call.name, call.arguments || {}, {
          userId: opts.userId,
          voiceActions: opts.voiceActions,
          api,
          actions: opts.actions,
          store: opts.store,
        });
        if (payload.pendingAction) pendingAction = payload.pendingAction;
        if (payload.citations) citations.push(...payload.citations);
        if (payload.href) href = payload.href;
        if (payload.guide) guide = payload.guide;
        messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: JSON.stringify(payload.result),
        });
      }
      continue;
    }
    if (turn.text?.trim()) {
      const text = turn.text.trim();
      opts.onDelta?.(text);
      return {
        text,
        source: "grok",
        citations,
        pendingAction: pendingAction ?? null,
        hops,
        toolNames,
        href,
        guide,
      };
    }
    break;
  }

  // If the model proposed a draft but didn't speak, use the draft text.
  if (pendingAction && messages.length) {
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");
    if (lastTool?.content) {
      try {
        const parsed = JSON.parse(lastTool.content) as { text?: string };
        if (parsed.text) {
          opts.onDelta?.(parsed.text);
          return {
            text: parsed.text,
            source: "local",
            citations,
            pendingAction,
            hops,
            toolNames,
            href,
            guide,
          };
        }
      } catch {
        // fall through
      }
    }
  }

  return null;
}

async function executeReasonTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    userId?: string;
    voiceActions: boolean;
    api: ReturnType<typeof createLookupApi>;
    actions?: ReasonActionPort;
    store: import("./lookup").LookupStore;
  }
): Promise<{
  result: unknown;
  pendingAction?: AiPendingAction | null;
  citations?: HelpCitation[];
  href?: string;
  guide?: AiGuideAction;
}> {
  if (name === "count_records") {
    const entity = entityOf(args.entity);
    if (!entity) return { result: { ok: false, message: "count_records requires a known entity." } };
    const counted = await ctx.api.count({ userId: ctx.userId, entity });
    if (!counted.ok) return { result: counted };
    return {
      result: {
        ok: true,
        entity,
        ...counted.breakdown,
        suggestedReply: formatCountBreakdown(entity, counted.breakdown),
      },
    };
  }
  if (name === "search_records") {
    const query = String(args.query || "").trim();
    const entity = entityOf(args.entity) || undefined;
    const out = await ctx.api.search({ userId: ctx.userId, query, entity });
    return {
      result: out,
      citations: out.ok ? citationsFromHits(out.hits) : undefined,
    };
  }
  if (name === "get_record") {
    const entity = entityOf(args.entity);
    const idOrNumber = String(args.idOrNumber || "").trim();
    if (!entity || !idOrNumber) {
      return { result: { ok: false, message: "get_record requires entity and idOrNumber." } };
    }
    const out = await ctx.api.get({ userId: ctx.userId, entity, idOrNumber });
    return { result: out, citations: out.ok ? citationsFromHits(out.hits) : undefined };
  }
  if (name === "propose_demand_plan" || name === "propose_planning_worksheet") {
    if (!ctx.voiceActions) {
      return { result: { ok: false, message: "Carina voice actions are off in this workspace. An administrator can enable them in Admin → Settings." } };
    }
    if (!ctx.actions) {
      return { result: { ok: false, message: "Action tools are not available on this turn." } };
    }
    const out =
      name === "propose_demand_plan"
        ? await ctx.actions.proposeDemandPlan({
            partNumber: String(args.partNumber || "").trim(),
            quantity: Number(args.quantity) || 0,
            dueDate: String(args.dueDate || "").trim(),
            budgetAmount: args.budgetAmount != null ? Number(args.budgetAmount) : undefined,
            budgetOwnerName: args.budgetOwnerName ? String(args.budgetOwnerName) : undefined,
            chargeCode: args.chargeCode ? String(args.chargeCode) : undefined,
            skipBudget: !!args.skipBudget,
            override: args.override ? String(args.override) : undefined,
          })
        : await ctx.actions.proposePlanningWorksheet({
            forecastNumber: args.forecastNumber ? String(args.forecastNumber) : undefined,
            partNumber: args.partNumber ? String(args.partNumber) : undefined,
            quantity: args.quantity != null ? Number(args.quantity) : undefined,
            dueDate: args.dueDate ? String(args.dueDate) : undefined,
            override: args.override ? String(args.override) : undefined,
          });
    return { result: out, pendingAction: out.pendingAction };
  }
  if (name === "propose_purchase_request" || name === "propose_change") {
    if (!ctx.voiceActions) {
      return {
        result: {
          ok: false,
          message:
            "Carina voice actions are off in this workspace. An administrator can enable them in Admin → Settings.",
        },
      };
    }
    if (!ctx.actions) {
      return { result: { ok: false, message: "Action tools are not available on this turn." } };
    }
    const out =
      name === "propose_purchase_request"
        ? await ctx.actions.proposePurchaseRequest({
            description: String(args.description || "").trim(),
            quantity: Number(args.quantity) || 0,
            uom: args.uom ? String(args.uom) : undefined,
            purpose: args.purpose ? String(args.purpose) : undefined,
            justification: args.justification ? String(args.justification) : undefined,
            department: args.department ? String(args.department) : undefined,
            partNumber: args.partNumber ? String(args.partNumber) : undefined,
          })
        : await ctx.actions.proposeChange({
            kind: String(args.kind || ""),
            workOrderNumber: args.workOrderNumber ? String(args.workOrderNumber) : undefined,
            projectNumber: args.projectNumber ? String(args.projectNumber) : undefined,
            budgetNumber: args.budgetNumber ? String(args.budgetNumber) : undefined,
            partNumber: args.partNumber ? String(args.partNumber) : undefined,
            location: args.location ? String(args.location) : undefined,
            countedQty: args.countedQty != null ? Number(args.countedQty) : undefined,
            projectName: args.projectName ? String(args.projectName) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
    return { result: out, pendingAction: out.pendingAction };
  }
  if (name === "navigate" || name === "explain_howto") {
    const { userCanView, userHasPermission } = await import("@/lib/auth");
    const query = String(name === "navigate" ? args.query || "" : args.question || "").trim();
    if (!query) return { result: { ok: false, message: `${name} requires a query.` } };
    if (name === "explain_howto") {
      const started = startHowto(query, { voice: false });
      if (!started) {
        return { result: { ok: false, message: "I don’t have a step-by-step for that yet. I can still take you to the closest page." } };
      }
      return {
        result: { ok: true, text: started.text, href: started.href },
        pendingAction: started.pendingAction,
        href: started.href,
        guide: started.guide,
      };
    }
    const nav = await resolveNavigation(query, {
      userId: ctx.userId,
      store: ctx.store,
      canView: userCanView,
      hasPermission: ctx.userId
        ? (id, perm) => userHasPermission(id, perm)
        : undefined,
    });
    const guide = nav.highlight
      ? {
          stepByStep: true,
          steps: [
            {
              selector: nav.highlight.selector,
              route: nav.href,
              title: nav.highlight.label || "",
              body: nav.text,
            },
          ],
        }
      : undefined;
    return {
      result: { ok: nav.ok, text: nav.text, href: nav.ok ? nav.href : undefined, kind: nav.kind, matches: nav.matches },
      pendingAction: nav.pendingAction,
      href: nav.ok ? nav.href : undefined,
      guide,
    };
  }
  if (name === "get_floor_status") {
    const { loadFloorSnapshot, formatFloorOverview, formatFloorDetail, floorPendingAction } = await import(
      "@/lib/services/carina-floor"
    );
    const topicRaw = String(args.topic || "overview").trim();
    const topic =
      topicRaw === "low_stock" ||
      topicRaw === "capacity" ||
      topicRaw === "late" ||
      topicRaw === "quality" ||
      topicRaw === "approvals"
        ? topicRaw
        : "overview";
    const snapshot = await loadFloorSnapshot();
    const detail = topic === "overview" ? { text: formatFloorOverview(snapshot) } : formatFloorDetail(snapshot, topic);
    return {
      result: {
        ok: true,
        text: detail.text,
        href: "href" in detail ? detail.href : undefined,
        lowStock: snapshot.lowStock.slice(0, 5).map((a) => ({
          partNumber: a.partNumber,
          daysOfCover: a.daysOfCover,
          title: a.title,
        })),
        capacity: snapshot.capacity.slice(0, 5).map((a) => ({
          workCenter: a.workCenter,
          weekLabel: a.weekLabel,
          utilizationPct: Math.round(a.utilizationPct),
          title: a.title,
        })),
        lateWorkOrders: snapshot.signals.lateWorkOrders.length,
        pastDuePurchaseOrders: snapshot.signals.pastDuePurchaseOrders.length,
        openNcrs: snapshot.signals.openNcrs.length,
        pendingApprovals: snapshot.signals.pendingApprovals,
      },
      href: "href" in detail ? detail.href : undefined,
      pendingAction: floorPendingAction(topic, "offerPrPart" in detail ? detail.offerPrPart : undefined),
    };
  }
  return { result: { ok: false, message: `Unknown tool ${name}` } };
}

export function formatCountToolFallback(entity: LookupEntityId, breakdown: CountBreakdown): string {
  return formatCountBreakdown(entity, breakdown);
}
