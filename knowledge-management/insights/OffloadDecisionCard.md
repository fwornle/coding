# OffloadDecisionCard

**Type:** Detail

Component toggles between mode 'config' (counts routes via resolveKey/pooled requests to /api/llm/routing/resolve) and 'recorded' (counts calls from `recent`), sharing GATES/evaluateOffload but changing the unit word.

# OffloadDecisionCard — Technical Insight Document

## What It Is

OffloadDecisionCard is a Detail-type component nested within OffloadDecisionEngine, responsible for surfacing an offload decision summary in one of two counting modes: 'config' and 'recorded'. In 'config' mode, it counts routes by resolving keys via `resolveKey` against pooled requests to `/api/llm/routing/resolve`; in 'recorded' mode, it counts actual calls sourced from `recent`. Both modes share the same underlying gate evaluation machinery (`GATES` and `evaluateOffload`) from the parent's `offload-gates.ts`, differing only in the unit word displayed to the user (routes vs. calls).

## Architecture and Design

The core architectural pattern here is **shared evaluation logic with mode-dependent framing**. Rather than maintaining two separate decision engines for configuration-time analysis versus recorded-call analysis, OffloadDecisionCard reuses `GATES`/`evaluateOffload` from OffloadDecisionEngine's `offload-gates.ts` and simply relabels the output unit depending on whether it's counting hypothetical route resolutions or actual historical calls. This avoids logic duplication and guarantees that the two views can never drift out of sync in terms of gate semantics — a route "offloaded" in config mode means the same thing as a call "offloaded" in recorded mode.

The gate order itself — considered→route-allows→band→target→target-band→scope→transport→offloaded — is treated as a contract that must mirror the proxy's own short-circuit evaluation exactly, since sibling component OffloadGateLadder depends on `GATES` array indices corresponding directly to rung numbers (including the sentinel `RUNG_OFFLOADED`). OffloadDecisionCard's counting logic inherits this same fidelity requirement: any drift between the card's evaluation and the proxy's actual behavior would misattribute reason strings to calls.

## Implementation Details

The `resolveKey` function used in 'config' mode is deliberately memoized on route/provider/complexity/offload/network identity — but explicitly *not* on traffic window hours. This is a precise optimization decision: since changing the hours window never changes where a route resolves, including it in the memo key would cause unnecessary cache misses and redundant recomputation without any correctness benefit.

Stage-2 judge classification is governed by `CLASSIFIER_IMPLS`, which enumerates exactly three implementations: 'none', 'local-llm', and 'service'. This list is tightly coupled to a hardcoded switch statement in the proxy — the two must be kept in lockstep. Notably, 'service' is a renamed spelling of the older 'http' value, reflecting a naming cleanup that developers must account for when tracing historical data or logs that may still reference the old spelling.

Dirty-state coordination is handled via the `onDirtyChange` callback, which signals the parent tab to suspend its configuration polling whenever a policy edit is unsaved. This prevents a race condition where a poll mid-edit would silently swap the underlying routes/providers that the preview/decision computation is based on, producing a confusing or incorrect preview.

## Integration Points

OffloadDecisionCard sits inside OffloadDecisionEngine and depends on its exported `evaluateOffload()` and `GATES` array from `offload-gates.ts` as the single source of truth for gate semantics. It is a sibling to OffloadGateLadder (which visualizes rung position using the same `GATES` indexing) and RecordedCallStrip (which renders individual recorded calls using a native `<input type='range'>` for accessibility reasons). While OffloadDecisionCard doesn't directly reuse RecordedCallStrip's rendering approach, it shares the same `recent` call data source in 'recorded' mode, implying a common upstream data feed across sibling components.

The `/api/llm/routing/resolve` endpoint is the external integration point for 'config' mode, and its pooled request pattern combined with `resolveKey`'s memoization strategy suggests a design conscious of avoiding redundant network calls when only irrelevant parameters (like hours) change.

## Usage Guidelines

Developers modifying `GATES` order must propagate changes consistently across OffloadDecisionCard, OffloadDecisionEngine, and OffloadGateLadder, since all three rely on index-based rung identity matching the proxy's short-circuit logic. When adding a new stage-2 classifier implementation, update `CLASSIFIER_IMPLS` and the proxy's switch statement together — never independently — and be aware of the 'service'/'http' rename when handling legacy data. When extending `resolveKey`'s memoization key, resist the temptation to include every parameter reflexively; only include values that actually affect route resolution, following the established precedent of excluding traffic window hours. Finally, any component consuming `onDirtyChange` must respect the poll-suspension contract to avoid corrupting in-progress preview computations during unsaved edits.


## Hierarchy Context

### Parent
- [OffloadDecisionEngine](./OffloadDecisionEngine.md) -- evaluateOffload() in offload-gates.ts reproduces the proxy's short-circuit gate order exactly (considered→route-allows→band→target→target-band→scope→transport→offloaded), because gate order determines which reason string is attributed to a call

### Siblings
- [OffloadGateLadder](./OffloadGateLadder.md) -- GATES array in offload-gates.ts is a const array where 'Index into GATES: where this route stopped, or RUNG_OFFLOADED if it moved' — index IS the rung number, order must match the proxy's short-circuit order exactly.
- [RecordedCallStrip](./RecordedCallStrip.md) -- CallStrip uses a native <input type='range'> deliberately instead of a custom slider, per the comment citing free keyboard/touch/screen-reader semantics and consistency with the settings dialog's bare checkboxes.


---

*Generated from 4 observations*
