# Existing Carina assistant — audit and hardening

## What existed

Carina already lived in the ERP Help bubble (`SupportBubble`) and site-wide voice
engine (`VoiceAssistant`); `/ai` was its wake-name/language/diagnostics page.
Text used xAI's OpenAI-compatible chat API, voice used `voice_id: carina` on the
xAI TTS API, and guides used a reviewed tour/anchor catalog. It was not missing.
`XAI_API_KEY` and `XAI_MODEL` were present by name in Vercel preview and production.
Only names/target metadata were inspected; no key values were retrieved or printed.

Audit gaps: no product-document retrieval or citations, stale mandatory-prototype
fallback copy, broad live HR/plant context without module-specific permission checks,
mutation handlers enabled for all plans by a testing default, client-selected source
could bypass rate limits, legacy chat/probe paths lacked the same boundary,
unbounded retries/latency/output, a public unbudgeted TTS path that exposed key prefixes
and upstream errors, and no answer-feedback audit or customer-facing uncertainty notice.

## Shipping behavior

This extends the existing bubble/voice engine; it does not add a second assistant.
Carina is **read-only product help on every plan**, with no live tenant-record lookup,
no model tools, no mutation dispatch, and no auto-ticket. Historical action code is
retained but hard-disabled by capability policy and disconnected from conversation.
The existing Support tab remains a separate, user-submitted human channel.

- Reviewed `workflows.json` plus actual navigation, tours, plan catalog and route
  inventory build a tenant-free index. `/help/[slug]` renders exact cited guidance.
  Private tenant Docs, user uploads and database rows are not retrieval sources.
- `npm run help:build` rebuilds the index; `prebuild` runs it automatically. Source
  file references are checked, and navigation/pricing stay connected to code.
- Retrieve at most four short entries; pass the static route pattern, never record
  IDs/query strings. Only recent user questions are conversational context; client
  assistant messages never become product evidence.
- Require structured answer/source IDs. Validate IDs server-side; reject unsupported
  answers, malformed responses, HTML and arbitrary external links. Abstain to human
  support when evidence is missing. Canned tours stay allowlisted.
- Session identity is verified using the real session service: an invalid cookie
  cannot fall through to the legacy DEMO_MODE admin fallback. Demo source derives
  from the server request, never a client `source` or `guestKey` claim.
- Existing tenant `AuditLog` stores ASK budgets, redacted question/answer, sources,
  page pattern and owned feedback. No schema changes or production migration.
  Workspace administrators can inspect `entityType = CarinaHelp`; ANSWER metadata
  contains the review material and `changes.helpful` contains the current rating.
  These logs are not copied into a central support tenant. Use the workspace's
  normal audit-access and retention procedures.
- PostgreSQL per-schema/principal advisory transaction locks make budgets durable
  across serverless workers. SQLite uses serializable transactions. Fail closed.
  Real users: 12 chat turns/minute, 100/day; demo workspace total: 4/minute, 20/day.
  TTS has separate 30/minute, 200/day real-user and 8/minute, 50/day demo budgets.
- Per-tenant **and per-user** bounded two-minute answer memo; no cross-customer cache.
  Chat output capped at 700 tokens (1000 hard maximum), four snippets, one upstream
  attempt, 25-second deadline. No retry cascade on auth, quota, model or network errors.
  TTS is one official-shape xAI request, capped text and 15-second deadline; no key
  prefix, payload, provider body or raw error is returned/logged.

## Model and disclosure

Current official docs recommend `grok-4.7` for chat; that is the default, with
`reasoning_effort: low` for short low-cost support responses. Existing `XAI_MODEL`
overrides remain respected and were not changed in Vercel. Model-specific low
reasoning is only sent for the documented `grok-4.7` identifier.

Carina is the existing product persona and an official xAI **voice ID**, not a
separate text model or model alias. Voice remains optional and keeps its existing
wake-name/language/settings flow.

Customers see "AI · powered by Grok", "AI can make mistakes", read-only limits,
xAI processing/privacy and logging guidance, source links, thumbs feedback and a
Human support button in the existing bubble. `/ai` and the existing marketing AI
section disclose the same limits; outdated live-data/mutation claims are removed.
Do not paste PINs, credentials, personal or export-controlled data into AI help.
Common-secret redaction is defense in depth, not a data-classification guarantee.

Sources checked:
- https://docs.x.ai/developers/models
- https://docs.x.ai/developers/models/grok-4.7
- https://docs.x.ai/developers/model-capabilities/audio/voice

## Verification and known limits

`eval.json` has 50 synthetic customer questions, explicit expected answers and source/
regex rubrics. `npm run eval:ai-help` tests retrieval without an API call.
`npm run eval:ai-help -- --live` runs the opt-in provider eval using only an already
securely injected `XAI_API_KEY`; it never loads dotenv or prints credentials.

Initial low-reasoning run: **45/50 automated checks**. Human review found three
rubric false negatives (a negated forbidden phrase and two equivalent navigation/
tour citations), one overbroad live-payroll classifier, and missing explicit Docs
restore guidance. The classifier and Docs evidence were fixed. After clarifying
those three rubrics and live-retesting the two real gaps: **50/50** checks.
`eval-initial-results.json` preserves the initial result and all answers; the final
`eval-live-results.json` records the two retests. All 50 final answers were reviewed.
The initial high-reasoning pilot was stopped after latency/empty-answer issues;
low reasoning fixed those observed transport symptoms.

This is a finite regression rubric, **not a guarantee of flawless or universally
correct answers**. Unsupported questions must keep abstaining. Human support remains
the safety net. Continue reviewing negative feedback and expanding the fixture set.
General non-English queries can have lower lexical recall; language preference is
preserved, but multilingual retrieval is not claimed as fully validated.

Commands:

```sh
npm run help:build
npm run test:ai-help        # retrieval, parsing, safety, mocked failures + isolated DB
npm run smoke               # existing smoke plus the AI suite, so CI executes it
npm run typecheck
npm run lint
npm run build
npx tsx scripts/test-ai-help-browser.ts # isolated Postgres + own local server :3093
```

Tests use synthetic records in isolated in-memory Postgres, never production data.
The browser smoke disables provider keys, checks disclosure, authenticated chat,
owned feedback, citations article, invalid-session TTS and no ERP mutations. Live
answer quality is covered separately by the explicit 50-question provider evaluation.
