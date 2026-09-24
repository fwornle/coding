# ModelContextLimits

**Type:** SubComponent

## What It Is

ModelContextLimits is implemented entirely in `lib/statusline/model-limits.cjs`, a functional (class-free) module whose job is to answer one question for the status-line renderer: how large is this model's context window, in tokens? It does this by translating opencode's raw models.dev catalogue (~4.5MB spanning 213 providers) into small, fast lookup structures, then layering a user-override and fallback-resolution scheme on top so that every model — public, custom, or self-hosted — resolves to a defensible number rather than a crash or a stale guess.

![ModelContextLimits — Architecture](images/model-context-limits-architecture.png)

## Architecture and Design

The module centers on a derived/materialized cache pattern: `deriveLimits()` boils the 4.5MB catalogue down once into two flat maps, `byPair` (exact `provider/model` lookups) and `byModel` (best-guess per model id), so the hot path never re-parses the source JSON. This derived cache is persisted to disk and invalidated on `(mtimeMs, size)` identity rather than a content hash — a deliberate trade-off, since hashing the source would cost more than the ~33ms parse it's meant to avoid.

Resolution follows a tiered precedence, implemented across `userConfigContextWindow()` and `catalogueContextWindow()`: a user's own `opencode.json` declaration always wins (it can encode facts the public catalogue structurally cannot, like a `qwen-laptop` model actually running at 32K locally despite a 262K public listing), followed by an exact catalogue hit, then a modal cross-provider fallback, with the status-line's own regex table as the final safety net. Where providers disagree, a majority-vote scheme picks the most-agreed value, breaking ties toward the larger window to avoid falsely triggering "about to compact" styling on weak evidence.

Every I/O boundary — file stat, read, JSON parse, cache write — is wrapped to fail soft, returning `null`/`false` instead of throwing, reflecting a "status line must never crash" constraint stated directly in the file's own comments. `null` is explicitly documented as a meaningful "no opinion" signal, distinct from a zero-size window.

## Implementation Details

`deriveLimits()` builds `byPair` and `byModel` from the raw catalogue. For `byModel`, resolution first walks `FALLBACK_PROVIDERS` in order (`github-copilot`, `anthropic`, `openai`, `<COMPANY_NAME_REDACTED>` — providers likely to actually serve a given id), and only falls back to the vote-counted modal value across all providers when no preferred provider has an opinion.

`catalogueContextWindow()` implements the three-tier precedence described above, calling `userConfigContextWindow()` (which reads `~/.config/opencode/opencode.json` via a module-level `_userMemo`, re-read fresh each process rather than cached with the derived catalogue) before falling through to catalogue data.

`limits()` handles the on-disk cache lifecycle: it memoizes in-process, negative-caches failure (`_memo = false`) so a missing catalogue file isn't repeatedly stat'd on every 5-second status-line tick, and writes the derived JSON via temp-file-then-rename so concurrent readers never see a half-written cache. Because the status line spawns a fresh process each tick, this disk persistence — not an in-memory memo — is what actually survives across invocations.

## Integration Points

ModelContextLimits sits under LLMAbstraction as a SubComponent, but addresses only the context-size half of catalogue correctness. The parent-level "LLM Model Catalogue — Endpoint-Gated Access Rules" work record establishes a related but distinct concern — tracking which API surface (Responses API vs `/chat/completions`) gates access to a model — which is explicitly not implemented here and lives elsewhere in the LLM abstraction layer. Sibling DMRProvider is called out as needing that same endpoint-gating correctness for its entries.

![ModelContextLimits — Relationship](images/model-context-limits-relationship.png)

