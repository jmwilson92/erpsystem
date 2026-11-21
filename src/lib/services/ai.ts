/** Existing Carina chat/voice entry points: reasoning-led lookups and confirm-gated actions, plus fallback help. */
import { answerHelp } from '../ai-help/answer';
import type { HelpCitation } from '../ai-help/knowledge';
import { getTour, matchTourFromQuery, type TourStep } from '../guides';
export type AiMessage = {role:'user'|'assistant'|'system';content:string};
export type AiGuideAction = {tourId?:string;steps?:TourStep[];stepByStep?:boolean};
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
export async function processAiConversation(messages:{role:'user'|'assistant';content:string}[],opts?:{pendingAction?:AiPendingAction|null;language?:string|null;page?:string|null;userId?:string|null;onDelta?:(text:string)=>void;voice?:boolean;skipCarinaTasks?:boolean}):Promise<AiConversationOutput> {
  const {resolveLang,detectLanguageSwitch,DEFAULT_LANG}=await import('../carina-language');
  const questions=messages.filter(m=>m.role==='user');
  const last=questions.at(-1)?.content.trim() || '';
  const lang=detectLanguageSwitch(last) || resolveLang(opts?.language || DEFAULT_LANG.code);
  if(!last) return {text:'Please ask a Protessera question.',language:lang.code,source:'local'};
  let voiceActions=false;
  let awayPrefix="";
  const wrapAway = <T extends { text: string; source?: "grok" | "local" }>(out: T): T => {
    if (!awayPrefix) return out;
    return { ...out, text: `${awayPrefix}${out.text}`.trim() };
  };
  const { helpMetaReply } = await import('../ai-help/meta');
  const meta = helpMetaReply(last);
  if (meta) {
    opts?.onDelta?.(meta);
    return { text: meta, source: 'local' as const, language: lang.code, pendingAction: opts?.pendingAction ?? null };
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
    if (!opts?.skipCarinaTasks) {
      const { consumeAwaySummary, looksLikeAddToList, looksLikeAwaySummaryAsk, addCarinaTask, prismaCarinaTaskDeps } = await import('./carina-tasks');
      const deps = await prismaCarinaTaskDeps();
      if (looksLikeAwaySummaryAsk(last)) {
        const summary = await consumeAwaySummary(deps, opts.userId);
        const list = await deps.tasks.listForUser(opts.userId);
        const open = list.filter((t) => !["done", "cancelled"].includes(t.status));
        const text = summary.text || "I don’t have any new finishes to report.";
        const extra = open.length ? ` I still have ${open.length} on my list.` : "";
        const reply = `${text}${extra}`;
        opts?.onDelta?.(reply);
        return { text: reply, source: "local" as const, language: lang.code };
      }
      if (looksLikeAddToList(last)) {
        const out = await addCarinaTask(deps, { userId: opts.userId, text: last });
        const text = out.text;
        opts?.onDelta?.(text);
        return { text, source: "local" as const, language: lang.code, href: out.href, pendingAction: null };
      }
      const summary = await consumeAwaySummary(deps, opts.userId);
      awayPrefix = summary.text ? `${summary.text} ` : "";
    }
    const {
      answerFloorStatus,
      isFloorPending,
      isFloorPrOfferAccept,
      loadFloorSnapshot,
      isFloorDetailUtterance,
      looksLikeFloorStatus,
    } = await import('./carina-floor');
    if (isFloorPending(opts.pendingAction) && isFloorPrOfferAccept(last)) {
      const pn = String(opts.pendingAction?.partial?.offerPartNumber || "").trim();
      if (pn) {
        if (voiceActions) {
          const offered = await handleCarinaVoiceTurn({
            question: `draft a purchase request for ${pn}`,
            pendingAction: null,
            userId: opts.userId,
          });
          if (offered) {
            const wrapped = wrapAway({ ...offered, language: lang.code, text: offered.text });
            if (wrapped.text) opts?.onDelta?.(wrapped.text);
            return wrapped;
          }
        }
        if (!opts?.skipCarinaTasks) {
          const { addCarinaTask, prismaCarinaTaskDeps } = await import('./carina-tasks');
          const taskDeps = await prismaCarinaTaskDeps();
          const out = await addCarinaTask(taskDeps, { userId: opts.userId, text: `draft a purchase request for ${pn}` });
          opts?.onDelta?.(out.text);
          return wrapAway({ text: out.text, source: "local" as const, language: lang.code, href: out.href, pendingAction: null });
        }
      }
    }
    if (looksLikeFloorStatus(last) || isFloorPending(opts.pendingAction) || isFloorDetailUtterance(last)) {
      const floor = await answerFloorStatus({
        question: last,
        pending: opts.pendingAction,
        loadSnapshot: () => loadFloorSnapshot(),
      });
      if (floor) {
        if (floor.text) opts?.onDelta?.(floor.text);
        return wrapAway({
          text: floor.text,
          source: "local" as const,
          language: lang.code,
          href: floor.href,
          pendingAction: floor.pendingAction,
        });
      }
    }
    const {
      diagnoseError,
      errorPendingAction,
      extractCorrelationId,
      fileBugReport,
      getErrorByCorrelation,
      isErrorFixAccept,
      isErrorPending,
      latestErrorForUser,
      looksLikeWhyDidThatFail,
      markErrorResolution,
    } = await import('./carina-errors');
    if (isErrorPending(opts.pendingAction) && isErrorFixAccept(last)) {
      const cid = String(opts.pendingAction?.partial?.correlationId || "");
      const planKind = String(opts.pendingAction?.partial?.planKind || "");
      const actionText = String(opts.pendingAction?.partial?.actionText || "");
      const href = String(opts.pendingAction?.partial?.href || "") || undefined;
      if (planKind === "report-bug" && cid) {
        const ev = await getErrorByCorrelation(cid);
        if (ev) {
          const filed = await fileBugReport({ event: ev, steps: ev.actionAttempted || ev.route || undefined });
          const text = `I’ve reported this to an administrator (ref ${cid}).${filed.notified ? " They’ll see it in the error log." : ""} ${ev.route ? "You can try the same step again in a moment." : ""}`.trim();
          opts?.onDelta?.(text);
          return wrapAway({ text, source: "local" as const, language: lang.code, pendingAction: null });
        }
      }
      if ((planKind === "propose-pr" || planKind === "propose-edit") && actionText) {
        if (voiceActions) {
          const offered = await handleCarinaVoiceTurn({ question: actionText, pendingAction: null, userId: opts.userId });
          if (offered) {
            if (cid) await markErrorResolution({ correlationId: cid, resolution: "FIXED", resolvedBy: "carina" });
            const wrapped = wrapAway({ ...offered, language: lang.code, text: offered.text });
            if (wrapped.text) opts?.onDelta?.(wrapped.text);
            return wrapped;
          }
        }
        if (!opts?.skipCarinaTasks) {
          const { addCarinaTask, prismaCarinaTaskDeps } = await import('./carina-tasks');
          const taskDeps = await prismaCarinaTaskDeps();
          const out = await addCarinaTask(taskDeps, { userId: opts.userId, text: actionText });
          if (cid) await markErrorResolution({ correlationId: cid, resolution: out.task ? "FIXED" : "DIAGNOSED", resolvedBy: "carina" });
          opts?.onDelta?.(out.text);
          return wrapAway({ text: out.text, source: "local" as const, language: lang.code, href: out.href || href, pendingAction: null });
        }
      }
    }
    if (looksLikeWhyDidThatFail(last) || isErrorPending(opts.pendingAction)) {
      const cid = extractCorrelationId(last) || String(opts.pendingAction?.partial?.correlationId || "");
      const ev = cid ? await getErrorByCorrelation(cid) : await latestErrorForUser(opts.userId);
      if (!ev && looksLikeWhyDidThatFail(last)) {
        const text = "I don’t have a recent error in this session. If something just failed, try the action again or click Ask Carina on the error toast.";
        opts?.onDelta?.(text);
        return wrapAway({ text, source: "local" as const, language: lang.code, pendingAction: opts.pendingAction ?? null });
      }
      if (ev) {
        const diagnosis = diagnoseError({ event: ev });
        if (diagnosis.plan.kind !== "report-bug") {
          await markErrorResolution({ correlationId: ev.correlationId, resolution: "DIAGNOSED", resolvedBy: "carina" });
        }
        opts?.onDelta?.(diagnosis.spoken);
        return wrapAway({
          text: diagnosis.spoken,
          source: "local" as const,
          language: lang.code,
          href: diagnosis.plan.href,
          pendingAction: errorPendingAction(ev.correlationId, diagnosis.plan),
        });
      }
    }
    const { advanceHowto, isHowtoOfferAccept, isHowtoPending, startHowto } = await import('../ai-help/howto');
    const { looksLikeHowto, looksLikeNavigate } = await import('../ai-help/nav-registry');
    const { looksLikeRecordNav, resolveNavigation } = await import('../ai-help/navigate');
    if (isHowtoPending(opts.pendingAction)) {
      const advanced = advanceHowto(opts.pendingAction, last);
      if (advanced) {
        if (advanced.text) opts?.onDelta?.(advanced.text);
        return wrapAway({
          text: advanced.text,
          source: 'local' as const,
          language: lang.code,
          href: advanced.href,
          guide: advanced.guide,
          pendingAction: advanced.pendingAction ?? null,
        });
      }
      const offerKind = String(opts.pendingAction?.partial?.offerKind || "");
      if (isHowtoOfferAccept(last) && offerKind) {
        const offerQuestion =
          offerKind === "CREATE_PURCHASE_REQUEST"
            ? "create a purchase request"
            : offerKind === "PLAN_DEMAND"
              ? "plan this demand"
              : offerKind === "CYCLE_COUNT"
                ? "post a cycle count"
                : last;
        const offered = await handleCarinaVoiceTurn({
          question: offerQuestion,
          pendingAction: null,
          userId: opts.userId,
        });
        if (offered) {
          const wrapped = wrapAway({ ...offered, language: lang.code, text: offered.text });
          if (wrapped.text) opts?.onDelta?.(wrapped.text);
          return wrapped;
        }
      }
    }
    if (looksLikeHowto(last)) {
      const started = startHowto(last, { voice: !!opts?.voice });
      if (started) {
        if (started.text) opts?.onDelta?.(started.text);
        return wrapAway({
          text: started.text,
          source: 'local' as const,
          language: lang.code,
          href: started.href,
          guide: started.guide,
          pendingAction: started.pendingAction ?? null,
        });
      }
    }
    if (looksLikeNavigate(last) || looksLikeRecordNav(last)) {
      const { createPrismaLookupStore } = await import('../ai-help/lookup');
      const { userCanView, userHasPermission } = await import('../auth');
      const nav = await resolveNavigation(last, {
        userId: opts.userId,
        store: createPrismaLookupStore(),
        canView: userCanView,
        hasPermission: (id, perm) => userHasPermission(id, perm),
      });
      if (nav.text) opts?.onDelta?.(nav.text);
      return wrapAway({
        text: nav.text,
        source: 'local' as const,
        language: lang.code,
        href: nav.ok ? nav.href : undefined,
        guide: nav.highlight
          ? { stepByStep: true, steps: [{ selector: nav.highlight.selector, route: nav.href, title: nav.highlight.label || '', body: nav.text }] }
          : undefined,
        pendingAction: nav.pendingAction ?? opts.pendingAction ?? null,
      });
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
          return wrapAway({
            text: reasoned.text,
            source: reasoned.source,
            citations: reasoned.citations,
            pendingAction: reasoned.pendingAction ?? opts.pendingAction ?? null,
            language: lang.code,
            href: reasoned.href,
            guide: reasoned.guide,
          });
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
      const wrapped = wrapAway({ ...acted, language: lang.code, text: acted.text });
      if (wrapped.text) opts?.onDelta?.(wrapped.text);
      return wrapped;
    }
    if (voiceActions) {
      const fallback = unparsedActionReply(last);
      if (fallback) {
        opts?.onDelta?.(fallback);
        return wrapAway({ text: fallback, source: 'local' as const, language: lang.code, pendingAction: opts.pendingAction ?? null });
      }
    }
  }
  const out=await answerHelp(last,{page:opts?.page,language:lang.name,previousQuestion:questions.at(-2)?.content,onDelta:opts?.onDelta,userId:opts?.userId,voiceActions,voice:!!opts?.voice});
  const tid=/\b(show me|walk me|tour|guide me)\b/i.test(last)?matchTourFromQuery(last):null;
  // Keep an outstanding confirm-gated draft if this turn was only a help/meta reply.
  return wrapAway({...out,language:lang.code,pendingAction:opts?.pendingAction ?? null,guide:out.citations.length && tid && getTour(tid)?{tourId:tid}:undefined});
}
