# ClassifierJudgeReachability

**Type:** Detail

# ClassifierJudgeReachability

## What It Is

ClassifierJudgeReachability is concretely implemented in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`, which defines the `useClassifierJudge` hook and its associated `Judge`/`JudgeBackend` types. Its core purpose is to model, at runtime, whether the classifier judge subsystem and its backends are actually answering — as distinct from whether they are configured to be on. The hook exposes `configError` at the config level, `judgeError` at the judge-service level, and `reachable: boolean | null` per backend (`JudgeBackend.reachable`), with `null` specifically meaning "never asked on this network" rather than "down." This file is the real logic behind the component; the parent entity, LLMWithProcessClient, is referenced in the surrounding narrative but is not itself substantiated by any file in this evidence set — the observations explicitly note that `llm-with-process.ts` and `LLMWithProcessClient` are not present here, mirroring a pattern also seen with sibling CopilotModelIdAlignment, where a named component resolves to a test/consumer rather than the implementation.

## Architecture and Design

The defining architectural decision is a strict separation between config-level state (`enabled`) and runtime-observed state (`reachable`), motivated by a documented incident: on 2026-09-02 a judge model endpoint was down for roughly a day while `enabled` remained `true`, silently causing every classified turn to fall back to gh-copilot/claude-sonnet-5 with no dashboard signal. This split is reinforced by a second tier — `judgeError` (service-level unreachability) versus `backends[].reachable` (a specific model endpoint failing while the judge process itself still answers) — letting operators distinguish "classifier subsystem offline" from "classifier alive but its model isn't."

A related pattern is the deliberate non-unification of hooks: `offload-decision.tsx` composes `useClassifierJudge(proxyBase)` alongside a separate `useOffloadPolicyDraft`, rather than one combined settings hook, because the two write to different files (`config/prompt-classifier.yaml` vs. rapid-llm-proxy's `llm-routing.yaml`) on different machines' schedules. This mirrors, at a coarser grain, the same enabled-vs-reachable isolation principle: keep independent failure domains from bleeding into one another.

## Implementation Details

Polling is done via a plain `setInterval(load, pollMs)` with `pollMs` defaulting to 30,000ms, and critically this polling is never paused during an open, unsaved edit (`draftRubric`, `draftEnabled`, `draftStrategy`) — the code comment states that freezing the health readout during an edit would hide an outage that begins mid-edit. This is the inverse tradeoff from the offload policy poll in the same file, which the parent tab explicitly pauses during a dirty edit via `offload-decision.tsx`'s `onDirtyChange` callback.

State merging is handled through an `effectiveEnabled()` function and a `merged` memo that overlays only the `enabled` field with pending draft values (`{ ...b, enabled: effectiveEnabled(b) }`), while `reachable`, `lastLatencyMs`, `lastError`, and `idleMs` pass through untouched from the most recent poll. The `save()` function performs a partial PATCH containing only `backends[].enabled`, `rubric`, or `strategy` — runtime-only fields are structurally excluded from the write payload, so a save can never mask or "fix" a reachability problem it didn't cause. There are no setters for `reachable`, `lastLatencyMs`, `lastError`, or `idleMs` on the hook's public surface; they are observation-only.

## Integration Points

`offload-decision.tsx` is the primary consumer, instantiating `useClassifierJudge(proxyBase)` as an independently-scoped hook alongside the offload policy draft hook, and documenting `CLASSIFIER_IMPLS` ('none' / 'local-llm' / 'service') as the judge implementation options. The two hooks target different on-disk configs and are kept deliberately unmerged to preserve separate save/failure domains. Although LLMWithProcessClient is named as the parent in the hierarchy, no code path in this evidence set ties `use-classifier-judge.ts` to it directly — that relationship is asserted at the documentation layer only.

## Usage Guidelines

Developers extending this hook should preserve the enabled/reachable separation rather than collapsing it for convenience — this split exists specifically to prevent the class of silent-fallback outage seen in the 2026-09-02 incident. Never add reachability fields to the PATCH payload in `save()`; they must remain read-only, poll-derived facts. Do not pause the reachability poll during edits, unlike the offload policy poll, since masking live health changes during a draft session is the exact failure mode this design avoids. When adding new judge-related settings, prefer a new dedicated hook over folding logic into `useClassifierJudge` if it touches a different backing file, consistent with the `use-offload-policy-draft` separation.


## Hierarchy Context

### Parent
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] 'CLI/UKB Run Timeout and Provider Error Diagnostics' documents this layer's role in distinguishing proxy-layer timeouts from provider-specific failures further down the call chain

### Siblings
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [LLM] The only file among those supplied that is actually about copilot model ID alignment is tests/features/copilot-model-ids.test.mjs, and it is a drift-guard test, not the alignment implementation itself. It asserts facts about a separate script, integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs (that it exists, that it rewrites every id in the RETIRED constant, that no replacement itself maps to a retired id, and that both the Dockerfile and package.json postinstall invoke it) but that script's own source is not part of this evidence set. This mirrors the parent-context finding for LLMWithProcessClient/llm-with-process.ts: a component name resolves to a file that documents or tests the real logic without containing it.
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The component named 'FastModePricingRule' is concretely implemented in integrations/system-health-dashboard/src/components/cost/cost-model.ts under the 'Fast mode' section: `FAST_MODE_SUFFIX = '-fast'`, `FAST_MODE_MULTIPLIER = 2`, the `scalePrice()` helper, and the fast-mode branch inside `priceForModel()`. The design encodes fast mode as a multiplicative RULE applied to a model's base price rather than as hand-maintained duplicate price rows (e.g. a separate `claude-opus-5-fast` entry in `DEFAULT_COST_CONFIG.modelPrices`). The comment block directly above `FAST_MODE_SUFFIX` explains the rationale: a per-model twin entry 'fails SILENTLY' because the family fallback in the same function would happily price an untracked `-fast` suffix at the standard (non-premium) rate with `priced: true` and no warning, silently underbilling every fast-mode call.
- [ModelContextLimitsCache](./ModelContextLimitsCache.md) -- [LLM] None of the five supplied files (tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts, integrations/system-health-dashboard/src/store/provider.tsx) define, import, or reference a class, function, hook, or module named 'ModelContextLimitsCache'. There is no cache keyed on model context-window sizes, no TTL/eviction logic, and no lookup table mapping model ids to token-limit ceilings anywhere in this evidence set — the closest adjacent concept is cost-model.ts's modelPrices/FAMILY_REPRESENTATIVE tables, which price tokens rather than cap them.


---

*Generated from 9 observations*
