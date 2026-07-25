/**
 * AI Assistant service — rule-based prototype with upgrade path to xAI Grok API.
 *
 * Production upgrade:
 *   1. Set XAI_API_KEY in env
 *   2. Implement callGrok() with tool-calling against live ERP tools
 *   3. Register tools: getFloorStatus, getOpenMrb, getSupplierScores, suggestGoals, etc.
 */

import { prisma } from "@/lib/db";
import {
  getTour,
  listToursForAi,
  matchTourFromQuery,
  type TourStep,
} from "@/lib/guides";
import { getFloorBoardData } from "./work-orders";
import { getValueStreamMetrics } from "./supply-chain";
import { computeEvm } from "@/lib/utils";

export type AiMessage = { role: "user" | "assistant" | "system"; content: string };

/** Optional walkthrough attached to a Carina reply. */
export type AiGuideAction = {
  /** Existing interactive tour id from /guides */
  tourId?: string;
  /** Ad-hoc spotlight steps (used when no canned tour fits) */
  steps?: TourStep[];
};

export type AiConversationOutput = {
  text: string;
  guide?: AiGuideAction;
};

const OFF_TOPIC_REPLY =
  "I only help with ForgeRP manufacturing ERP — production, quality, purchasing, inventory, sales, shipping, engineering, programs, accounting, HR, and how to use the app. What plant or system question can I help with?";

/** Loose check so we still answer plant slang; rejects pure chitchat / general web. */
export function looksLikeErpTopic(text: string): boolean {
  const t = text.toLowerCase();
  if (
    /\b(weather|recipe|sports|movie|joke|poem|dating|crypto|bitcoin|stock market|who won|president|celebrity)\b/.test(
      t
    ) &&
    !/\b(erp|forge|work order|mrb|inventory|purchase|quality)\b/.test(t)
  ) {
    return false;
  }
  if (
    /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|help|what can you do)[\s!.?]*$/i.test(
      t.trim()
    )
  ) {
    return true;
  }
  if (
    /\b(work\s*order|wo\b|mrb|ncr|car\b|bom|po\b|pr\b|inventory|kit|floor|production|quality|purchas|receiv|ship|sales|quote|customer|supplier|payroll|timesheet|hr\b|budget|project|pmo|serial|rma|calibrat|audit|part|item|traveler|scrap|yield|capacity|mrp|forecast|ecr|eco|trace|gfp|asset|invoice|gl\b|ledger|approv|onboard|recruit|forge|erp|module|how do i|where is|show me|walk me|navigate|dashboard|sidebar)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (t.split(/\s+/).length >= 4) return true;
  return false;
}

function wantsWalkthrough(text: string): boolean {
  return /\b(show me|walk me|take me|guide me|how do i|where do i|where is|how to|tour|walkthrough|demonstrate|bring me to|open the)\b/i.test(
    text
  );
}

export async function getAiContextSummary() {
  const [floor, vsm, mrbOpen, ncrOpen, projects, suppliers, goals] = await Promise.all([
    getFloorBoardData(),
    getValueStreamMetrics(),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.nonConformance.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } } }),
    prisma.project.findMany({ where: { status: "ACTIVE" } }),
    prisma.supplier.findMany({ orderBy: { overallScore: "asc" }, take: 3 }),
    prisma.employeeGoal.findMany({ where: { status: "ACTIVE" }, include: { user: true }, take: 5 }),
  ]);

  const projectEvm = projects.map((p) => {
    const { spi, cpi } = computeEvm(p.plannedValue, p.earnedValue, p.actualCost);
    return { name: p.name, number: p.number, spi, cpi, pct: p.percentComplete };
  });

  return {
    floor: floor.counts,
    wipValue: floor.wipValue,
    mrbOpen,
    ncrOpen,
    valueStream: vsm.stages,
    projects: projectEvm,
    weakSuppliers: suppliers.map((s) => ({
      name: s.name,
      rating: s.rating,
      score: s.overallScore,
      otd: s.onTimeDeliveryPct,
    })),
    goals: goals.map((g) => ({
      title: g.title,
      user: g.user.name,
      progress: g.progress,
      category: g.category,
    })),
  };
}

