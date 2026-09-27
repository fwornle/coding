# OffloadDecisionCard

**Type:** Detail

## What It Is

The observations do not show a file literally named `OffloadDecisionCard`. What exists is `OffloadDecision`, implemented at `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, built from `Card`/`CardHeader`/`CardContent`/`CardTitle` primitives and rendering the seven-rung offload gate ladder. The retrieved evidence treats `OffloadDecisionCard` as most likely a naming alias or thin external wrapper around this same file — the same drift pattern already noted between `OffloadRoutingDashboard` and `OffloadDecision` — rather than a distinct implementation. Given this, the document below describes `OffloadDecision` as the best-evidenced referent, but this identification is inferred, not confirmed.

## Architecture and Design

The defining decision is a single component parameterized by `mode: 'config' | 'recorded'` rather than two separate cards, so both modes share the identical `GATES`/`RUNG_OFFLOADED` ladder geometry from `./offload-gates`. This lets an operator toggle between "what policy says will happen" (`configRungs`, via `evaluateOffload()` against the in-memory draft) and "what actually happened" (`recorded`/`replay`, via `offloadSkips`/`perRoute` and `replayRecorded()`/`totalsByRoute()` from `./offload-replay`) without a layout context switch — directly serving the parent OffloadRoutingDashboard's purpose of visualizing the LLM Routing Tier Priority fallback order.

A second core pattern is client-side mirror-and-verify: the component doesn't trust its own local `evaluateOffload()` output as ground truth. A `useEffect` keyed on `resolveKey` fans out via `pooled(entries, 8, ...)` to `${proxyBase}/api/llm/routing/resolve?...`, and `configRungs` diffs each proxy answer against the local verdict, populating a `disagreements` array for a destructive-styled banner — but only `if (!policy.dirty)`, since an unsaved draft isn't something the proxy can resolve yet. This same comparison is independently duplicated at the CI level by `tests/agents/offload-gates-contract.test.mjs`, a deliberate redundancy rather than one delegating to the other.

State is split across two hooks with different persistence targets: `useOffloadPolicyDraft` writes to rapid-llm-proxy's `llm-routing.yaml`, while `useClassifierJudge(proxyBase)` PATCHes `config/prompt-classifier.yaml`. This separation is enforced at the code-comment level inside `OffloadDecision` — `cls = policy.classifier` is read independently of `p = policy.draft` specifically so the gate ladder never redraws rung counts based on a classifier-only edit.

## Implementation Details

`resolveKey` is scoped to `policy.network`/`entries` identity, deliberately excluding the `hours` traffic-window prop to avoid unnecessary re-fetching — a tight, intentional coupling to avoid over-fetching against the proxy. `pooled()` bounds concurrency at width 8 for the fan-out verification calls, avoiding one socket per route.

`JudgeBackend.reachable: boolean | null` (in `use-classifier-judge.ts`) is a narrow but load-bearing type distinguishing "never asked" (`null`) from "asked and failed" (`false`) — tied to a documented incident where a judge configured `enabled: true` was silently unreachable for about a day, surfaced only as a per-row `classifier error: classifier HTTP 502` string. `OffloadDecision` surfaces this via `judge.backends` and `judgeError`/`judgeUrl` rather than inferring health from `enabled` alone.

`save()` in `use-classifier-judge.ts` sends only diffed fields (`backends` filtered by changed `draftEnabled`, plus `rubric`/`strategy` only if changed), preventing a poll-vs-edit race from clobbering untouched fields. `OffloadDecision` mirrors this discipline via `onDirtyChange?.(policy.dirty)`, signaling the parent tab to suspend its own routing-config poll while an edit is in progress.

## Integration Points

`OffloadDecision` composes `FlowTab` from `@/pages/token-usage-flow-tab` and helpers from `./offload-replay`, `./call-strip`, `./call-detail`, and `./recent-call`, indicating assembly from many small collaborating modules rather than a monolith. It sits under OffloadRoutingDashboard as parent. Its sibling ClassifierJudgePanel could not be confirmed as a separate file — the JSX consuming `useClassifierJudge()`'s `judge.backends`, `judge.rubric`, and `showRubric` state was truncated from the retrieved excerpt, so it may be inline JSX within `OffloadDecision` rather than a split-out component.

Two files retrieved alongside it — `cost-model.ts` (pure Token Usage → Cost pricing logic) and `store/provider.tsx` (generic Redux shell wiring) — are architecturally unrelated despite directory co-location; their inclusion is retrieval-adjacency, not real coupling. Similarly, `tests/features/copilot-model-ids.test.mjs` guards a proxy-side model-id drift issue but is not part of this component's code path, though it corroborates the severity of bad provider ids in the routing system this ladder visualizes.

## Usage Guidelines

Treat the mode toggle as the primary UX contract: config and recorded views must keep identical ladder geometry so diffing intent-vs-behavior remains meaningful. Never let the gate ladder read `cls` (classifier state) — this coupling is explicitly forbidden by code comment to prevent classifier edits from silently altering rung counts. When modifying `useOffloadPolicyDraft` or `useClassifierJudge`, preserve diff-only PATCH semantics and the `onDirtyChange` propagation, since both exist specifically to prevent poll-vs-edit races. Any change to the proxy-vs-ladder comparison logic should be mirrored in `tests/agents/offload-gates-contract.test.mjs` to keep the UI and CI checks in sync. Given the unresolved naming discrepancy between `OffloadDecisionCard` and `OffloadDecision`, future work should verify whether a wrapper file exists before assuming they are identical.


## Hierarchy Context

### Parent
- [OffloadRoutingDashboard](./OffloadRoutingDashboard.md) -- [SESSION] 'LLM Routing Tier Priority' establishes the fallback tier order (max-subscription first, then work/Copilot, then Groq Llama-70B last resort) that this dashboard's rung ladder is built to visualize and verify

### Siblings
- [ClassifierJudgePanel](./ClassifierJudgePanel.md) -- [LLM] No file among those retrieved defines a component literally named `ClassifierJudgePanel`. What exists is `use-classifier-judge.ts`'s `useClassifierJudge()` hook (integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts), which `offload-decision.tsx` consumes via `const judge = useClassifierJudge(proxyBase)` and a `showRubric` boolean state, but the JSX that would render `judge.backends`, `judge.rubric`, or the enable/reachable badges is truncated out of the supplied `offload-decision.tsx` excerpt. It is plausible `ClassifierJudgePanel` is either an inline JSX block inside `OffloadDecision` (never split into its own component) or a sibling component file not among those retrieved, but neither can be confirmed from what is shown.


---

*Generated from 11 observations*
