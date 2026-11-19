/**
 * Tool loop for Carina record lookup. The model may call search_records /
 * get_record up to LOOKUP_MAX_HOPS times, then must answer and cite
 * record numbers or in-app links. Deterministic identifier hits and one
 * auto-expand hop run first so common questions stay fast.
 */
import type { HelpCitation } from "./knowledge";
import {
  LOOKUP_ENTITIES,
  LOOKUP_EXCLUDED_MESSAGE,
  LOOKUP_MAX_HOPS,
  formatLookupReply,
  isExcludedLookupQuery,
  isLookupEntity,
  parseRecordHints,
  type LookupEntityId,
  type LookupHit,
  type LookupResult,
} from "./lookup-policy";
import { createLookupApi, type LookupCanView, type LookupStore } from "./lookup";

export const LOOKUP_TOOLS = [
  {
    type: "function" as const,
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
    type: "function" as const,
    function: {
      name: "get_record",
      description:
        "Get one record by entity and id or document number. Read-only. Cites the in-app href.",
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

export type LookupToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LookupToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<LookupResult>;

export function citationsFromHits(hits: LookupHit[]): HelpCitation[] {
  const seen = new Set<string>();
  const out: HelpCitation[] = [];
  for (const h of hits) {
    const id = `record:${h.entity}:${h.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: `${h.title} (${h.number})`, href: h.href });
  }
  return out;
}

export function expandKeysFromHit(hit: LookupHit): Array<{ entity: LookupEntityId; idOrNumber: string }> {
  const keys: Array<{ entity: LookupEntityId; idOrNumber: string }> = [];
  const f = hit.fields || {};
  const add = (entity: LookupEntityId, value: unknown) => {
    if (typeof value === "string" && value.trim()) keys.push({ entity, idOrNumber: value.trim() });
  };
  if (hit.entity === "work_order") {
    add("part", f.partNumber || f.partId);
    add("inventory", f.partNumber);
    add("project", f.projectNumber || f.projectId);
  }
  if (hit.entity === "sales_order" || hit.entity === "quote" || hit.entity === "rma") {
    add("customer", f.customerId || f.customerName);
  }
  if (hit.entity === "purchase_order") {
    add("vendor", f.supplierId || f.supplierName);
    add("project", f.projectId);
  }
  if (hit.entity === "part") {
    add("inventory", hit.number);
    add("bom", hit.number);
  }
  if (hit.entity === "shipment") add("sales_order", f.salesOrderId);
  if (hit.entity === "ncr") add("work_order", f.workOrderId);
  if (hit.entity === "serial") {
    add("part", f.partNumber || f.partId);
    add("work_order", f.workOrderId);
  }
  return keys;
}

export function createLookupToolExecutor(opts: {
  userId?: string;
  store: LookupStore;
  canView?: LookupCanView;
}): LookupToolExecutor {
  const api = createLookupApi({ store: opts.store, canView: opts.canView });
  return async (name, args) => {
    if (name === "search_records") {
      const query = String(args.query || "").trim();
      const entity = isLookupEntity(args.entity) ? args.entity : undefined;
      if (isExcludedLookupQuery(query)) {
        return { ok: false, reason: "excluded", message: LOOKUP_EXCLUDED_MESSAGE };
      }
      return api.search({ userId: opts.userId, query, entity });
    }
    if (name === "get_record") {
      const entity = args.entity;
      const idOrNumber = String(args.idOrNumber || "").trim();
      if (!isLookupEntity(entity) || !idOrNumber) {
        return { ok: false, reason: "invalid", message: "get_record requires entity and idOrNumber." };
      }
      return api.get({ userId: opts.userId, entity, idOrNumber });
    }
    return { ok: false, reason: "invalid", message: `Unknown tool ${name}` };
  };
}

export async function collectDeterministicHits(
  execute: LookupToolExecutor,
  question: string,
  maxHops = LOOKUP_MAX_HOPS
): Promise<{ hits: LookupHit[]; failures: LookupResult[]; hops: number }> {
  const hits: LookupHit[] = [];
  const failures: LookupResult[] = [];
  const seen = new Set<string>();
  let hops = 0;
  const hints = parseRecordHints(question);
  const queue: Array<{ name: "get_record" | "search_records"; arguments: Record<string, unknown> }> = hints.map((h) => ({
    name: "get_record" as const,
    arguments: { entity: h.entity, idOrNumber: h.idOrNumber },
  }));
  if (!hints.length) {
    queue.push({ name: "search_records", arguments: { query: question } });
  }

  while (queue.length && hops < maxHops) {
    const call = queue.shift()!;
    hops += 1;
    const result = await execute(call.name, call.arguments);
    if (!result.ok) {
      failures.push(result);
      continue;
    }
    for (const hit of result.hits) {
      const key = `${hit.entity}:${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      for (const next of expandKeysFromHit(hit)) {
        const nkey = `${next.entity}:${next.idOrNumber.toLowerCase()}`;
        if (seen.has(nkey) || hops + queue.length >= maxHops) continue;
        queue.push({ name: "get_record", arguments: next });
      }
    }
  }
  return { hits, failures, hops };
}

export type ChatWithTools = (params: {
  system: string;
  messages: { role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; name?: string }[];
  tools: typeof LOOKUP_TOOLS;
}) => Promise<{ text?: string; toolCalls?: LookupToolCall[] }>;

export async function runLookupToolLoop(opts: {
  question: string;
  execute: LookupToolExecutor;
  chat?: ChatWithTools;
  priorHits?: LookupHit[];
  maxHops?: number;
}): Promise<{ hits: LookupHit[]; text: string; hops: number; failures: LookupResult[] }> {
  const maxHops = opts.maxHops ?? LOOKUP_MAX_HOPS;
  const collected = await collectDeterministicHits(opts.execute, opts.question, maxHops);
  const hits = [...(opts.priorHits || []), ...collected.hits];
  const failures = [...collected.failures];
  let hops = collected.hops;

  if (opts.chat && hops < maxHops) {
    const system =
      "You are Carina, a read-only Protessera assistant. Use search_records and get_record to look up live tenant data the user may view. Product docs are optional extra context, not a requirement. Never request payroll, HR, salary, financial balances or other tenants' data. After at most a few tool calls, answer with record numbers and in-app paths only. No writes.";
    const messages: {
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      toolCallId?: string;
      name?: string;
    }[] = [
      {
        role: "user",
        content: JSON.stringify({
          question: opts.question,
          alreadyFound: hits.map((h) => ({
            entity: h.entity,
            number: h.number,
            status: h.status,
            href: h.href,
            summary: h.summary,
          })),
        }),
      },
    ];
    while (hops < maxHops) {
      const turn = await opts.chat({ system, messages, tools: LOOKUP_TOOLS });
      if (turn.toolCalls?.length) {
        for (const call of turn.toolCalls) {
          if (hops >= maxHops) break;
          hops += 1;
          const result = await opts.execute(call.name, call.arguments || {});
          if (result.ok) {
            for (const hit of result.hits) {
              if (!hits.some((h) => h.entity === hit.entity && h.id === hit.id)) hits.push(hit);
            }
          } else {
            failures.push(result);
          }
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }
      if (turn.text?.trim()) {
        return { hits, text: turn.text.trim(), hops, failures };
      }
      break;
    }
  }

  if (hits.length) return { hits, text: formatLookupReply(hits, opts.question), hops, failures };
  const denied = failures.find((f) => !f.ok && f.reason === "permission-denied");
  if (denied && !denied.ok) return { hits, text: denied.message, hops, failures };
  const excluded = failures.find((f) => !f.ok && f.reason === "excluded");
  if (excluded && !excluded.ok) return { hits, text: excluded.message, hops, failures };
  const missing = failures.find((f) => !f.ok && f.reason === "not-found");
  if (missing && !missing.ok) return { hits, text: missing.message, hops, failures };
  return {
    hits,
    text: "I couldn’t find a matching record you can view in this workspace.",
    hops,
    failures,
  };
}

export async function answerRecordLookup(opts: {
  question: string;
  userId?: string;
  store: LookupStore;
  canView?: LookupCanView;
  chat?: ChatWithTools;
  onDelta?: (text: string) => void;
}): Promise<{ text: string; citations: HelpCitation[]; source: "local" | "grok"; hops: number } | null> {
  if (isExcludedLookupQuery(opts.question)) {
    const text = LOOKUP_EXCLUDED_MESSAGE;
    opts.onDelta?.(text);
    return { text, citations: [], source: "local", hops: 0 };
  }
  const execute = createLookupToolExecutor({
    userId: opts.userId,
    store: opts.store,
    canView: opts.canView,
  });
  const out = await runLookupToolLoop({
    question: opts.question,
    execute,
    chat: opts.chat,
  });
  if (!out.hits.length && !out.failures.length && !opts.chat) return null;
  if (!out.hits.length && !out.failures.length) return null;
  opts.onDelta?.(out.text);
  return {
    text: out.text,
    citations: citationsFromHits(out.hits),
    source: opts.chat ? "grok" : "local",
    hops: out.hops,
  };
}
