---
title: LSL timeline tick selection almost always resolves to LiveLoggingSystem (ancestry noise)
created: 2026-06-20
priority: medium
resolves_phase: null
context:
  - integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx
  - integrations/unified-viewer/src/graph/useNodeToBucketsIndex.ts
  - .planning/phases/61-lsl-timeline-okb-routing-honesty/61-VERIFICATION.md
---

# LSL tick → entity selection collapses to LiveLoggingSystem for nearly every session

## Symptom (operator-reported, Phase 61 visual verification, 2026-06-20)

Clicking almost any tick in the LSL timeline strip opens the **LiveLoggingSystem**
entity in the detail panel, regardless of which session/time bucket was clicked.
The selection is therefore rarely useful — the operator cannot drill into the
specific entities a given session actually produced.

## Root cause (preliminary)

A tick is a time-bucket of observations. `onTickClick` resolves the bucket's
`entityIds` **up the ontology ancestry** to a graph-visible focal node via
`pickFirstResolvable` / `pickAllResolvable` (`LslTimelineStrip.tsx` ~line 588-607).
Because nearly all LSL observations are descendants of the **LiveLoggingSystem**
component in the hierarchy, the common visible ancestor they collapse to is LLS.

There is already an **LLS-suppression** mechanism (`noiseAncestors`, Phase 60
Plan 06, Decision C) that drops LLS from the halo *when another visible ancestor
exists* — and it `Logger.warn`s the suppression rate. But when LLS is the **only**
graph-visible ancestor for a session's entities, suppression cannot drop it, so
the focal falls back to LLS (or to `pickFirstResolvable` which also returns LLS).

## Likely fix directions (to scope in a future phase)

1. Prefer the **most specific** resolvable entity (deepest in the hierarchy /
   the actual leaf observations' nearest non-noise ancestor) rather than the
   first/topmost resolvable ancestor.
2. When only LLS resolves, fall back to **sidebar-only mode showing the session's
   raw bucket entities** (a list) instead of forcing a single focal node.
3. Investigate whether more session entities *should* be graph-visible (the
   bucket→graph visibility intersection may be too narrow, e.g. Observations are
   hidden from the graph so only their LLS ancestor survives).

## Out of scope for Phase 61

Phase 61 only addressed LSL timeline *honesty* (cap badge, `1y` rename, bi-source
tick color) + OKB routing. This tick-resolution behavior is pre-existing
(Phase 56 / 60 selection logic) and was surfaced — not introduced — during
Phase 61 verification.
