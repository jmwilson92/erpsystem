/** Carina's customer-help surface is deliberately read-only on every plan.
 * Historical mutation handlers remain in-repo for separate security review, but
 * neither client flags, a plan lookup failure nor an env override may enable them. */
export const CARINA_AGENT_PLANS = new Set<string>();
export type CarinaFeatures = {
  plan:string;talkAndGuide:boolean;inventGuide:boolean;agentActions:boolean;agentBlockedReason?:string;
};
export async function getCarinaFeatures():Promise<CarinaFeatures> {
  return {plan:'READ_ONLY',talkAndGuide:true,inventGuide:false,agentActions:false,
    agentBlockedReason:"Carina is read-only product help. Use the normal screen, permissions and approvals to change ERP records."};
}
