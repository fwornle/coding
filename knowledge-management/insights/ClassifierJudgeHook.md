# ClassifierJudgeHook

**Type:** Detail

## What It Is

`ClassifierJudgeHook` is implemented as `useClassifierJudge`, a React hook defined at `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts:76`. It fetches `GET ${proxyBase}/api/llm/classifier` from rapid-llm-proxy, normalizes the response into a `Judge` shape (defaulting `strategy: 'llm'` and stubbing a `knn` block when absent), and returns both server-derived state (`judge`, `judgeError`, `judgeUrl`) and local draft-edit state (`draftRubric`, `draftStrategy`, per-backend `draftEnabled`). It is consumed directly by `OffloadDecision` in `offload-decision.tsx:159` as `const judge = useClassifierJudge(proxyBase)`.

## Architecture and Design

The hook sits as a peer to `useOffloadPolicyDraft`, each owning a distinct backing config/service rather than sharing a store: the judge's backends/rubric live in this repo's `config/prompt-classifier.yaml`, while offload policy lives in rapid-llm-proxy's `llm-routing.yaml`. The file's header comment explicitly justifies this split — a combined `save()` could let a rubric typo roll back an unrelated offload toggle. This is a deliberate isolation-of-failure-domains pattern, echoed in the Architectural Patterns note as "split save paths per backing file/service."

A second load-bearing decision is the strict separation of `enabled` (config, editable) from `reachable` (runtime fact, read-only) on `JudgeBackend`. The comment cites a concrete incident (2026-09-02) where the judge silently 502'd for a day while `enabled: true` looked fine everywhere, motivating the rule that "switched off" and "not answering" must never collapse into one boolean.

## Implementation Details

Draft/merge state follows an overlay pattern: `effectiveEnabled(b)` (line 118) returns `draftEnabled[b.id]` when present, else falls back to `b.enabled`; `dirty` is derived via `useMemo` diffing all three draft slots against `judge`; and the returned `merged` value overlays draft `enabled` onto live `backends` while explicitly leaving `reachable` untouched — described in-code as "what this whole hook exists to avoid getting wrong."

`save()` (line 131) builds `body.backends`/`body.rubric`/`body.strategy` conditionally, PATCHing only changed fields to avoid a poll-vs-edit race clobbering untouched fields. Polling (line 95) uses a plain `setInterval(load, pollMs)` (default 30s) rather than the dashboard's shared `usePolledFetch`, intentionally continuing while a draft is open so mid-edit judge outages remain visible. A `tick` state variable, bumped by `reload()`, force-restarts the polling effect after a successful save.

## Integration Points

The hook is a thin, defensively-merged view over rapid-llm-proxy, which is the source of truth; it performs no persistence beyond the PATCH call. It depends on the proxy exposing `judge`, `judgeError`, and `judgeUrl` diagnostics from one endpoint response shape. Within `OffloadDecision`, `CLASSIFIER_IMPLS` (line 66) hardcodes the three judge implementations (`none`, `local-llm`, `service`, renamed from `http` on 2026-08-31) mirroring the proxy's own switch statement — a UI-side mirror, not something the hook computes. As a child of parent `LLMWithProcessClient`, which routes all client calls through rapid-llm-proxy's `/api/complete`, this hook exposes the judge configuration governing that routing's classification tier. It's thematically related to sibling `OffloadDecisionResolver` (likely in an unretrieved `offload-gates.ts`), and the SESSION record on "LLM Routing Tier Priority" notes that `Judge.strategy` and rubric/backends are exactly the policy surface influencing tier banding — misconfiguration here is a plausible root-cause class for tier-ordering bugs, though this hook itself does not enforce tier order.

## Usage Guidelines

Developers should never merge `reachable` from drafts — only `enabled` should be overlaid, per the explicit in-code warning. Always construct PATCH bodies diff-based (only changed fields) to avoid clobbering concurrent poll updates. Keep judge and offload-policy editing in separate hooks/files, since they write different backing files on different schedules — do not fold them together despite living in the same UI. Polling must not be paused during edits; if extending this hook, preserve the `setInterval`-based approach and `tick`-triggered reload rather than swapping in `usePolledFetch`, since freezing during edits would hide exactly the failures this hook exists to surface.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'LLM Routing Tier Priority' work record documents a real ordering defect where requests were demoted to lower-tier providers (Groq) as the PRIMARY choice instead of last resort. `useClassifierJudge`'s `Judge.strategy` field (llm/knn/hybrid/shadow) and its rubric/backends are exactly the policy surface that determines banding, and thus indirectly which tier a request lands on — a judge misconfiguration (e.g. a disabled backend with no fallback) is a plausible root cause class for the kind of tier-ordering bug that record describes, even though this file only edits/displays the judge, it does not enforce tier order itself.

## Hierarchy Context

### Parent
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] RapidLlmProxy — Universal Agent Routing, Worker Pool, Semantic Dispatch establishes that rapid-llm-proxy is the mandatory shared routing proxy all clients must go through, which this wrapper directly targets via /api/complete.

### Siblings
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [LLM] The retrieved code files do not contain the alignment script itself — `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs` — which is the actual component this entity should represent. What was retrieved instead is `tests/features/copilot-model-ids.test.mjs`, a drift-guard test suite that asserts the script's *existence and properties* (that it exists, covers every retired id, never maps to another retired id, is wired into the Dockerfile after the last `npm install`, and is wired as a `postinstall` hook) without exposing the script's own implementation. Every claim in this analysis about the alignment mechanism is therefore inferred from the test's assertions and the parent observations, not read from the script.
- [CostModelPricingEngine](./CostModelPricingEngine.md) -- [LLM] No entity named `CostModelPricingEngine` appears anywhere in the supplied code. The nearest thematic match is `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, which exposes a set of standalone pure functions (`priceForModel`, `cellCostUsd`, `budgetForMonth`, `freshInputTokens`, `monthlySeries`) rather than a class or object called `CostModelPricingEngine`. There is no constructor, no stateful engine object, and no file whose name or exported symbol resembles the requested component — the retrieval appears to have surfaced the parent's general neighborhood (cost/pricing logic) rather than this specific entity.
- [OffloadDecisionResolver](./OffloadDecisionResolver.md) -- [LLM] No file in this bundle defines, exports, imports, or even mentions an identifier called `OffloadDecisionResolver`. The nearest thematic match is `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, which exports a React component `OffloadDecision` (not `OffloadDecisionResolver`) that visualizes routing decisions, and which itself imports the actual decision logic — `GATES`, `RUNG_OFFLOADED`, `describeTargets`, `evaluateOffload`, `jobClassOf`, `rungOfReason` — from a sibling module `./offload-gates` that was not retrieved into this evidence set. If `OffloadDecisionResolver` exists, it most likely lives in that unretrieved `offload-gates.ts`/`offload-gates.mjs` file (or in rapid-llm-proxy's own routing source), not in any file shown here.
- [ModelContextLimitCatalogue](./ModelContextLimitCatalogue.md) -- [LLM] None of the retrieved files implement, import, or define an entity named `ModelContextLimitCatalogue`. The five files handed to this analysis — `tests/features/copilot-model-ids.test.mjs`, `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, `.../llm-routing/offload-decision.tsx`, `.../llm-routing/use-classifier-judge.ts`, and `.../store/provider.tsx` — were almost certainly surfaced by a filename/keyword substring match on 'Model' (as in `ModelPrice`, `ModelFamily`, `modelFamily()`, `priceForModel()` in cost-model.ts) rather than because any of them catalogue per-model context-window token limits.


---

*Generated from 10 observations*