export async function processAiQuery(query: string): Promise<string> {
  if (!looksLikeErpTopic(query)) {
    return OFF_TOPIC_REPLY;
  }

  // Prefer live Grok if configured
  if (process.env.XAI_API_KEY) {
    try {
      return await callGrok(query);
    } catch (e) {
      console.error("Grok API failed, falling back to local assistant:", e);
    }
  }

  const q = query.toLowerCase();
  const ctx = await getAiContextSummary();

  if (q.includes("floor") || q.includes("production") || q.includes("work order")) {
    return [
      `**Production Floor Status**`,
      ``,
      `- In Progress: **${ctx.floor.inProgress}** work orders`,
      `- Released (queued): **${ctx.floor.released}**`,
      `- On Hold: **${ctx.floor.onHold}** ⚠️`,
      `- Planned: **${ctx.floor.planned}**`,
      `- WIP Value: **$${Math.round(ctx.wipValue).toLocaleString()}**`,
      ``,
      ctx.floor.onHold > 0
        ? `**Recommendation:** ${ctx.floor.onHold} WO(s) on hold — check MRB material holds and clear blockers first. Visit the Production Floor dashboard for color-coded tiles.`
        : `Floor load looks healthy. Keep sign-off cadence on in-progress travelers.`,
    ].join("\n");
  }

  if (q.includes("mrb") || q.includes("ncr") || q.includes("quality") || q.includes("quarantine")) {
    const mrbCases = await prisma.mrbCase.findMany({
      where: { status: { in: ["OPEN", "IN_REVIEW"] } },
      include: { ncr: { include: { part: true, supplier: true } } },
      take: 5,
    });
    const lines = mrbCases.map(
      (m) =>
        `- **${m.number}**: ${m.ncr.title} (${m.ncr.part?.partNumber || "n/a"}) — supplier ${m.ncr.supplier?.name || "n/a"} [${m.status}]`
    );
    return [
      `**Quality / MRB Snapshot**`,
      ``,
      `- Open NCRs: **${ctx.ncrOpen}**`,
      `- Open MRB cases: **${ctx.mrbOpen}**`,
      ``,
      lines.length ? `**Active MRB:**\n${lines.join("\n")}` : "No open MRB cases.",
      ``,
      `**Suggested next steps:**`,
      `1. Schedule board for IN_REVIEW cases`,
      `2. Request supplier root cause / CAR if source is RECEIVING`,
      `3. Disposition options: Use-as-is · Rework · Scrap · Return to Supplier · Repair`,
      `4. Closing MRB auto-updates inventory hold and supplier scorecard`,
    ].join("\n");
  }

  if (q.includes("supplier") || q.includes("scorecard") || q.includes("otd")) {
    const lines = ctx.weakSuppliers.map(
      (s) => `- **${s.name}**: Rating ${s.rating} · Score ${s.score} · OTD ${s.otd}%`
    );
    return [
      `**Supplier Performance**`,
      ``,
      `Lowest-scoring suppliers:`,
      ...lines,
      ``,
      `Scorecards pull live OTD from PO receipts, quality PPM from NCRs/MRB, and cost variance.`,
      `**Action:** Open Supplier Scorecards to drill into POs/NCRs or raise a CAR for Rating C/D/F suppliers.`,
    ].join("\n");
  }

  if (q.includes("value stream") || q.includes("supply chain") || q.includes("bottleneck")) {
    const constraints = ctx.valueStream.filter((s) => s.status !== "healthy");
    return [
      `**Value Stream Health**`,
      ``,
      ...ctx.valueStream.map(
        (s) =>
          `- **${s.label}**: ${s.metrics.map((m) => `${m.label} ${m.unit === "$" ? "$" : ""}${m.value}${m.unit === "%" ? "%" : ""}`).join(", ")} — _${s.status}_`
      ),
      ``,
      constraints.length
        ? `**Constraints highlighted:** ${constraints.map((c) => c.label).join(", ")}. Focus improvement kaizens on these stages.`
        : `No major constraints detected in the current snapshot.`,
    ].join("\n");
  }

  if (q.includes("project") || q.includes("evm") || q.includes("spi") || q.includes("cpi")) {
    const lines = ctx.projects.map(
      (p) =>
        `- **${p.number} ${p.name}**: SPI ${p.spi.toFixed(2)} · CPI ${p.cpi.toFixed(2)} · ${p.pct}% complete`
    );
    return [
      `**Project EVM Summary**`,
      ``,
      ...(lines.length ? lines : ["No active projects."]),
      ``,
      `SPI ≥ 1.0 = on/ahead of schedule · CPI ≥ 1.0 = under/on budget.`,
      `Projects can generate Work Orders and roll actual costs from time + material issues.`,
    ].join("\n");
  }

  if (q.includes("goal") || q.includes("career") || q.includes("development") || q.includes("hr")) {
    const lines = ctx.goals.map(
      (g) => `- **${g.user}**: ${g.title} (${g.progress}% · ${g.category || "GENERAL"})`
    );
    return [
      `**Workforce Goals**`,
      ``,
      ...(lines.length ? lines : ["No active goals."]),
      ``,
      `**AI development suggestions (prototype):**`,
      `- Pair low certification progress with expiring certs in HR`,
      `- Recommend cross-training operators on TEST-01 / CMM based on WO backlog`,
      `- Link engineering goals to open CM change requests and sprint capacity`,
      ``,
      `_Upgrade: wire XAI_API_KEY for personalized Grok suggestions with tool calling._`,
    ].join("\n");
  }

  if (q.includes("bom") || q.includes("prototype") || q.includes("certif")) {
    const protos = await prisma.bomHeader.findMany({
      where: { status: { in: ["PROTOTYPE", "IN_REVIEW"] } },
      include: { part: true },
    });
    return [
      `**BOM Configuration Management**`,
      ``,
      `Prototype / in-review BOMs:`,
      ...protos.map(
        (b) =>
          `- **${b.part.partNumber} Rev ${b.revision}** [${b.status}] — cannot be used for PRODUCTION WOs until certified`
      ),
      ``,
      `Flow: Draft → Prototype → (build FAI) → CM Review → **Certify** (locks rev, obsoletes prior certified).`,
      `Work Instructions link to part/BOM revision; sign-offs on WOs feed the floor board.`,
    ].join("\n");
  }

  // Default overview
  return [
    `I'm the **ForgeRP Assistant** (local mode). Here's a plant snapshot:`,
    ``,
    `| Area | Status |`,
    `|---|---|`,
    `| Active WOs | ${ctx.floor.inProgress} in progress, ${ctx.floor.onHold} hold |`,
    `| MRB | ${ctx.mrbOpen} open |`,
    `| NCRs | ${ctx.ncrOpen} open |`,
    `| WIP $ | $${Math.round(ctx.wipValue).toLocaleString()} |`,
    ``,
    `Try asking about: **production floor**, **MRB**, **suppliers**, **value stream**, **projects/EVM**, **goals**, or **BOM certification**.`,
    ``,
    `_Set \`XAI_API_KEY\` to upgrade to live xAI Grok with tool calling._`,
  ].join("\n");
}

