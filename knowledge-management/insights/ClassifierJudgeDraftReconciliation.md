# ClassifierJudgeDraftReconciliation

**Type:** Detail

# ClassifierJudgeDraftReconciliation

## What It Is

`ClassifierJudgeDraftReconciliation` is the state-reconciliation design implemented in `use-classifier-judge.ts` (`integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`), which governs how operator edits to classifier judge configuration coexist with continuously-polled runtime data without either one corrupting the other. It is the mechanism by which the hook resolves the tension between `JudgeBackend`'s two independent fields — `enabled` (file-declared) and `reachable` (poll-derived, nullable tri-state, as detailed in sibling `JudgeBackendEnabledReachableSplit`) — and a set of in-progress operator drafts (`draftEnabled`, `draftRubric`, `draftStrategy`). The component exists specifically because of a documented incident (2026-09-02, ~24h) where a dead backend remained `enabled: true` while every classified turn logged `classifier error: classifier HTTP 502` and silently fell through to `gh-copilot/claude-sonnet-5`, with no dashboard signal. The reconciliation logic is what prevents both that failure mode and a second, related one: a UI edit or a background poll clobbering the other's state.

## Architecture and Design

The design rests on three composed patterns. First, a **draft/overlay pattern**: `judge.backends` (server truth) is never mutated directly. Edits live entirely in `draftEnabled`/`draftRubric`/`draftStrategy`, and are overlaid onto server state only at render time via `effectiveEnabled()` and the `merged` memo (`use-classifier-judge.ts:150-158`). Second, a **diff-based partial write**: `save()` (`use-classifier-judge.ts:161-192`) computes the delta between drafts and the last-loaded `judge` snapshot and PATCHes only changed keys, rather than PUTing a full object. Third, **non-gated polling**: the `useEffect` at `use-classifier-judge.ts:120-131` keeps `setInterval(load, pollMs)` running regardless of whether a draft is open, explicitly rejecting the common "freeze on edit" UI convention.

These three patterns interlock: overlay-only rendering is *what makes* uninterrupted polling safe, since a poll can freely replace `judge` without touching in-flight edits; diff-based saves are *what makes* uninterrupted polling safe in the other direction, since a save can no longer clobber a field the poll changed underneath the draft. This is the same config-vs-runtime discipline the parent LLMMockService applies in `getLLMMode()`'s precedence chain, reapplied here to the judge rather than the mock toggle.

## Implementation Details

The `merged` memo is deliberately narrow: `merged = { ...judge, backends: judge.backends.map(b => ({ ...b, enabled: effectiveEnabled(b) })) }`. Only `enabled` is spread over by `effectiveEnabled()`; `reachable` is excluded from the overlay by construction, so a UI edit can never mask a live-poll fact about reachability — this is the mechanism, not merely a stated intent.

`save()`'s diff logic sends `backends: [...]` only for ids present in `draftEnabled` that differ from `judge.backends`, and includes `rubric`/`strategy` only if changed. The inline comment frames this as a defense against "an unrelated poll-vs-edit race able to rewrite a field nobody touched," since polling continues at `pollMs` (default 30s) even with a draft open.

The polling `useEffect`'s dependency array includes `tick` (bumped by `reload()`) alongside `proxyBase`/`pollMs`. Its comment states plainly that a judge can go unreachable *while* someone is editing it, so polling must never pause — a stronger liveness guarantee than typical "pause on edit" dashboards, made safe only because draft state is fully decoupled from `judge` state.

## Integration Points

This reconciliation pattern is consumed by `offload-decision.tsx`, which composes `useClassifierJudge` (`judge`) alongside the separately-polling, separately-saving `useOffloadPolicyDraft` (`policy`). The card reads `cls = policy.classifier` out of `policy.draft` for band-eligibility display, but the gate-ladder computation (`configRungs`, `evaluateOffload`) deliberately excludes `judge`/`cls` — a comment notes that consuming it "would silently redraw counts it does not govern." This mirrors the file-level rationale that a rubric typo in `config/prompt-classifier.yaml` must never roll back an unrelated offload-target toggle in `llm-routing.yaml`.

The same file's `resolveKey` memo (`offload-decision.tsx:188-197`) applies an analogous discipline in an unrelated axis: it excludes `hours` from its invalidation key because that input changes counts, not routing resolution — the same "invalidate only on inputs that matter" philosophy governing the draft/poll boundary, and comparable in spirit (though narrower) to `model-limits.cjs`'s mtime+size cache identity check.

Architecturally, this hook sits in the same polling-hook world as `offload-decision.tsx` but is explicitly distinct from `model-limits.cjs`, a single-tick, process-lifetime Node module with no analogous poll/draft race to guard against. `cost-model.ts`'s append-only `monthlyEurByMonth` overlay is a sibling philosophy — favoring overlay/append state over destructive migration to preserve interpretability — though it operates on a different axis (cost history vs. live draft/poll reconciliation).

## Usage Guidelines

Developers extending `use-classifier-judge.ts` or similar dual-source hooks should preserve the non-negotiable invariant: server-derived runtime fields (like `reachable`) must never be overlaid by draft state, only config-declared fields (like `enabled`) may be. Any new draft field must be diffed against the last-loaded snapshot before being sent in a save, never PUT wholesale. Polling must not be paused merely because an edit is open — the entire safety of that decision depends on drafts and server state remaining structurally separate memos, never merged into one mutable object. Anyone consuming `judge`/`cls` in a downstream computation (as `offload-decision.tsx` does) should ask, per its own precedent, whether that computation is actually governed by classifier state, or would just be silently redrawing unrelated counts.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- [LLM] The `use-classifier-judge.ts` hook (integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts) implements the same config-vs-runtime split described for LLMMockService's `getLLMMode()` precedence chain, but for the offload judge rather than the mock toggle: `JudgeBackend.enabled` is what the YAML file says, while `JudgeBackend.reachable` is whether it actually answered on the last poll. The header comment documents a real incident (2026-09-02) where `enabled: true` masked a dead backend for about a day because nothing distinguished 'switched off' from 'not answering' — the exact class of ambiguity that `getLLMMode()`'s three-tier precedence (perAgentOverrides → globalMode → legacy progress.mockLLM) is designed to avoid by making precedence explicit rather than collapsing multiple signals into one boolean.

### Siblings
- [JudgeBackendEnabledReachableSplit](./JudgeBackendEnabledReachableSplit.md) -- [LLM] `use-classifier-judge.ts`'s `JudgeBackend` interface hard-codes the enabled/reachable split as two distinct, independently-nullable fields (`enabled: boolean` vs `reachable: boolean | null`) rather than a single derived status. The header comment traces this directly to the 2026-09-02 incident: every classified turn logged `classifier error: classifier HTTP 502` and pi's turns silently fell back to `gh-copilot/claude-sonnet-5` for roughly a day, while every visible signal (`enabled: true`, the impl name, the offload policy) still looked correct. `reachable` is `null` specifically to mean 'never asked on this network' — a third state that a plain boolean collapse would have to fold into either true or false, re-creating the exact ambiguity the incident exposed.


---

*Generated from 10 observations*
