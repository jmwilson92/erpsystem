/** Carina capabilities for this tenant. Mutation actions stay off until an admin opts in. */
import { prisma } from "@/lib/db";

export type CarinaFeatures = {
  plan: string;
  talkAndGuide: boolean;
  inventGuide: boolean;
  /** Legacy flag — kept false so old mutation handlers cannot be re-enabled by env. */
  agentActions: boolean;
  /** Admin opt-in for confirm-gated voice / chat record changes. */
  voiceActions: boolean;
  agentBlockedReason?: string;
};

export async function getCarinaFeatures(): Promise<CarinaFeatures> {
  let voiceActions = false;
  try {
    const row = await prisma.companySettings.findUnique({
      where: { id: "default" },
      select: { carinaVoiceActions: true },
    });
    voiceActions = !!row?.carinaVoiceActions;
  } catch (e) {
    // Same CompanySettings id "default" as Admin → Settings. If this throws
    // (missing column, tenant mismatch), fail closed and log — do not invent "on".
    console.warn("[carina-features] could not read CompanySettings.carinaVoiceActions", e instanceof Error ? e.message : "error");
    voiceActions = false;
  }
  return {
    plan: voiceActions ? "VOICE_ACTIONS" : "READ_ONLY",
    talkAndGuide: true,
    inventGuide: false,
    agentActions: false,
    voiceActions,
    agentBlockedReason: voiceActions
      ? undefined
      : "Carina voice actions are off for this workspace. An administrator can enable them in Admin → Settings. Record changes always require a confirm, and use your own permissions.",
  };
}
