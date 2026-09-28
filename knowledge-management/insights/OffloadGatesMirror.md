# OffloadGatesMirror

**Type:** Detail

## What It Is

OffloadGatesMirror refers to `offload-gates.ts`, a module located in `integrations/system-health-dashboard/src/components/llm-routing/`, whose actual implementation file is not present in the supplied code. Its existence and contract are known only indirectly, through its consumer `offload-decision.tsx`, which imports `GATES`, `RUNG_OFFLOADED`, `describeTargets`, `evaluateOffload`, `jobClassOf`, and `rungOfReason` from it. The component's purpose is stated verbatim in a header comment inside `offload-decision.tsx`: "`offload-gates.ts` restates the proxy's offload block, and a restatement drifts." It is a local, dashboard-side re-encoding of rapid-llm-proxy's offload decision ladder — the parent system named in `OffloadRoutingUI`'s session context as "the mandatory routing authority these UI components mirror and must never silently diverge from." The mirror exists purely for performance: the UI cannot issue 39 live resolve calls per render, so it needs a fast local approximation of the proxy's gate logic.

## Architecture and Design

The dominant pattern is **local restatement plus live reconciliation**: rather than trusting the mirrored ladder as ground truth, `offload-decision.tsx`'s `configRungs` useMemo computes `evaluateOffload()` locally for every route/default entry, then — only when `!policy.dirty` — diffs that verdict against the proxy's authoritative answer fetched from `${proxyBase}/api/llm/routing/resolve?job=...&agent=...&network=...`. Disagreements (rung mismatch via `rungOfReason(r.offloadSkipped)` vs. locally computed `v.rung`, or a differing `provider` string) are collected into a `disagreements` array and rendered as a destructive UI banner. This treats the mirror as a falsifiable hypothesis, not a source of truth, directly answering the drift risk named in its own comment.

This risk is checked at two independent layers: browser-side reconciliation in `offload-decision.tsx`, and a CI-side contract test, `tests/agents/offload-gates-contract.test.mjs`, named in the same header comment as making "the same comparison" in CI. Only the runtime check is visible in the supplied code; the test's exact assertions are unverifiable here.

The same mirroring pattern recurs at smaller scale elsewhere in the file via `CLASSIFIER_IMPLS`, a hardcoded enum of stage-2 judge values (`none`, `local-llm`, `service`) mirroring a switch statement believed to live in rapid-llm-proxy. Unlike the gate ladder, this mirror has no live reconciliation — an unlisted value simply produces "a rejected save with an opaque YAML parse error," a deliberately accepted, weaker failure mode traded for simplicity.

A related but distinct mirroring boundary appears in sibling code `use-classifier-judge.ts`, whose `JudgeBackend` type keeps `.enabled` and `.reachable` as separate booleans rather than collapsing config state and live liveness into one signal — motivated by a documented incident where a judge stayed enabled while its endpoint silently failed for a day.

## Implementation Details

From the call site, `evaluateOffload(policy.draft, entry, key, r.band, policy.network, fgCapable)` is inferred to return at least `{ rung, provider }`. `rungOfReason()` maps a proxy skip-string onto either a numeric rung or the sentinel `'unclassified'`, used to bucket unrecognized skip reasons in the `recorded` useMemo. `GATES` is consumed as an array exposing `.length` and per-entry `.label`, implying an ordered ladder of named gate stages. `RUNG_OFFLOADED` is the terminal rung index, used both to seed `counts[RUNG_OFFLOADED] = offloadedCalls` and as the ceiling defining "fully offloaded" status. None of the internal gate ordering, `evaluateOffload`'s full return shape, or `rungOfReason`'s mapping table can be confirmed beyond this inferred contract, since `offload-gates.ts` itself is absent from the supplied files.

## Integration Points

OffloadGatesMirror sits beneath `OffloadRoutingUI` (parent) as a `Detail`-level component, and its correctness is anchored against rapid-llm-proxy's live `/api/llm/routing/resolve` endpoint — the same proxy the whole `OffloadRoutingUI` subtree is bound to never silently diverge from. Its sole known consumer is `offload-decision.tsx`, which also owns the `CLASSIFIER_IMPLS` mirror and integrates the sibling hook `useClassifierJudge` (the likely underlying implementation for the sibling entity `ClassifierJudgePanel`, though no component with that exact name exists in the supplied code). The CI contract test `tests/agents/offload-gates-contract.test.mjs` is a parallel integration point, verifying the same mirror from the build pipeline rather than the browser.

## Usage Guidelines

Any change to rapid-llm-proxy's offload gate ladder must be mirrored in `offload-gates.ts` and validated against both the live disagreement banner in `offload-decision.tsx` and the CI contract test — treat these as paired, mandatory checks rather than redundant ones. Because the live reconciliation only runs when `!policy.dirty`, unsaved edits will not be checked against the proxy, so disagreements should be interpreted with that gating condition in mind. Given the file's absence here, any future work touching gate ordering, `RUNG_OFFLOADED` semantics, or `rungOfReason`'s mapping table should locate and inspect `offload-gates.ts` directly rather than inferring further from call-site usage. The `CLASSIFIER_IMPLS` constant is a reminder that not all mirrors in this file get live reconciliation — when adding new proxy-mirrored enums, prefer the gate-ladder's diff-and-banner approach over the classifier's silent-drift approach unless the weaker failure mode is a deliberate, documented trade-off.


## Hierarchy Context

### Parent
- [OffloadRoutingUI](./OffloadRoutingUI.md) -- [SESSION] Rapid-LLM-Proxy — Universal Agent Routing establishes rapid-llm-proxy as the mandatory routing authority these UI components mirror and must never silently diverge from.

### Siblings
- [ClassifierJudgePanel](./ClassifierJudgePanel.md) -- [LLM] No file or component literally named `ClassifierJudgePanel` appears in the supplied code. The closest concrete artifact is the hook `useClassifierJudge` in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`, which is consumed inside `OffloadDecision` (`offload-decision.tsx`) via `const judge = useClassifierJudge(proxyBase)` and a `showRubric` boolean state. If `ClassifierJudgePanel` exists, it is most plausibly either (a) an as-yet-unretrieved presentational component that renders `judge.backends`, `judge.rubric`, and the `showRubric` toggle, or (b) simply the mental/parent-doc name for the judge-related UI fragment that lives inline inside `OffloadDecision` rather than as its own file — the code graph gives no import or export named `ClassifierJudgePanel` to disambiguate.


---

*Generated from 10 observations*
