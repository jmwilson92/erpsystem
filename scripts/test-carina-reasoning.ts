import assert from "node:assert/strict";
import fs from "node:fs";
import {
  formatCountBreakdown,
  looksLikeCountSummary,
  readOnlyRefusalPattern,
  buildReasonSystemPrompt,
} from "../src/lib/ai-help/reason-policy";
import {
  ACTIONS_ENABLED_POLICY,
  ACTIONS_DISABLED_POLICY,
  sanitizeEvidenceText,
  evidenceLooksStaleReadOnly,
} from "../src/lib/ai-help/knowledge-pack";
import { helpSafetyReply, helpSystem, looksLikeRecordChange } from "../src/lib/ai-help/answer";
import { UNPARSED_ACTION_REPLY, unparsedActionReply } from "../src/lib/services/carina-voice-actions";
import { parseVoiceActionIntent } from "../src/lib/services/carina-voice-intent";
import { runCarinaReasonTurn, reasonTools, type ReasonChat, type ReasonActionPort } from "../src/lib/ai-help/reason-loop";
import type { LookupHit, LookupStore } from "../src/lib/ai-help/lookup";

async function main() {
const refusal = readOnlyRefusalPattern();

// --- Remaining 7:58 PM read-only paths (toggle on) ---
assert.equal(looksLikeRecordChange("Can you change records?"), true);
assert.equal(looksLikeRecordChange("Can you create a purchase request?"), true);
assert.equal(looksLikeRecordChange("How do I create a work order?"), false);
assert.equal(helpSafetyReply("Can you change records?", { voiceActions: true }), null);
assert.equal(helpSafetyReply("Can you create a purchase request?", { voiceActions: true }), null);
assert.match(helpSafetyReply("Can you change records?") || "", /read-only help/i);

const enabledSys = helpSystem([], "/", "English", { voiceActions: true });
assert.match(enabledSys, /ACTIONS ARE ENABLED/i);
assert.ok(!refusal.test(enabledSys), "actions-enabled prompt must not say she is read-only");
assert.ok(!refusal.test(ACTIONS_ENABLED_POLICY));
assert.match(ACTIONS_DISABLED_POLICY, /Voice actions are off/i);

const stale =
  "It is read-only product help grounded in reviewed product guides. It does not access live records or execute changes.";
assert.equal(evidenceLooksStaleReadOnly(stale), true);
const cleaned = sanitizeEvidenceText(stale, true);
assert.equal(evidenceLooksStaleReadOnly(cleaned), false);
assert.ok(!refusal.test(cleaned));
assert.match(cleaned, /confirm-gated|live records/i);
assert.equal(sanitizeEvidenceText(stale, false), stale);

assert.ok(!refusal.test(UNPARSED_ACTION_REPLY), "unparsed fallback must not refuse creates");
assert.match(unparsedActionReply("Can you create a purchase request?") || "", /purchase request/i);
assert.equal(unparsedActionReply("How many work orders do I have?"), null);

const prIntent = parseVoiceActionIntent("create a purchase request for 10 office chairs");
assert.equal(prIntent?.kind, "CREATE_PURCHASE_REQUEST");

const features = fs.readFileSync("src/lib/services/carina-features.ts", "utf8");
assert.match(features, /could not read CompanySettings\.carinaVoiceActions/);
assert.match(features, /voiceActions = false/);

const execute = fs.readFileSync("src/lib/services/carina-voice-actions.ts", "utf8");
assert.match(execute, /CREATE_PURCHASE_REQUEST/);
assert.match(execute, /submit: false/);
assert.match(execute, /purchasing\.pr\.create/);

// --- Conversational counts, not a list dump ---
const summary = formatCountBreakdown("work_order", {
  total: 12,
  byStatus: { IN_WORK: 5, READY_FOR_PUTAWAY: 3, RELEASED: 4 },
});
assert.match(summary, /12 work orders/);
assert.match(summary, /5 in work/);
assert.match(summary, /3 putaway/);
assert.match(summary, /Want me to list the in work ones/);
assert.ok(looksLikeCountSummary(summary));
assert.ok(!/WO-\d+[^\n]*\nWO-\d+[^\n]*\nWO-\d+/i.test(summary));

const voicePrompt = buildReasonSystemPrompt({ voiceActions: true, voice: true, language: "English" });
assert.match(voicePrompt, /ACTIONS ARE ENABLED/i);
assert.match(voicePrompt, /1–3 short sentences|1-3 short sentences|short sentences/);
assert.ok(!refusal.test(voicePrompt));

assert.ok(reasonTools(false).every((t) => !["propose_purchase_request", "propose_change"].includes(t.function.name)));
assert.ok(reasonTools(true).some((t) => t.function.name === "propose_purchase_request"));
assert.ok(reasonTools(true).some((t) => t.function.name === "count_records"));

function memoryStore(records: LookupHit[]): LookupStore {
  return {
    async search(entity, query) {
      const q = query.toLowerCase();
      return records.filter(
        (r) =>
          r.entity === entity &&
          (r.number.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q))
      );
    },
    async get(entity, idOrNumber) {
      const q = idOrNumber.toLowerCase();
      return records.find((r) => r.entity === entity && (r.id === idOrNumber || r.number.toLowerCase() === q)) || null;
    },
    async count(entity) {
      const rows = records.filter((r) => r.entity === entity);
      const byStatus: Record<string, number> = {};
      for (const r of rows) {
        const s = r.status || "unknown";
        byStatus[s] = (byStatus[s] || 0) + 1;
      }
      return { total: rows.length, byStatus };
    },
  };
}

