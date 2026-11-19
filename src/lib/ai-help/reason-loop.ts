/**
 * Reasoning-led Carina turn: the model chooses lookup, count, and
 * confirm-gated propose tools. Regex / instant replies stay as a
 * hearing-check fast path and as a fallback when this loop fails.
 */
import type { HelpCitation } from "./knowledge";
import type { AiPendingAction } from "@/lib/services/ai";
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
];

export function reasonTools(voiceActions: boolean): GrokToolDef[] {
  return voiceActions ? [...REASON_LOOKUP_TOOLS, ...REASON_ACTION_TOOLS] : REASON_LOOKUP_TOOLS;
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
};

export type ReasonTurnResult = {
  text: string;
  source: "grok" | "local";
  citations: HelpCitation[];
  pendingAction?: AiPendingAction | null;
  hops: number;
  toolNames: string[];
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
        });
        if (payload.pendingAction) pendingAction = payload.pendingAction;
        if (payload.citations) citations.push(...payload.citations);
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
  }
): Promise<{
  result: unknown;
  pendingAction?: AiPendingAction | null;
  citations?: HelpCitation[];
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
  return { result: { ok: false, message: `Unknown tool ${name}` } };
}

export function formatCountToolFallback(entity: LookupEntityId, breakdown: CountBreakdown): string {
  return formatCountBreakdown(entity, breakdown);
}