function buildCarinaSystem(ctx: unknown): string {
  const tours = listToursForAi()
    .map((t) => `- ${t.id}: ${t.title} (${t.category}) — ${t.description}`)
    .join("\n");

  return `You are Carina, the ForgeRP manufacturing ERP assistant (voice + text).

STRICT SCOPE — ERP ONLY:
- You ONLY discuss ForgeRP / manufacturing ERP topics: production, work orders, quality/MRB/NCR, purchasing, receiving, inventory, sales/shipping, BOMs/engineering, programs/PMO, accounting/payroll, HR, admin setup, navigation inside the app, and live plant data.
- Refuse anything else (weather, sports, general knowledge, politics, personal advice, creative writing, other software). One short redirect, then invite an ERP question.
- Do not roleplay as other characters. Do not say your name every turn (speakers pick it up).

STYLE:
- 2–4 short sentences for speech when possible.
- Warm, practical, action-oriented. Name modules and paths (e.g. Work Orders, MRB).

WALKTHROUGHS:
- When the user asks how to do something, where something is, or says "show me" / "walk me through", pick the best matching tourId from the catalog below.
- If none fit but a single module helps, you may omit tourId and just explain + mention the route.
- Valid tour ids ONLY from this list:
${tours}

RESPONSE FORMAT — reply with ONLY valid JSON (no markdown fences):
{"speak":"<what you say out loud>","tourId":"<id or null>"}

Live plant snapshot (may be partial): ${JSON.stringify(ctx).slice(0, 5500)}`;
}

