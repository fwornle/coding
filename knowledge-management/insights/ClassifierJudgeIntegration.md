# ClassifierJudgeIntegration

**Type:** Detail

# ClassifierJudgeIntegration — Technical Insight Document

## What It Is

ClassifierJudgeIntegration is implemented as the `useClassifierJudge` hook in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`, and is consumed by the parent `OffloadDecision` component in `offload-decision.tsx` as `const judge = useClassifierJudge(proxyBase)`. It manages the state, polling, and persistence lifecycle of the judge/classifier backend configuration that determines whether — and via which backend — LLM offload decisions get judged. It is a sibling concern to `useOffloadPolicyDraft` (documented on the parent `OffloadRouting`/`OffloadDecision` entity): both hooks render inside a single card but persist independently, to different files, on different machines' schedules — the offload policy to `rapid-llm-proxy`'s `llm-routing.yaml`, and the judge's backends/rubric to this repo's `config/prompt-classifier.yaml` via `GET`/`PATCH /api/llm/classifier`.

## Architecture and Design

The dominant architectural pattern is **config-vs-runtime field separation on the same entity**: `JudgeBackend` deliberately keeps `enabled` (declared, editable via `setBackendEnabled`) distinct from `reachable` (observed, nullable when never probed). This split, and the incident that motivated it — a 2026-09-02 day-long silent fallback to `gh-copilot/claude-sonnet-5` while `enabled: true` gave no visual signal — is directly implemented here, not merely described at the parent level (`use-classifier-judge.ts:26-42`).

A second pattern is the **optimistic draft-over-source overlay**: local draft state (`draftEnabled`, `draftRubric`, `draftStrategy`) is never mutated into the polled `judge` state directly. Instead, an `effectiveEnabled` callback and a `merged` `useMemo` (`use-classifier-judge.ts:185-192`) recompute a combined view on every poll tick, overlaying edits onto fresh `reachable`/`lastError`/`idleMs` facts.

The third defining decision is a **non-pausing background poll during edits** — the 30-second `setInterval(load, pollMs)` inside the main `useEffect` keeps running even while a rubric draft is open (`use-classifier-judge.ts:120-140`). This is an explicit *opposite* tradeoff to the sibling `useOffloadPolicyDraft`, which pauses its poll on dirty state via `onDirtyChange`. The rationale recorded in the hook's comments: freezing the health readout during an edit would hide a judge going unreachable mid-edit.

## Implementation Details

`load()` fetches from `${proxyBase}/api/llm/classifier` and constructs the `Judge` object by spreading the server's `incoming` payload over a hardcoded default shape (`strategy: 'llm'`, empty `knn` sub-object). This is defensive normalization against API evolution, but it creates a genuine ambiguity: a server that omits `knn` entirely is indistinguishable from one that reported an empty `knn` block (`use-classifier-judge.ts:120-140`).

`save()` (`use-classifier-judge.ts:155-180`) constructs a **diff-only PATCH**: it filters `judge.backends` down to those present in `draftEnabled` whose value differs from current `b.enabled`, and includes rubric/strategy keys in the body only when a draft value exists and differs from the loaded judge's value. This is a smaller-blast-radius variant of the race-avoidance problem `OffloadDecision` solves at the poll level for its sibling hook — here solved at the request-body level, preventing an unrelated poll-vs-edit race from clobbering untouched fields, and preventing a rubric typo or a rejected band from rolling back an unrelated toggle.

The `proxyBase` is passed in as a prop rather than hardcoded, meaning the hook carries no fixed service location and can be reused against different proxy bases.

## Integration Points

`OffloadDecision` (`offload-decision.tsx:190-192`) consumes the hook purely as a read/edit state surface — `judge.judge`, `judge.judgeError`, plus a locally-owned `showRubric` toggle. Notably, the **CLASSIFIER_IMPLS** constant (`offload-decision.tsx:58-78`) — the none/local-llm/service dropdown describing who owns the judgment rubric, including the 2026-08-31 http→service rename — lives entirely in the parent component, not the hook. This is a clean split between state-management (hook) and presentation-copy/impl-selection framing (parent), one that isn't obvious just from reading the hook file.

Within `OffloadRouting`, this integration sits alongside siblings `OffloadGatesMirror`, `CallStripAndDetail`, and `OffloadReplay` — all of which, per their own analyses, have unresolved implementation files (`offload-gates.ts`, `call-strip.tsx`/`call-detail.tsx`, `offload-replay.ts`) not present in the supplied code, unlike `ClassifierJudgeIntegration` whose core file was retrieved directly.

## Usage Guidelines

Developers should not merge this hook's save cycle with `useOffloadPolicyDraft`'s, even though both live in one visual card — the two persist to entirely different backing files with different owners, and the header comment in `use-classifier-judge.ts` states this explicitly as the reason for separation. When extending `JudgeBackend`, preserve the `enabled`/`reachable` split rather than collapsing to one status field; collapsing it reintroduces the exact 2026-09-02 failure mode. When modifying `save()`, retain diff-only semantics — sending the whole judge object risks overwriting fields not being edited. Do not reflexively pause the poll during edits to mirror the sibling hook's pattern; that reversal is the point of this hook. Finally, treat `knn` defaulting behavior as a caveat: consumers needing to know whether the server ever actually reported KNN status cannot currently distinguish "server omitted it" from "client synthesized empty defaults."


## Hierarchy Context

### Parent
- [OffloadRouting](./OffloadRouting.md) -- [LLM] OffloadDecision (integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx) implements a dual-mode analysis surface — 'Configuration' mode counts routes to answer 'what will happen', 'Recorded' mode counts actual calls to answer 'what did' — sharing one gate ladder (GATES, RUNG_OFFLOADED from ./offload-gates) so switching modes diffs intent against behavior without a layout change. The component's own header comment states this is deliberately one component with a toggle rather than two separate cards, because the value is specifically in the ability to flip between the two without re-reading structure.

### Siblings
- [OffloadGatesMirror](./OffloadGatesMirror.md) -- [LLM] The code supplied for this analysis does not contain `offload-gates.ts`, the file that offload-decision.tsx's own header comment names as the thing being mirrored ('`offload-gates.ts` restates the proxy's offload block, and a restatement drifts'). Everything nameable about the mirror — `GATES`, `RUNG_OFFLOADED`, `evaluateOffload`, `rungOfReason`, `describeTargets`, `jobClassOf` — is visible only as import identifiers and as prose in offload-decision.tsx:34-38, never as the implementation that decides what a rung means or how a route entry maps to one.
- [CallStripAndDetail](./CallStripAndDetail.md) -- [LLM] The requested component "CallStripAndDetail" is not present in any supplied code file. offload-decision.tsx imports `CallStrip, stripRows` from './call-strip' and `CallDetail` from './call-detail' (visible in the import block near the top of offload-decision.tsx), and it maintains a `selectedCall` state slot (`useState<number | null>`) that is clearly meant to link a strip selection to a detail view, but neither call-strip.tsx nor call-detail.tsx — nor any combined CallStripAndDetail file — was included in the code files given here. Everything below is therefore inferred from the consuming component's usage, not read from the component's own implementation.
- [OffloadReplay](./OffloadReplay.md) -- [LLM] The 'OffloadReplay' component/module is never defined in the supplied code files — it is only visible as an import site: offload-decision.tsx pulls `replayRecorded` and `totalsByRoute` from `./offload-replay` (a relative path implying a sibling file `offload-replay.ts`/`.tsx` that was not retrieved). Everything below is therefore inferred from the CALLER's usage contract, not from the component's own implementation, which is precisely the evidence gap this analysis is required to flag.


---

*Generated from 9 observations*
