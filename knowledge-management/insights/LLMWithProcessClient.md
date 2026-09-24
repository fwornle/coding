# LLMWithProcessClient

**Type:** SubComponent

## What It Is

The retrieved observations do not contain source for LLMWithProcessClient. According to the parent-entity description carried forward from context (observation 4), it is implemented in llm-with-process.ts as a function `llmWithProcessComplete()`, deliberately duplicating rather than extending the SDK's `LLMService.complete()` to carry a `process` telemetry tag, and resolving the proxy URL through a four-level environment-variable precedence (RAPID_LLM_PROXY_URL → LLM_CLI_PROXY_URL → LLM_PROXY_URL → localhost fallback via LLM_CLI_PROXY_PORT). None of this, however, is verified against actual source in this pass — the five files retrieved (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, model-limits.cjs) belong entirely to the system-health-dashboard and statusline subsystems and contain no import, call, or reference to llm-with-process.ts or LLMWithProcessClient (observation 5).

## Architecture and Design

Because no implementation files for this component were retrieved, no grounded architectural analysis can be produced. The apparent connection to sibling components like CostModel and OffloadRouting (observation 6) is circumstantial — both consume the same normalized token shape and proxy routing surface the parent description attributes to llmWithProcessComplete(), but this is explicitly flagged as unverified adjacency, not confirmed dependency.

## Implementation Details

Not available from these observations. The genuine implementation details (four-tier URL precedence, `tokens`-to-`{total, input, output}` normalization) exist only as forwarded context from the parent description (observation 4), not as material observed in the supplied files.

## Integration Points

The parent component, LLMAbstraction, is governed by the endpoint-gating rules from the 'LLM Model Catalogue' record, meaning any client under it — including this one — cannot assume a model is reachable simply because it appears in a catalogue without checking whether the Responses API or /chat/completions serves it. Diagnostic work on CLI/UKB timeouts (observation 2) is directly relevant context for this client since it sits atop the proxy's /api/complete endpoint, and that investigation already ruled out the proxy layer itself as a timeout source — pointing instead to provider-level fallback behavior in proxy-bridge/server.mjs (observation 1). Beyond these session-level ties, no code-level integration points were found in the retrieved files.

## Usage Guidelines

No verified guidance can be offered from these observations. Given the retrieval mismatch, any future documentation effort should specifically target llm-with-process.ts by exact path rather than keyword search, since thematic "LLM" filename matching pulled in unrelated dashboard and statusline modules (observations 7, 8) instead of this component's actual implementation.

INSUFFICIENT_EVIDENCE: The retrieved files (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, model-limits.cjs) belong to unrelated dashboard/statusline subsystems and none reference llm-with-process.ts or LLMWithProcessClient; only a forwarded, unverified parent-description fragment describes the actual component.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- LLM CLI Proxy — Provider Architecture and Restart Behavior notes proxy-bridge/server.mjs routes calls through a tiered provider fallback chain with network-mode-aware routing, which this client depends on as its transport layer.
- The 'CLI/UKB Run Timeout and Provider Error Diagnostics' work record establishes that reported ~15-second CLI timeouts against UKB runs required distinguishing rapid-llm-proxy-layer timeouts from provider-specific failures further down the fallback chain, and that log evidence ruled out rapid-llm-proxy itself as the timeout source — pointing investigation toward provider-level error handling instead. This is the diagnostic context for any client sitting directly on top of the proxy's /api/complete endpoint (as LLMWithProcessClient is described as doing), since a timeout observed at that call site cannot be assumed to originate in the wrapper or the proxy without first eliminating the provider layer.
- The 'LLM Model Catalogue — Endpoint-Gated Access Rules' work record establishes that the model catalogue consumed by the routing/provider-selection layer must track which API surface (Responses API vs /chat/completions) gates access to a given model, specifically to prevent two failure modes: valid models being erroneously stripped from the catalogue, and invalid endpoint/model combinations being silently permitted through provider selection. This constrains any client, including one resolving a proxy URL and model on behalf of a caller, from assuming a model is reachable purely because it appears in a catalogue without checking which endpoint family serves it.

## Diagrams

![LLMWithProcessClient — Architecture](images/llmwith-process-client-architecture.png)

![LLMWithProcessClient — Relationship](images/llmwith-process-client-relationship.png)


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] The 'LLM Model Catalogue — Endpoint-Gated Access Rules' record establishes that the model catalogue must track which API surface (Responses API vs /chat/completions) gates access to specific models, so valid models are not erroneously removed nor invalid endpoint combinations silently allowed

### Siblings
- [DMRProvider](./DMRProvider.md) -- [SESSION] LLM Model Catalogue — Endpoint-Gated Access Rules establishes that the catalogue must track which API surface (Responses API vs /chat/completions) gates access to specific models, so DMRProvider-style entries are not erroneously removed nor invalid endpoint combinations silently allowed.
- [LlmJsonRepair](./LlmJsonRepair.md) -- [SESSION] RapidLlmProxy — Universal Agent Routing, Worker Pool, Semantic Dispatch, and Health record ties this utility to rapid-llm-proxy's client-side glue that must stay in sync with proxy-side response changes.
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts implements priceForModel() with a three-tier resolution order — exact model key, then fast-mode suffix stripping via FAST_MODE_MULTIPLIER, then family fallback via modelFamily()/FAMILY_REPRESENTATIVE — and explicitly documents that a missing fast-mode twin would silently fall through to family pricing at the standard rate with priced:true and no warning, which is why the multiplier rule exists as a computed relationship rather than hand-maintained duplicate rows.
- [OffloadRouting](./OffloadRouting.md) -- [LLM] OffloadDecision (integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx) implements a dual-mode analysis surface — 'Configuration' mode counts routes to answer 'what will happen', 'Recorded' mode counts actual calls to answer 'what did' — sharing one gate ladder (GATES, RUNG_OFFLOADED from ./offload-gates) so switching modes diffs intent against behavior without a layout change. The component's own header comment states this is deliberately one component with a toggle rather than two separate cards, because the value is specifically in the ability to flip between the two without re-reading structure.
- [ClassifierJudge](./ClassifierJudge.md) -- [SESSION] LLM Mode Toggle — Poll/Explicit State Handling establishes that explicit operator-set flags must not be clobbered by background polling — the same operator-edit-vs-poll conflict this hook's dirty/draft state design addresses.
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] lib/statusline/model-limits.cjs:deriveLimits() is the core translation from opencode's raw models.dev catalogue (~4.5MB/213 providers) into two flat lookup maps: `byPair` (exact `provider/model` → context size) and `byModel` (a single best-guess size per model id, for when the caller's provider is a custom one like a user's `rapid-proxy` entry that doesn't appear in the public catalogue). The `byModel` resolution first tries FALLBACK_PROVIDERS in order (`github-copilot`, `anthropic`, `openai`, `<COMPANY_NAME_REDACTED>` — i.e. 'who actually serves these ids for us'), and only falls back further to a vote-counted modal value across all providers offering that id, with ties broken toward the LARGER window specifically to avoid under-reporting occupancy and false-triggering a red 'about to compact' state on insufficient evidence.


---

*Generated from 9 observations*