const workOrders: LookupHit[] = [
  { entity: "work_order", id: "1", number: "WO-00001", title: "A", status: "IN_WORK", href: "/work-orders/1", summary: "A", fields: {} },
  { entity: "work_order", id: "2", number: "WO-00002", title: "B", status: "IN_WORK", href: "/work-orders/2", summary: "B", fields: {} },
  { entity: "work_order", id: "3", number: "WO-00003", title: "C", status: "IN_WORK", href: "/work-orders/3", summary: "C", fields: {} },
  { entity: "work_order", id: "4", number: "WO-00004", title: "D", status: "IN_WORK", href: "/work-orders/4", summary: "D", fields: {} },
  { entity: "work_order", id: "5", number: "WO-00005", title: "E", status: "IN_WORK", href: "/work-orders/5", summary: "E", fields: {} },
  { entity: "work_order", id: "6", number: "WO-00006", title: "F", status: "READY_FOR_PUTAWAY", href: "/work-orders/6", summary: "F", fields: {} },
  { entity: "work_order", id: "7", number: "WO-00007", title: "G", status: "READY_FOR_PUTAWAY", href: "/work-orders/7", summary: "G", fields: {} },
  { entity: "work_order", id: "8", number: "WO-00008", title: "H", status: "READY_FOR_PUTAWAY", href: "/work-orders/8", summary: "H", fields: {} },
  { entity: "work_order", id: "9", number: "WO-00009", title: "I", status: "RELEASED", href: "/work-orders/9", summary: "I", fields: {} },
  { entity: "work_order", id: "10", number: "WO-00010", title: "J", status: "RELEASED", href: "/work-orders/10", summary: "J", fields: {} },
  { entity: "work_order", id: "11", number: "WO-00011", title: "K", status: "RELEASED", href: "/work-orders/11", summary: "K", fields: {} },
  { entity: "work_order", id: "12", number: "WO-00012", title: "L", status: "RELEASED", href: "/work-orders/12", summary: "L", fields: {} },
];

