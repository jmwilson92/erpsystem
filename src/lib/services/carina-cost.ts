/**
 * Carina cost model (xAI usage estimates).
 *
 * Prices are approximate public xAI list rates (mid-2026) — update when billing changes.
 * All figures USD. Used for planning + optional usage accounting later.
 *
 * Sources: x.ai API pricing pages (Grok chat, TTS).
 */

export const CARINA_COST = {
  /** Prefer a fast cheap model for voice turns */
  chatFast: {
    modelHint: "grok-4-1-fast / grok-4-fast class",
    inputPer1M: 0.2,
    outputPer1M: 0.5,
  },
  /** Heavier model if you force flagship */
  chatFlagship: {
    modelHint: "grok-4 / grok-4.5 class",
    inputPer1M: 2.0,
    outputPer1M: 6.0,
  },
  /** Grok TTS (Carina voice) */
  ttsPer1MChars: 15.0,
  /**
   * Browser Web Speech API STT is free (Chrome). If you move to xAI STT streaming:
   * ~$0.20/hour streaming.
   */
  sttStreamingPerHour: 0.2,
} as const;

/** Typical token/char sizes we observe in this product */
export const CARINA_USAGE_PROFILE = {
  /** System + catalog + plant snapshot per turn */
  avgInputTokensTalk: 2_800,
  /** Short spoken answer JSON */
  avgOutputTokensTalk: 180,
  /** Invent walkthrough: larger prompt (catalog) + step JSON */
  avgInputTokensInvent: 3_500,
  avgOutputTokensInvent: 350,
  /** Agent finish-WO: tool-ish turn, smaller */
  avgInputTokensAgent: 1_200,
  avgOutputTokensAgent: 120,
  /** Spoken reply length */
  avgSpeakChars: 280,
  /** Tour step narration */
  avgTourStepChars: 220,
  avgTourSteps: 4,
} as const;

function chatCost(
  inputTok: number,
  outputTok: number,
  tier: "fast" | "flagship" = "fast"
) {
  const p =
    tier === "fast" ? CARINA_COST.chatFast : CARINA_COST.chatFlagship;
  return (inputTok / 1e6) * p.inputPer1M + (outputTok / 1e6) * p.outputPer1M;
}

function ttsCost(chars: number) {
  return (chars / 1e6) * CARINA_COST.ttsPer1MChars;
}

export type CostScenario = {
  name: string;
  perEventUsd: number;
  notes: string;
};

/** Unit economics for one user event */
export function carinaUnitEconomics(tier: "fast" | "flagship" = "fast"): {
  scenarios: CostScenario[];
  monthly: {
    lightUser: number;
    powerUser: number;
    shopFloorTeam10: number;
  };
  assumptions: string[];
} {
  const u = CARINA_USAGE_PROFILE;

  const talkOnly =
    chatCost(u.avgInputTokensTalk, u.avgOutputTokensTalk, tier) +
    ttsCost(u.avgSpeakChars);

  const inventGuide =
    chatCost(u.avgInputTokensInvent, u.avgOutputTokensInvent, tier) +
    ttsCost(u.avgSpeakChars) +
    // tour narrates each step via TTS
    ttsCost(u.avgTourStepChars * u.avgTourSteps);

  const agentFinishWo =
    chatCost(u.avgInputTokensAgent, u.avgOutputTokensAgent, tier) +
    ttsCost(120) + // confirm
    chatCost(800, 80, tier) +
    ttsCost(100); // done

  const scenarios: CostScenario[] = [
    {
      name: "Voice Q&A (no tour)",
      perEventUsd: talkOnly,
      notes: "1 chat completion + 1 short TTS reply. Browser STT free.",
    },
    {
      name: "Show-me invent walkthrough",
      perEventUsd: inventGuide,
      notes: "1 chat + intro TTS + ~4 tour step TTS. Dominated by TTS chars.",
    },
    {
      name: "Agent: finish work order (Business+)",
      perEventUsd: agentFinishWo,
      notes: "2 short chats + 2 TTS; DB work is free on your infra.",
    },
  ];

  // Monthly rollups (illustrative)
  // Light: 20 Q&A + 4 tours / month
  const lightUser = 20 * talkOnly + 4 * inventGuide;
  // Power: 80 Q&A + 20 tours + 15 agent actions
  const powerUser = 80 * talkOnly + 20 * inventGuide + 15 * agentFinishWo;
  // 10 floor users, mixed
  const shopFloorTeam10 =
    10 * (40 * talkOnly + 8 * inventGuide + 5 * agentFinishWo);

  return {
    scenarios,
    monthly: { lightUser, powerUser, shopFloorTeam10 },
    assumptions: [
      `Chat tier: ${tier} (${tier === "fast" ? CARINA_COST.chatFast.modelHint : CARINA_COST.chatFlagship.modelHint})`,
      `TTS: $${CARINA_COST.ttsPer1MChars}/1M characters`,
      "STT: browser Web Speech = $0 (Chrome). xAI streaming STT would add ~$0.20/hr mic-open.",
      "Plant snapshot + catalog inflate input tokens — caching system prompt later cuts cost ~30–50%.",
      "Tour TTS is the main cost driver for walkthroughs; shortening step copy helps more than shrinking chat.",
      "Agent actions add little $ vs talk; margin risk is abuse volume, not per-action price.",
      "Business plan ($18k/yr list) easily covers tens of thousands of voice turns if you use fast models.",
    ],
  };
}

/** Format a tiny report for logs or admin UI */
export function formatCarinaCostReport(tier: "fast" | "flagship" = "fast"): string {
  const e = carinaUnitEconomics(tier);
  const lines = [
    `Carina cost model (${tier})`,
    ...e.scenarios.map(
      (s) => `  • ${s.name}: ~$${s.perEventUsd.toFixed(4)}/event — ${s.notes}`
    ),
    `  Monthly light user: ~$${e.monthly.lightUser.toFixed(2)}`,
    `  Monthly power user: ~$${e.monthly.powerUser.toFixed(2)}`,
    `  Monthly 10-person floor mix: ~$${e.monthly.shopFloorTeam10.toFixed(2)}`,
    ...e.assumptions.map((a) => `  – ${a}`),
  ];
  return lines.join("\n");
}
