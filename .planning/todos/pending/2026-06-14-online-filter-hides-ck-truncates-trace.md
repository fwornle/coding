---
created: 2026-06-14T06:50:00.000Z
title: Online learning-source filter hides CollectiveKnowledge, truncating ancestry traces at project level
area: unified-viewer / filter + hierarchy visibility
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — out of scope of 56.1 bidirectional bridge)
resolves_phase: 60
files:
  - integrations/unified-viewer/src/store/viewer-store.ts (learningSource filter logic)
  - integrations/unified-viewer/src/graph/ancestry.ts (resolveToVisibleAncestor / computeAncestryPath)
  - integrations/unified-viewer/src/graph/visibility.ts (or wherever the source filter pre-computes visibleIds)
  - .data/knowledge-graph/exports/general.json (verify CK node's `source` field)
---

## Problem

When the **Online** learning-source filter is active in `localhost:5173/viewer/coding`, the system root node `CollectiveKnowledge` (CK) is absent from the rendered graph. As a result, the focal ancestry trace from a selected leaf entity terminates at the project level (e.g., `Coding`) instead of reaching CK.

Observed 2026-06-14 during Phase 56.1 visual smoke:
- Selected node: `LLM Token Usage Tracking — Proxy Instrumentation and Dashboard` (Detail / L?)
- Filter: Online only
- Trace shown: selected → `Coding` (project), then stops
- CK node nowhere in the rendered graph (faded out / filtered)
- Node count footer: 144 of 1000

The trace logic is correct given the visibility set it receives — Phase 56.1 Plan 02's `resolveToVisibleAncestor` stops at the nearest visible ancestor. The bug is upstream: CK gets filtered out by Learning Source, which truncates every trace whose path must cross CK.

## Why this isn't a Phase 56.1 regression

Phase 56.1's scope is the bidirectional many-to-many bridge (timeline ↔ graph ↔ sidebar). The learning-source filter behavior is independent — it was the same before 56.1 and would have presented the same symptom if a user had selected any leaf node with the Online filter active. 56.1 just made the truncation more visible because trace paths are now drawn from the focal node on every selection.

Recent context (from session memory, 2026-06-11): CK was restored as the System root and linked to Projects to give path traces a complete hierarchy. The fix evidently did not also reconcile how the Online learning-source filter classifies hierarchy roots — CK appears to be tagged as Batch / UKB-learned only.

## Likely root cause to confirm

Verify by reading the entity in the canonical export:
```bash
jq '.nodes[] | select(.attributes.label == "CollectiveKnowledge") | .attributes' \
  .data/knowledge-graph/exports/general.json
```

If `source` is `"batch"` (or whatever the Batch-only marker is) and the Online filter strips non-Online nodes, that's the bug. The same check applies to Project-level nodes that may also be batch-tagged.

## Two viable approaches

**Approach A — Make hierarchy roots source-agnostic (recommended).**
Tag CK + Project-level nodes as `source: 'both'` (or whatever the union marker is). They are structural anchors; ancestry must reach them regardless of which learning source the leaves came from.

**Approach B — Make the filter exempt hierarchy roots.**
Change the Learning Source filter predicate to always include nodes at L0 (System) and L1 (Project) regardless of `source` field.

Approach A is cleaner — keeps filter logic uniform. Approach B is a smaller diff but leaks structural knowledge into the filter.

## Acceptance

- Selecting any leaf node with Online filter active shows the full ancestry trace to CK
- Toggling Batch ↔ Online ↔ Combined never hides CK or any Project-level node
- Footer node count includes the +1 (CK) and +N (Projects) under Online filter
- A unit test in `src/store/viewer-store.test.ts` (or similar) asserts that filtering by `learningSource: 'online'` always returns CK + Projects in the visibility set

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. Image referenced in the smoke session showed an L? Detail node selected, Coding project being the trace terminus, CK absent.
