/** Existing Carina chat/voice entry points: reasoning-led lookups and confirm-gated actions, plus fallback help. */
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
export async function processAiConversation(messages:{role:'user'|'assistant';content:string}[],opts?:{pendingAction?:AiPendingAction|null;language?:string|null;page?:string|null;userId?:string|null;onDelta?:(text:string)=>void;voice?:boolean}):Promise<AiConversationOutput> {
  const {resolveLang,detectLanguageSwitch,DEFAULT_LANG}=await import('../carina-language');
  const questions=messages.filter(m=>m.role==='user');
  const last=questions.at(-1)?.content.trim() || '';
  const lang=detectLanguageSwitch(last) || resolveLang(opts?.language || DEFAULT_LANG.code);
  if(!last) return {text:'Please ask a Protessera question.',language:lang.code,source:'local'};
  let voiceActions=false;
  const { helpMetaReply } = await import('../ai-help/meta');
  const meta = helpMetaReply(last);
  if (meta) {
    opts?.onDelta?.(meta);
    return { text: meta, source: 'local', language: lang.code, pendingAction: opts?.pendingAction ?? null };
  }
  if (opts?.userId) {
    const { handleCarinaVoiceTurn, unparsedActionReply, createReasonActionPort } = await import('./carina-voice-actions');
    const { getCarinaFeatures } = await import('./carina-features');
    const features = await getCarinaFeatures();
    voiceActions=!!features.voiceActions;
    const pending = await handleCarinaVoiceTurn({
      question: last,
      pendingAction: opts.pendingAction,
      userId: opts.userId,
      pendingOnly: true,
    });
    if (pending) {
      if (pending.text) opts?.onDelta?.(pending.text);
      return { ...pending, language: lang.code };
    }
    const { grokConfigured, grokChatWithTools } = await import('./grok');
    if (grokConfigured()) {
      try {
        const { runCarinaReasonTurn, REASON_TIMEOUT_MS } = await import('../ai-help/reason-loop');
        const { HELP_VOICE_MAX_TOKENS } = await import('../ai-help/voice-style');
        const { createPrismaLookupStore } = await import('../ai-help/lookup');
        const reasoned = await runCarinaReasonTurn({
          question: last,
          userId: opts.userId,
          voiceActions,
          language: lang.name,
          page: opts.page,
          voice: !!opts?.voice,
          store: createPrismaLookupStore(),
          actions: voiceActions ? createReasonActionPort(opts.userId) : undefined,
          chat: async ({ system, messages, tools }) =>
            grokChatWithTools({
              system,
              messages,
              tools,
              timeoutMs: REASON_TIMEOUT_MS,
              maxTokens: opts?.voice ? HELP_VOICE_MAX_TOKENS : 500,
            }),
          onDelta: opts?.onDelta,
        });
        if (reasoned?.text) {
          return {
            text: reasoned.text,
            source: reasoned.source,
            citations: reasoned.citations,
            pendingAction: reasoned.pendingAction ?? opts.pendingAction ?? null,
            language: lang.code,
          };
        }
      } catch {
        // Fall back to regex intents and grounded help if the model or tools fail.
      }
    }
    const acted = await handleCarinaVoiceTurn({
      question: last,
      pendingAction: opts.pendingAction,
      userId: opts.userId,
    });
    if (acted) {
      if (acted.text) opts?.onDelta?.(acted.text);
      return { ...acted, language: lang.code };
    }
    if (voiceActions) {
      const fallback = unparsedActionReply(last);
      if (fallback) {
        opts?.onDelta?.(fallback);
        return { text: fallback, source: 'local', language: lang.code, pendingAction: opts.pendingAction ?? null };
      }
    }
  }
  const out=await answerHelp(last,{page:opts?.page,language:lang.name,previousQuestion:questions.at(-2)?.content,onDelta:opts?.onDelta,userId:opts?.userId,voiceActions,voice:!!opts?.voice});
  const tid=/\b(show me|walk me|tour|guide me)\b/i.test(last)?matchTourFromQuery(last):null;
  // Keep an outstanding confirm-gated draft if this turn was only a help/meta reply.
  return {...out,language:lang.code,pendingAction:opts?.pendingAction ?? null,guide:out.citations.length && tid && getTour(tid)?{tourId:tid}:undefined};
}
