/** Existing Carina chat/voice entry points: grounded read-only help, plus permission-checked account counts. */
import { answerHelp } from '../ai-help/answer';
import type { HelpCitation } from '../ai-help/knowledge';
import { getTour, matchTourFromQuery, type TourStep } from '../guides';
export type AiMessage = {role:'user'|'assistant'|'system';content:string};
export type AiGuideAction = {tourId?:string;steps?:TourStep[]};
/** Kept for old clients; deliberately never executed or trusted by the help assistant. */
export type AiPendingAction = {
  action:string;
  partial:Record<string,string>;
  phase?:'clarify'|'confirm';
  draft?: import('./carina-voice-actions').CarinaActionDraft;
  idempotencyKey?:string;
  requiresPin?:boolean;
  voiceApproved?:boolean;
};
export type AiConversationOutput = {text:string;guide?:AiGuideAction;pendingAction?:AiPendingAction|null;language?:string;href?:string;citations?:HelpCitation[];source?:'grok'|'local'};
export async function processAiQuery(query:string):Promise<string> {
  // Legacy callers must use the same authenticated, budgeted server-action boundary.
  const { actionAiConversation }=await import('@/app/ai/actions');
  const out=await actionAiConversation([{role:'user',content:query}]);
  return out.ok?out.text:out.error;
}
export async function processAiConversation(messages:{role:'user'|'assistant';content:string}[],opts?:{pendingAction?:AiPendingAction|null;language?:string|null;page?:string|null;userId?:string|null;onDelta?:(text:string)=>void}):Promise<AiConversationOutput> {
  const {resolveLang,detectLanguageSwitch,DEFAULT_LANG}=await import('../carina-language');
  const questions=messages.filter(m=>m.role==='user');
  const last=questions.at(-1)?.content.trim() || '';
  const lang=detectLanguageSwitch(last) || resolveLang(opts?.language || DEFAULT_LANG.code);
  if(!last) return {text:'Please ask a Protessera question.',language:lang.code,source:'local'};
  let voiceActions=false;
  if (opts?.userId) {
    const { handleCarinaVoiceTurn, unparsedActionReply } = await import('./carina-voice-actions');
    const acted = await handleCarinaVoiceTurn({
      question: last,
      pendingAction: opts.pendingAction,
      userId: opts.userId,
    });
    if (acted) return { ...acted, language: lang.code };
    const { getCarinaFeatures } = await import('./carina-features');
    const features = await getCarinaFeatures();
    voiceActions=!!features.voiceActions;
    // Toggle is on, but this phrase is not one of the confirm-gated intents.
    // Do not fall through to the leftover "I'm read-only help" safety line.
    if (voiceActions) {
      const fallback = unparsedActionReply(last);
      if (fallback) return { text: fallback, source: 'local', language: lang.code, pendingAction: opts.pendingAction ?? null };
    }
  }
  const out=await answerHelp(last,{page:opts?.page,language:lang.name,previousQuestion:questions.at(-2)?.content,onDelta:opts?.onDelta,userId:opts?.userId,voiceActions});
  const tid=/\b(show me|walk me|tour|guide me)\b/i.test(last)?matchTourFromQuery(last):null;
  // Keep an outstanding confirm-gated draft if this turn was only a help/meta reply.
  return {...out,language:lang.code,pendingAction:opts?.pendingAction ?? null,guide:out.citations.length && tid && getTour(tid)?{tourId:tid}:undefined};
}
