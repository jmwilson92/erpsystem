/**
 * AI Assistant service — rule-based prototype with upgrade path to xAI Grok API.
 *
 * Production upgrade:
 *   1. Set XAI_API_KEY in env
 *   2. Implement callGrok() with tool-calling against live ERP tools
 *   3. Register tools: getFloorStatus, getOpenMrb, getSupplierScores, suggestGoals, etc.
 */

import { prisma } from "@/lib/db";
import { getFloorBoardData } from "./work-orders";
import { getValueStreamMetrics } from "./supply-chain";
import { computeEvm } from "@/lib/utils";

export type AiMessage = { role: "user" | "assistant" | "system"; content: string };

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

async function callGrok(query: string): Promise<string> {
  const ctx = await getAiContextSummary();
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-2-latest",
      messages: [
        {
          role: "system",
          content: `You are ForgeRP AI assistant for a high-reliability manufacturing plant. Be concise, action-oriented, and cite module names. Live context JSON: ${JSON.stringify(ctx)}`,
        },
        { role: "user", content: query },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`Grok API ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response from Grok.";
}