Within the module's own boundary, it reads but never writes opencode's own `models.json` (a read-only dependency on another tool's cache) and treats a user's `opencode.json` as a higher-authority override source it also only reads. The consuming caller — the status-line occupancy gauge — depends on the `null` vs. zero distinction to know when to fall back to its own regex table instead of rendering a broken percentage.

## Usage Guidelines

The module's own rationale comment documents the failure mode it exists to prevent: a prior five-line regex table in `context-gauge.cjs` that mapped any `/^claude-/` model to a flat 200K window, correct for Claude 3/4 but wrong once github-copilot's claude-opus-5/claude-sonnet-5 routes reported 1,000,000-token windows — producing a real case where a 188,240-token, 19%-full session rendered as 94% bold-red "imminent compaction" purely from the stale ceiling, and made the gauge blind to model switches within a family.

Developers extending this module should preserve its "never break the caller" contract: any new failure path should return `null`/`false`, not throw, and callers must treat `null` as "no opinion" rather than zero. When resolving disagreement between data sources, prefer the safer (larger, non-alarming) value in ties, consistent with the existing modal fallback. Because cache invalidation relies on mtime+size rather than content hashing, any change to catalogue-writing behavior upstream must preserve real mtime updates or this module will silently serve stale derived data.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'LLM Model Catalogue — Endpoint-Gated Access Rules' work record establishes that the model catalogue must separately track WHICH API surface (Responses API vs /chat/completions) gates access to a given model, as a correctness constraint distinct from context-window sizing — preventing valid models from being erroneously stripped from the catalogue and invalid endpoint/model combinations from being silently permitted. model-limits.cjs addresses only the context-size half of 'catalogue correctness' (via deriveLimits()/catalogueContextWindow()); the endpoint-gating concern the record describes is not implemented in this file and appears to live in a separate part of the LLM abstraction layer.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] The 'LLM Model Catalogue — Endpoint-Gated Access Rules' record establishes that the model catalogue must track which API surface (Responses API vs /chat/completions) gates access to specific models, so valid models are not erroneously removed nor invalid endpoint combinations silently allowed

### Siblings
- [DMRProvider](./DMRProvider.md) -- [SESSION] LLM Model Catalogue — Endpoint-Gated Access Rules establishes that the catalogue must track which API surface (Responses API vs /chat/completions) gates access to specific models, so DMRProvider-style entries are not erroneously removed nor invalid endpoint combinations silently allowed.
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] LLM CLI Proxy — Provider Architecture and Restart Behavior notes proxy-bridge/server.mjs routes calls through a tiered provider fallback chain with network-mode-aware routing, which this client depends on as its transport layer.
- [LlmJsonRepair](./LlmJsonRepair.md) -- [SESSION] RapidLlmProxy — Universal Agent Routing, Worker Pool, Semantic Dispatch, and Health record ties this utility to rapid-llm-proxy's client-side glue that must stay in sync with proxy-side response changes.
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts implements priceForModel() with a three-tier resolution order — exact model key, then fast-mode suffix stripping via FAST_MODE_MULTIPLIER, then family fallback via modelFamily()/FAMILY_REPRESENTATIVE — and explicitly documents that a missing fast-mode twin would silently fall through to family pricing at the standard rate with priced:true and no warning, which is why the multiplier rule exists as a computed relationship rather than hand-maintained duplicate rows.
- [OffloadRouting](./OffloadRouting.md) -- [LLM] OffloadDecision (integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx) implements a dual-mode analysis surface — 'Configuration' mode counts routes to answer 'what will happen', 'Recorded' mode counts actual calls to answer 'what did' — sharing one gate ladder (GATES, RUNG_OFFLOADED from ./offload-gates) so switching modes diffs intent against behavior without a layout change. The component's own header comment states this is deliberately one component with a toggle rather than two separate cards, because the value is specifically in the ability to flip between the two without re-reading structure.
- [ClassifierJudge](./ClassifierJudge.md) -- [SESSION] LLM Mode Toggle — Poll/Explicit State Handling establishes that explicit operator-set flags must not be clobbered by background polling — the same operator-edit-vs-poll conflict this hook's dirty/draft state design addresses.


---

*Generated from 9 observations*