function parseCarinaJson(raw: string): AiConversationOutput | null {
  const trimmed = raw.trim();
  // Strip accidental fences
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(unfenced.slice(start, end + 1)) as {
      speak?: string;
      text?: string;
      tourId?: string | null;
      guide?: string | null;
    };
    const text = (obj.speak || obj.text || "").trim();
    if (!text) return null;
    const tid = (obj.tourId || obj.guide || "").toString().trim();
    const guide =
      tid && tid !== "null" && getTour(tid) ? { tourId: tid } : undefined;
    return { text, guide };
  } catch {
    return null;
  }
}

async function callGrok(query: string): Promise<string> {
  const ctx = await getAiContextSummary();
  const { grokChat } = await import("@/lib/services/grok");
  return grokChat({
    temperature: 0.35,
    system: `You are the ForgeRP manufacturing ERP assistant. ERP topics only — production, quality, purchasing, inventory, sales, engineering, programs, accounting, HR, navigation. Refuse off-topic in one short sentence. Be concise and cite modules. Live plant context: ${JSON.stringify(ctx).slice(0, 5000)}`,
    user: query,
  });
}

/**
 * Multi-turn voice/chat conversation with Grok + live ERP context.
 * May attach a guided tour when the user asks "show me / how do I…".
 */
export async function processAiConversation(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<AiConversationOutput> {
  const last = messages.filter((m) => m.role === "user").pop()?.content || "";
  if (!last.trim()) {
    return { text: "I didn't hear a question. Try again." };
  }

  if (!looksLikeErpTopic(last)) {
    return { text: OFF_TOPIC_REPLY };
  }

  if (process.env.XAI_API_KEY?.trim()) {
    try {
      let ctx: unknown = { note: "context unavailable" };
      try {
        ctx = await getAiContextSummary();
      } catch (ctxErr) {
        console.warn("[ai] context summary failed, continuing without:", ctxErr);
      }
      const { grokChat } = await import("@/lib/services/grok");
      const system = buildCarinaSystem(ctx);
      const content = await grokChat({
        temperature: 0.35,
        system,
        user: last,
        messages: [
          { role: "system", content: system },
          ...messages
            .filter((m) => m.content?.trim())
            .slice(-8)
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
        ],
      });
      if (content?.trim()) {
        const parsed = parseCarinaJson(content);
        if (parsed) {
          // If user clearly wants a walkthrough but model skipped tourId, match locally
          if (!parsed.guide && wantsWalkthrough(last)) {
            const tid = matchTourFromQuery(last);
            if (tid) parsed.guide = { tourId: tid };
          }
          return parsed;
        }
        // Model returned plain text — still usable
        const out: AiConversationOutput = { text: content.trim() };
        if (wantsWalkthrough(last)) {
          const tid = matchTourFromQuery(last);
          if (tid) out.guide = { tourId: tid };
        }
        return out;
      }
    } catch (e) {
      console.error("Grok conversation failed:", e);
      // fall through to local
    }
  }

  try {
    const text = await processAiQuery(last);
    const out: AiConversationOutput = { text };
    if (wantsWalkthrough(last)) {
      const tid = matchTourFromQuery(last);
      if (tid) {
        out.guide = { tourId: tid };
        out.text = `${text}\n\nI'll open the interactive walkthrough so you can follow along on screen.`;
      }
    }
    return out;
  } catch {
    return {
      text: "I'm having trouble answering right now. Try the text chat on the AI page, or ask again in a moment.",
    };
  }
}
