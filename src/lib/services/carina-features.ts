/**
 * Plan gates for Carina capabilities.
 *
 * Currently: agent actions ON for everyone (testing).
 * To lock to Business+ later, set CARINA_AGENT_ACTIONS=business
 * or restore plan check below.
 *
 * CARINA_AGENT_ACTIONS=0  → force off
 * CARINA_AGENT_ACTIONS=1 or unset → on for all
 * CARINA_AGENT_ACTIONS=business → Business + Enterprise only
 */

import { getSubscriptionState } from "@/lib/services/subscription";

export const CARINA_AGENT_PLANS = new Set(["BUSINESS", "ENTERPRISE"]);

export type CarinaFeatures = {
  plan: string;
  /** Text + voice Q&A, ERP scope, canned tours */
  talkAndGuide: boolean;
  /** Catalog invent walkthroughs */
  inventGuide: boolean;
  /** Execute ERP mutations ("finish WO-…") */
  agentActions: boolean;
  agentBlockedReason?: string;
};

export async function getCarinaFeatures(): Promise<CarinaFeatures> {
  const mode = (process.env.CARINA_AGENT_ACTIONS || "1").trim().toLowerCase();

  if (mode === "0" || mode === "false" || mode === "off") {
    return {
      plan: "DISABLED",
      talkAndGuide: true,
      inventGuide: true,
      agentActions: false,
      agentBlockedReason:
        "Hands-free agent actions are temporarily disabled. I can still walk you through the screens.",
    };
  }

  try {
    const sub = await getSubscriptionState();
    const plan = (sub.plan || "STARTER").toUpperCase();

    // Default: everyone (testing). Optional Business-only gate.
    const agentActions =
      mode === "business" || mode === "business-only"
        ? CARINA_AGENT_PLANS.has(plan)
        : true;

    return {
      plan,
      talkAndGuide: true,
      inventGuide: true,
      agentActions,
      agentBlockedReason: agentActions
        ? undefined
        : "Hands-free actions (finish a work order, etc.) are on the Business plan and above. I can still walk you through the screens step by step.",
    };
  } catch {
    // Still allow agents while testing if plan lookup fails
    return {
      plan: "UNKNOWN",
      talkAndGuide: true,
      inventGuide: true,
      agentActions: mode !== "business" && mode !== "business-only",
      agentBlockedReason:
        mode === "business" || mode === "business-only"
          ? "Could not read plan — hands-free actions disabled. Guides still work."
          : undefined,
    };
  }
}
