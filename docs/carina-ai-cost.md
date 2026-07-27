# Carina AI — cost impact (talk, guide, agent)

**Local planning doc.** Prices are approximate public xAI list rates (2026). Re-check [x.ai API pricing](https://x.ai/api) before budgeting.

## What burns money

| Capability | Who pays (xAI) | Rough size | Dominant cost |
|------------|----------------|------------|---------------|
| **Talk Q&A** | Chat tokens + TTS chars | ~3k in / 0.2k out + ~300 chars speak | Chat (if flagship) or balanced |
| **Show-me walkthrough** | Chat + intro TTS + **per-step TTS** | 4 steps × ~220 chars | **TTS** |
| **Invent guide (catalog)** | Same as walkthrough | Slightly larger system prompt (catalog) | TTS + prompt size |
| **Agent action** (finish WO) | 1–2 short chats + short TTS | Small | Cheap vs talk |
| **Mic listen** | $0 today (Chrome Web Speech) | Always-on | $0; only if you switch to cloud STT |

Browser STT + your Postgres are not xAI costs.

## Unit economics (fast chat tier ≈ $0.20/$0.50 per 1M tokens, TTS $15/1M chars)

| Event | ~USD each |
|-------|-----------|
| Voice Q&A | **$0.005 – $0.01** |
| Invent / tour walkthrough (4 steps) | **$0.02 – $0.04** |
| Finish work order (agent) | **$0.005 – $0.015** |

Flagship chat (~$2/$6 per 1M) multiplies **chat** portion ~10×; TTS unchanged. Prefer **fast** models for Carina voice.

## Monthly sketches (fast tier)

| Persona | Mix | ~USD / month |
|---------|-----|--------------|
| Light office user | 20 Q&A + 4 tours | **$0.20 – $0.40** |
| Power user | 80 Q&A + 20 tours + 15 agent | **$1 – $2** |
| 10 floor users mixed | 40 Q&A + 8 tours + 5 agent each | **$8 – $20** |

Even a busy plant is usually **tens of dollars/month** in API cost on fast models — noise next to list prices (Shop $30/user/mo · Starter $3.6k / Growth $8.4k / Business $18k).

## Pricing philosophy

**Do not meter paying ERP seats for Carina.** Bake expected AI COGS into the annual plan.

| Sketch (fast model) | AI COGS / year (rough) | vs plan list |
|---------------------|------------------------|--------------|
| 10 light users | ~$25–50 | Rounding error |
| 30 power-ish users | ~$200–400 | Still small vs Starter+ |
| Heavy plant (50 users, lots of voice) | ~$500–1.5k | Still fits Growth/Business |

Optional headroom: price AI into all tiers (included) or add a small “Voice AI included” line in sales materials so buyers expect it — not a usage bill.

**Rate limits only on free surfaces** (landing, marketing, bare demo splash) so guests can’t drain the key. Logged-in APP/TENANT = unlimited.

## What actually moves the bill

1. **TTS character volume** — long tour scripts, long answers. Keep 2–4 sentences; tour step body short.
2. **System prompt bloat** — plant snapshot + full catalog every turn. Mitigations: trim snapshot, send catalog ids only, cache/reuse prefix if xAI supports it.
3. **Flagship model by mistake** — force `grok-4-fast` / `grok-4-1-fast` class for Carina.
4. **Always-on mic** — free with browser STT; **not free** if you move to cloud STT ($0.10–0.20/hr).
5. **Agent actions** — Business+ packaging gate; cost is tiny vs talk/TTS.

## Product packaging recommendation

| Feature | Starter / Growth | Business / Enterprise |
|---------|------------------|------------------------|
| Voice talk + ERP scope | ✅ included | ✅ included |
| Canned + catalog invent guides | ✅ included | ✅ included |
| **Agent actions** (finish WO, etc.) | ❌ | ✅ |
| Usage caps for paid seats | ❌ none | ❌ none |

Agent actions are a **packaging** lever, not a cost lever. Cost of agent ≈ one more short voice turn.

## Local cost dump

```ts
import { formatCarinaCostReport } from "@/lib/services/carina-cost";
console.log(formatCarinaCostReport("fast"));
```

Or in Node after `npx tsx`:

```bash
npx tsx -e "const { formatCarinaCostReport } = require('./src/lib/services/carina-cost'); console.log(formatCarinaCostReport('fast'));"
```

## Engineering controls (recommended)

- Cap spoken text (already ~1800 chars TTS).
- Cap tour steps to 5.
- Cap conversation history to last 8 turns (already).
- Log `usage: { inputTokens, outputTokens, ttsChars, feature }` when xAI returns usage (future).
- `CARINA_AGENT_ACTIONS=1` local override for testing Business features without changing plan.

## Bottom line

Carina **talk + guide** is cheap if you stay on **fast chat + short TTS**.  
**Walkthroughs** cost more than Q&A because of multi-step speech, still cents.  
**Agent complete WO** is not a cost problem — it's a **trust / plan / audit** problem (hence Business-only).  
**Paying customers should never hit an AI meter** — include expected COGS in the annual ERP price; only throttle free demo/landing traffic.