// Example Q&A: "how many work orders" → count tool → total + status breakdown + offer, not a 12-row dump
let hop = 0;
const countChat: ReasonChat = async ({ system, tools }) => {
  assert.ok(tools.some((t) => t.function.name === "count_records"));
  assert.match(system, /ACTIONS ARE ENABLED/i);
  hop += 1;
  if (hop === 1) {
    return { toolCalls: [{ id: "c1", name: "count_records", arguments: { entity: "work_order" } }] };
  }
  return {
    text: "You have 12 work orders: 5 in work, 3 putaway, 4 released. Want me to list the in work ones?",
  };
};
const counted = await runCarinaReasonTurn({
  question: "how many work orders do I have",
  voiceActions: true,
  store: memoryStore(workOrders),
  chat: countChat,
});
assert.ok(counted);
assert.deepEqual(counted!.toolNames, ["count_records"]);
assert.equal(counted!.hops, 1);
assert.ok(looksLikeCountSummary(counted!.text));
assert.ok(!/WO-00001[\s\S]*WO-00002[\s\S]*WO-00003/.test(counted!.text));

// Confirm-gated purchase request proposal (nothing written until yes)
const pending = {
  action: "CREATE_PURCHASE_REQUEST",
  phase: "confirm" as const,
  partial: {},
  draft: { title: "Create purchase request" },
};
const actions: ReasonActionPort = {
  async proposePurchaseRequest(input) {
    assert.match(input.description, /office chairs/i);
    assert.equal(input.quantity, 10);
    return {
      ok: true,
      text: `Create a draft purchase request for ${input.quantity} EA of ${input.description} as other. It will be saved as DRAFT, not submitted, until you confirm. Say yes to confirm, or no to cancel.`,
      pendingAction: pending,
    };
  },
  async proposeChange() {
    throw new Error("should not propose a change");
  },
};
let prHop = 0;
const prChat: ReasonChat = async ({ tools }) => {
  assert.ok(tools.some((t) => t.function.name === "propose_purchase_request"));
  prHop += 1;
  if (prHop === 1) {
    return {
      toolCalls: [
        {
          id: "p1",
          name: "propose_purchase_request",
          arguments: { description: "office chairs", quantity: 10, purpose: "OTHER" },
        },
      ],
    };
  }
  return {
    text: "I can create a draft purchase request for 10 office chairs. It won’t be submitted until you confirm. Say yes to confirm, or no to cancel.",
  };
};
const proposed = await runCarinaReasonTurn({
  question: "Can you create a purchase request for 10 office chairs?",
  voiceActions: true,
  store: memoryStore([]),
  actions,
  chat: prChat,
});
assert.ok(proposed);
assert.deepEqual(proposed!.toolNames, ["propose_purchase_request"]);
assert.equal(proposed!.pendingAction?.action, "CREATE_PURCHASE_REQUEST");
assert.equal(proposed!.pendingAction?.phase, "confirm");
assert.match(proposed!.text, /draft purchase request/i);
assert.match(proposed!.text, /confirm/i);
assert.ok(!refusal.test(proposed!.text));

// Actions off: no propose tools, and the prompt does not claim she can create records
const offTools = reasonTools(false).map((t) => t.function.name);
assert.ok(!offTools.includes("propose_purchase_request"));
assert.match(buildReasonSystemPrompt({ voiceActions: false }), /Voice actions are off/);

// Source wiring: pending confirm first, then reason loop, then regex fallback
const ai = fs.readFileSync("src/lib/services/ai.ts", "utf8");
assert.match(ai, /pendingOnly: true/);
assert.match(ai, /runCarinaReasonTurn/);
assert.match(ai, /createReasonActionPort/);
assert.match(ai, /unparsedActionReply/);
assert.match(ai, /voice: !!opts\?\.voice/);

const page = fs.readFileSync("src/app/ai/page.tsx", "utf8");
assert.match(page, /confirm-gated changes and create a purchase request/);
assert.ok(!/Read-only product help/.test(page));
const bubble = fs.readFileSync("src/components/support/support-bubble.tsx", "utf8");
assert.match(bubble, /confirm-gated changes and create a purchase request/);
assert.ok(!/Read-only help, not live data/.test(bubble));


console.log("PASS Carina reasoning: count+status summaries, confirm-gated PR drafts, leftover read-only paths closed");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
