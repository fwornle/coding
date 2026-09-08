# RecordedCallStrip

**Type:** Detail

The axis is index, not time: binRows(shown, columns) and hourBoundaries(shown) from recent-call.ts convert the row sequence into fixed-width bins, with hour boundaries drawn as separate gridlines only when not binned.

# RecordedCallStrip — Technical Insight Document

## What It Is

RecordedCallStrip is a visualization component that renders a compact strip of recorded call history, built on `recent-call.ts` binning utilities (`binRows`, `hourBoundaries`) and a filtering function `selectInteresting()`. It sits as a child of OffloadDecisionEngine, providing an at-a-glance timeline of past routing decisions, with anomalies (non-routed outcomes) surfaced as unmissable markers. Unlike its sibling OffloadGateLadder, which visualizes gate-by-gate routing progression, RecordedCallStrip focuses on the temporal/sequential pattern of call outcomes.

## Architecture and Design

The core architectural decision is treating the x-axis as an **index axis rather than a time axis**. `binRows(shown, columns)` divides the row sequence into fixed-width bins based on position, not timestamp, while `hourBoundaries(shown)` computes gridlines that are only drawn as separate markers when the data is *not* binned. This dual-mode rendering (binned vs. unbinned) reflects a deliberate trade-off: at high density, positional binning preserves visual regularity, while at low density, real hour boundaries give temporal grounding.

A second key pattern is **never-average-away anomaly rendering**: any bin containing at least one call with `outcome !== 'routed'` always renders a ▲ marker above it, irrespective of how many ordinary "routed" calls share that bin. This is a deliberate anti-aliasing-avoidance decision — the design prioritizes anomaly visibility over strict proportional accuracy, ensuring rare problem signals aren't diluted by binning.

The component also makes an explicit accessibility-driven UI decision: it uses a native `<input type='range'>` rather than a custom slider, per an in-code comment citing free keyboard/touch/screen-reader semantics. This choice is stated to be consistent with the settings dialog's use of bare checkboxes — suggesting a broader team convention favoring native HTML form controls over custom-styled equivalents wherever feasible.

## Implementation Details

Filtering is handled by `selectInteresting()`, which defaults to showing only "interesting" calls, with a toggle (`StripFilter`) to reveal the full set. Because the server caps result sets at 500 rows, an `isSlice` flag is computed to detect when this cap makes the visible span shorter than the requested `windowHours` — surfacing a warning so users don't mistake a truncated slice for the full time window.

The binning pipeline (`binRows`, `hourBoundaries` in `recent-call.ts`) converts the raw row sequence into a fixed-column layout, decoupling visual width from actual elapsed time. The anomaly-detection logic checks `outcome !== 'routed'` per call, then aggregates at the bin level to decide marker placement, independent of the ordinary-call count in that same bin.

## Integration Points

RecordedCallStrip is a child of **OffloadDecisionEngine**, which orchestrates `evaluateOffload()` in `offload-gates.ts` — the same gate-ordering logic that determines routing outcomes shown in this strip. Its sibling **OffloadDecisionCard** shares the same `GATES` array and `evaluateOffload()` logic but operates in two data modes: 'config' (resolving routes live via `/api/llm/routing/resolve`) and 'recorded' (counting calls from `recent`, the same data source RecordedCallStrip visualizes). Another sibling, **OffloadGateLadder**, uses the `GATES` const array's index as the rung number, reflecting a system-wide convention where gate order in `offload-gates.ts` must mirror the proxy's actual short-circuit evaluation order exactly — RecordedCallStrip's "routed" vs. anomaly distinction derives from this same gate-order-driven `outcome` classification.

## Usage Guidelines

Developers extending RecordedCallStrip should preserve the index-based binning axis rather than reintroducing time-proportional layouts, since hour boundaries are intentionally suppressed when binning is active to avoid visual conflicts. Any new outcome classification must respect the "anomalies always render" rule — never suppress or average an anomaly marker regardless of bin population, since this is the core value proposition of the strip. When the 500-row cap is in effect, always propagate the `isSlice` warning to avoid misleading users about window completeness. Finally, resist replacing the native range input with custom slider components unless the accessibility rationale (keyboard/touch/screen-reader support, consistency with settings dialog checkboxes) is explicitly revisited.


## Hierarchy Context

### Parent
- [OffloadDecisionEngine](./OffloadDecisionEngine.md) -- evaluateOffload() in offload-gates.ts reproduces the proxy's short-circuit gate order exactly (considered→route-allows→band→target→target-band→scope→transport→offloaded), because gate order determines which reason string is attributed to a call

### Siblings
- [OffloadGateLadder](./OffloadGateLadder.md) -- GATES array in offload-gates.ts is a const array where 'Index into GATES: where this route stopped, or RUNG_OFFLOADED if it moved' — index IS the rung number, order must match the proxy's short-circuit order exactly.
- [OffloadDecisionCard](./OffloadDecisionCard.md) -- Component toggles between mode 'config' (counts routes via resolveKey/pooled requests to /api/llm/routing/resolve) and 'recorded' (counts calls from `recent`), sharing GATES/evaluateOffload but changing the unit word.


---

*Generated from 4 observations*
