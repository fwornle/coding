# JudgeBackendEnabledReachableSplit

**Type:** Detail

# JudgeBackendEnabledReachableSplit

## What It Is

`JudgeBackendEnabledReachableSplit` is the design principle, implemented in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts` (lines 29-43), that keeps a `JudgeBackend`'s configuration state and its runtime health state as two structurally distinct, independently-nullable fields rather than a single derived status: `enabled: boolean` versus `reachable: boolean | null`. The header comment (lines 6-18) documents the concrete incident that motivated this split: on 2026-09-02, a backend remained `enabled: true` in configuration while silently failing (`classifier error: classifier HTTP 502`), causing pi's traffic to fall back to `gh-copilot/claude-sonnet-5` for roughly a day with no dashboard signal, because nothing distinguished "switched off" from "not answering." `reachable`'s tri-state nature (`boolean | null`) adds a third meaning — "never asked on this network" — that a plain boolean would have to collapse into either true or false, recreating the same ambiguity.

## Architecture and Design

The split is the local, backend-level instance of a config-vs-runtime separation pattern that recurs throughout this codebase, paralleled at the sibling level by `ClassifierJudgeDraftReconciliation` and rooted conceptually in the parent `LLMMockService`'s `getLLMMode()` precedence chain, which likewise refuses to collapse multiple signals into one boolean. Rather than deriving a unified "status" enum, the hook tracks health at three simultaneous granularities: whole-service (`judgeError`, described as "the single most important field"), config-file-level (`configError`, present only when the on-disk config is currently unusable), and per-backend (`enabled`/`reachable`). This mirrors patterns noted elsewhere for `model-limits.cjs`'s `catalogueContextWindow()` — an explicit preference for multi-tier state over flattened signals.

The pattern extends beyond the hook into `offload-decision.tsx`, where the `configRungs` memo deliberately reads only `policy.draft` (the offload policy) and not `cls` (`policy.classifier`, the judge state), with an explicit comment that reading `cls` there "would silently redraw counts it does not govern." This shows the split is enforced not just internally to `useClassifierJudge` but as a boundary respected by consuming components — judge health changes what verdicts arrive, not which routes are structurally eligible for offload.

## Implementation Details

Three mechanisms enforce the split across the hook's lifecycle. First, the `merged` memo (lines 169-173) builds `{ ...judge, backends: judge.backends.map(b => ({ ...b, enabled: effectiveEnabled(b) })) }`, overlaying only `enabled` from `draftEnabled` onto polled data while `reachable`, `lastLatencyMs`, `lastError`, and `idleMs` pass through untouched — explicitly to prevent an unsaved config edit from visually masking a backend that's still actually down. Second, `save()` (lines 141-146) diffs `draftEnabled` against `judge.backends` and PATCHes only backends whose `enabled` value changed (`.filter(b => b.id in draftEnabled && draftEnabled[b.id] !== b.enabled)`), meaning `reachable` is structurally read-only from the browser's perspective — it only ever arrives via the poll. Third, the polling loop uses a raw `setInterval(load, pollMs)` (lines 117-123) inside `useEffect` rather than a shared `usePolledFetch` utility, specifically because the poll must never freeze while `draftRubric`/`draftEnabled`/`draftStrategy` hold an open edit — "a judge can go unreachable WHILE someone is editing it."

## Integration Points

This split connects to `use-offload-policy-draft` only at the `OffloadDecision` component level via `policy.classifier`, keeping the two hooks — and their two backing config files (`llm-routing.yaml` and `prompt-classifier.yaml`) — separate by write destination and failure domain. It also contrasts with `offload-decision.tsx`'s handling of `policy.dirty`, which *does* suppress the parent tab's config poll via `onDirtyChange` — establishing a clear rule: config data freezes during edits to avoid clobbering drafts, while runtime health data never freezes, since staleness there is the very failure mode being guarded against.

## Usage Guidelines

Developers extending this hook or its consumers should never merge `reachable` (or other runtime fields) into draft-overlay logic, never include `reachable` in PATCH payloads, and never let judge health (`cls`) influence route-eligibility computations like `configRungs`. New polling logic touching judge state should follow the non-freezing precedent rather than the dirty-suppression precedent used for config polls, and any new health field should default toward an explicit nullable/tri-state representation rather than a collapsed boolean, consistent with `judgeError`/`configError`/`enabled`/`reachable` all being tracked as independent signals.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- [LLM] The `use-classifier-judge.ts` hook (integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts) implements the same config-vs-runtime split described for LLMMockService's `getLLMMode()` precedence chain, but for the offload judge rather than the mock toggle: `JudgeBackend.enabled` is what the YAML file says, while `JudgeBackend.reachable` is whether it actually answered on the last poll. The header comment documents a real incident (2026-09-02) where `enabled: true` masked a dead backend for about a day because nothing distinguished 'switched off' from 'not answering' — the exact class of ambiguity that `getLLMMode()`'s three-tier precedence (perAgentOverrides → globalMode → legacy progress.mockLLM) is designed to avoid by making precedence explicit rather than collapsing multiple signals into one boolean.

### Siblings
- [ClassifierJudgeDraftReconciliation](./ClassifierJudgeDraftReconciliation.md) -- [LLM] `use-classifier-judge.ts`'s `Judge` interface deliberately keeps `enabled` (file-declared) and `reachable` (poll-derived, nullable tri-state) as two separate fields on `JudgeBackend` rather than collapsing them into one status. The header comment ties this directly to a dated incident (2026-09-02, ~24h) where a dead backend stayed `enabled: true` while the judge silently stopped answering — every classified turn logged `classifier error: classifier HTTP 502` and pi's traffic fell through to `gh-copilot/claude-sonnet-5` with no dashboard signal. This is the component's clearest instance of the parent's config-vs-runtime split, and unlike a simple boolean, `reachable: boolean | null` also encodes 'never asked on this network' as a distinct state from both true and false.


---

*Generated from 9 observations*
