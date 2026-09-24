# ClassifierJudgeHook

**Type:** Detail

## What It Is

ClassifierJudgeHook is concretely implemented as `useClassifierJudge(proxyBase, pollMs = 30_000)` in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`. It fetches `GET ${proxyBase}/api/llm/classifier`, unwraps the `judge` payload, and maintains a `ClassifierJudgeState` composed of `Judge`/`JudgeBackend` interfaces. The file's own header comment frames it as "the judge — who decides how hard a request is, and whether they are answering," matching the responsibility ClassifierJudgeHook is meant to cover. It is consumed inside `offload-decision.tsx`, most plausibly the file behind what the hierarchy calls OffloadRoutingDashboard (that exact name isn't found in source, but `OffloadDecision` is the clear thematic match).

## Architecture and Design

The hook enforces a strict separation between CONFIG state (`enabled`, edited via `draftEnabled`/`setBackendEnabled`) and RUNTIME state (`reachable`, `lastLatencyMs`, `lastError`, `idleMs`). This split is not incidental — a code comment ties it to a real incident where every classified turn logged `classifier HTTP 502` while config still read `enabled: true`, because `reachable` was never surfaced. The `merged` useMemo overlays only `enabled` from `effectiveEnabled(b)` onto each backend, deliberately leaving `reachable` untouched so a pending edit can never mask a live outage.

A second key pattern is file-boundary-driven hook splitting: rather than one combined dashboard-state hook, each backing config file gets its own hook — `use-classifier-judge.ts` maps to `config/prompt-classifier.yaml`, while a sibling hook (`useOffloadPolicyDraft`) maps to `llm-routing.yaml`. Both are used inside the same `OffloadDecision` card but bound to independent local variables (`judge` vs `policy`), and the gate-ladder `useMemo` explicitly avoids reading `policy.classifier` (aliased `cls`) so that "a classifier edit would [not] silently redraw counts it does not govern." This mirrors the CostModel sibling's separation of concerns, though CostModel takes it further by being entirely React-free (pure functions over `CostRow`/`CostConfig`), while ClassifierJudgeHook, like `offload-decision.tsx`, mixes fetch/useState/useEffect directly into domain logic.

## Implementation Details

`save()` computes a minimal diff instead of resubmitting the whole judge config: it filters `judge.backends` down to those present in `draftEnabled` with a changed value, and only adds `rubric`/`strategy` to the PATCH body when they differ from the loaded `judge` object. An inline comment justifies this explicitly: sending the full file back would let "an unrelated poll-vs-edit race... rewrite a field nobody touched." This mirrors the diffing discipline attributed to the sibling `use-offload-policy-draft` hook.

Polling continues via `setInterval(load, pollMs)` even while a rubric/backend/strategy edit is open, because drafts (`draftRubric`, `draftEnabled`, `draftStrategy`) live in separate `useState` slots from the polled `judge` state and are only merged for display through `merged`/`effectiveEnabled` — never overwritten by `load()`. The comment states this is intentional: "a judge can go unreachable WHILE someone is editing it, and freezing the health readout during an edit would hide exactly that."

## Integration Points

`offload-decision.tsx` binds `useClassifierJudge` to `const judge = useClassifierJudge(proxyBase)`, distinct from `const policy = useOffloadPolicyDraft(proxyBase, onSaved)`. The gate-ladder computation (`configRungs`) deliberately excludes `policy.classifier` to keep offload-eligibility counts ungoverned by judge edits. The same file also externally documents `CLASSIFIER_IMPLS` (`none`, `local-llm`, `service` — renamed from `http` on 2026-08-31, with backward-compat acceptance of the old name) as a hand-maintained UI mirror of values that ultimately live in the classifier config the hook reads/writes; unlike `offload-gates.ts`'s proxy cross-check noted at the parent level, no automated contract test guards this list against drift.

Unrelated files retrieved alongside this component — `cost-model.ts`, `tests/features/copilot-model-ids.test.mjs`, and `store/provider.tsx` — share no import or call relationship with `use-classifier-judge.ts`; their presence reflects directory/keyword proximity rather than architectural coupling.

## Usage Guidelines

Developers extending this hook should preserve the config/runtime separation — never let `enabled` overlay `reachable`, since that was the root cause of a real masked-outage incident. Saves should continue to use minimal diffing rather than whole-object PATCHes to avoid clobbering concurrent edits. Polling should not be paused during editing, as health visibility during edits is a deliberate safety property. Any consumer combining this hook with `useOffloadPolicyDraft` (as `offload-decision.tsx` does) should keep their state boundaries isolated — reading `judge` state into offload-eligibility logic would violate the established file-boundary contract. Finally, if the proxy adds a new backend implementation type, `CLASSIFIER_IMPLS` must be manually updated, since no live cross-check currently protects the dropdown from drifting out of sync with proxy-accepted values.


## Hierarchy Context

### Parent
- [OffloadRoutingDashboard](./OffloadRoutingDashboard.md) -- [LLM] No file in the supplied set defines, exports, or references a component literally named "OffloadRoutingDashboard." The closest thematic match is `OffloadDecision` in `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, which is a dashboard card for offload routing — it toggles between 'config' and 'recorded' modes, renders a gate ladder (`GATES`, `RUNG_OFFLOADED`), and surfaces disagreements between the UI's own policy evaluation and the proxy's live resolution. This is very likely the entity the retrieval was trying to surface, but under a different code identifier, so any claim that 'OffloadRoutingDashboard is implemented at line X' would be fabricated rather than observed.

### Siblings
- [CostModel](./CostModel.md) -- [LLM] `cost-model.ts` (integrations/system-health-dashboard/src/components/cost/cost-model.ts) is the actual CostModel implementation, and it is deliberately React-free — every export (`budgetForMonth`, `priceForModel`, `cellCostUsd`, `monthlySeries`, `isSynthetic`) is a pure function over plain data (`CostRow`, `CostConfig`, `BudgetConfig`). This is a pattern seen nowhere else in the supplied set: `offload-decision.tsx` and `use-classifier-judge.ts` both mix fetch/useState/useEffect directly into their domain logic, while cost-model.ts pushes all of that (the `GET /api/token-usage/cost` and `GET /api/llm/settings` calls) to an unseen caller, keeping pricing math independently testable and reusable outside React.


---

*Generated from 10 observations*
