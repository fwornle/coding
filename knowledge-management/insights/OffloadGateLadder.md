# OffloadGateLadder

**Type:** Detail

Gate 0 ('considered') is documented as SILENT in the proxy when the route already names the target — no reason string is recorded, so evaluateOffload() must return an explicit reason rather than leaving callers to infer policy-off vs already-target.

# OffloadGateLadder: Technical Insight Document

## What It Is

OffloadGateLadder is the gate-ordering model defined in `offload-gates.ts` that underpins offload eligibility evaluation for the broader `OffloadDecisionEngine`. At its core is the `GATES` const array, whose index positions double as "rung numbers" in a linear evaluation ladder: considered → route-allows → band → target → target-band → scope → transport → offloaded. This array is not just a lookup table — its ordering is a load-bearing contract that must match the proxy's short-circuit evaluation order exactly, since gate order determines which reason string ultimately gets attributed to any given call.

## Architecture and Design

The design follows a "ladder" or staged-gate pattern: each rung represents a checkpoint a call must pass to continue toward being offloaded, and evaluation stops at the first failing gate. This is implemented via `evaluateOffload()`, which returns a `stay(rung, reason)` tuple identifying exactly where a route stopped. The terminal state, `RUNG_OFFLOADED`, is derived rather than hardcoded — computed as `GATES.length - 1` — so the pass rung automatically stays in sync with the array's length, reducing the risk of drift between the gate list and the "success" sentinel.

A notable design trade-off is the deliberate collapsing of distinct proxy-side conditions into single gates. Gate 3 merges "no target declared" and "target switched off" into one gate rather than exposing them as separate rungs, mirroring how `pickOffloadTarget()` already collapses these cases upstream. This sacrifices some granularity in diagnostic precision for simplicity and consistency with the proxy's own behavior — the ladder is intentionally a faithful mirror of proxy logic, not an independent or more expressive model.

## Implementation Details

Gate 0 ("considered") has special silent semantics in the proxy: when a route already names its target, no reason string is recorded there, since the proxy considers this case self-evident. However, `evaluateOffload()` cannot rely on this silence — because it doesn't have a live caller to infer intent, it must return an explicit reason distinguishing "policy-off" from "already-targeted" scenarios that the proxy handles implicitly. This is one of the more subtle implementation details in the ladder: the same gate can be silent in one execution context and must be explicit in another, and `offload-gates.ts` is where this asymmetry is reconciled.

Two additional exported helpers, `pickTarget()` and `describeTargets()`, function as shared utilities off the main gate array — used both internally by `evaluateOffload()` and externally by `offload-headline.tsx`. This dual consumption suggests the gate ladder's helper functions are treated as a small stable API surface separate from the gate evaluation logic itself.

## Integration Points

OffloadGateLadder is a child concept within `OffloadDecisionEngine`, and its gate order is derived directly from the proxy's short-circuit evaluation sequence — meaning any change to the proxy's own conditional ordering requires a corresponding, carefully-matched update to `GATES`. It also integrates with UI-facing siblings: `OffloadDecisionCard` shares `GATES`/`evaluateOffload()` directly, reusing the same gate ladder logic while toggling between "config" mode (counting routes via `resolveKey` against `/api/llm/routing/resolve`) and "recorded" mode (counting calls from `recent`) — only the display unit word changes, not the underlying gate evaluation. Similarly, `offload-headline.tsx` consumes `pickTarget()` and `describeTargets()` directly from this module, reinforcing the ladder's role as a shared evaluation core rather than a component-local implementation detail.

## Usage Guidelines

Developers modifying `offload-gates.ts` must treat `GATES` array order as a strict contract with the proxy's short-circuit logic — reordering, inserting, or removing entries without mirroring the proxy will silently corrupt reason attribution for stayed calls. When adding new gate conditions, consider whether the proxy actually distinguishes them or collapses them (as with gate 3), and match that granularity rather than introducing new splits unilaterally. Because `RUNG_OFFLOADED` is computed from `GATES.length`, any additions to the array will automatically shift the pass rung — no manual update needed, but it means array edits have an implicit side effect that should be understood before modification. Finally, since `pickTarget()` and `describeTargets()` are consumed externally (e.g., by `offload-headline.tsx`), changes to their signatures or return semantics should be treated as public API changes affecting components beyond `OffloadDecisionEngine` itself.


## Hierarchy Context

### Parent
- [OffloadDecisionEngine](./OffloadDecisionEngine.md) -- evaluateOffload() in offload-gates.ts reproduces the proxy's short-circuit gate order exactly (considered→route-allows→band→target→target-band→scope→transport→offloaded), because gate order determines which reason string is attributed to a call

### Siblings
- [RecordedCallStrip](./RecordedCallStrip.md) -- CallStrip uses a native <input type='range'> deliberately instead of a custom slider, per the comment citing free keyboard/touch/screen-reader semantics and consistency with the settings dialog's bare checkboxes.
- [OffloadDecisionCard](./OffloadDecisionCard.md) -- Component toggles between mode 'config' (counts routes via resolveKey/pooled requests to /api/llm/routing/resolve) and 'recorded' (counts calls from `recent`), sharing GATES/evaluateOffload but changing the unit word.


---

*Generated from 4 observations*
