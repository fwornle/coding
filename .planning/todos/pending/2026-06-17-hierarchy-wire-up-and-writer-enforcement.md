---
created: 2026-06-17
status: pending
captured_via: gsd-execute-phase 59 mid-execution interrupt
resolves_phase: ""
related_phase: 60
priority: high
tags:
  - knowledge-graph
  - hierarchy
  - ontology
  - writer-enforcement
  - vkb-viewer
discovered_in: unified-viewer @ localhost:5173/viewer/coding
---

# Hierarchy Wire-Up + Writer-Side Enforcement (Project → Component → SubComponent → Detail)

## Problem (discovered 2026-06-17 mid-Phase-59)

Operator inspected `DynamicImporter` in the unified viewer and saw `Parent: —` despite the node being team=coding with `hierarchyLevel: 2`. Diagnostic queries surfaced the structural reality:

- **Nodes carry no `parent` attribute.** The Project→Component→SubComponent→Detail hierarchy is asserted via the per-node `entityType` + `hierarchyLevel` fields but never wired through edges.
- **`contains` is an edge, not a node attribute.** The viewer's right pane reads `node.parent` and shows "—" because nothing populates it.
- **No Project node has any outgoing `contains` edge.** The 4 Project nodes (`Coding`, `Normalisa`, `Timeline`, `DynArch`) are floating roots.
- **6 L1 Components are floating islands.** `LiveLoggingSystem`, `KnowledgeManagement`, `CodingPatterns`, `ConstraintSystem`, `LLMAbstraction`, `DockerizedServices` all lack incoming `contains` edges.
- **24 hierarchy nodes total** (Components + SubComponents + Details) lack any incoming `contains` edge.

Diagnostic command run (corrected schema; the field is `.attributes.entityType`, not `.Class`):

```bash
# Count hierarchy orphans (no incoming contains)
jq '
  [.nodes[] | select(.attributes.entityType=="SubComponent" or .attributes.entityType=="Component" or .attributes.entityType=="Detail")] as $hier |
  [.edges[] | select(.attributes.type=="contains") | .target] | unique as $contained |
  [$hier[] | select((.key as $k | $contained | index($k)) | not)] | length
' .data/knowledge-graph/exports/general.json
# → 24
```

## Two fixes (operator confirmed: implement BOTH)

### Fix #1 — One-shot wire-up sweep script

Scan `entityType + hierarchyLevel + team` and emit missing `contains` edges to connect orphan hierarchy nodes back to their Project root. Pattern mirrors `scripts/repair-orphan-digest-insight-edges.mjs` (Phase 59-04): probe-before-write so re-runs are no-ops, log unresolved cases instead of fail-fast, dry-run mode by default.

Edge wiring rules:
- Each L1 Component → `Coding` Project (if `team=coding`), or the matching Project for other teams.
- Each L2 SubComponent → its L1 Component, mapping by name (e.g., `LslWriter` → `LiveLoggingSystem`).
- Each L3 Detail → its L2 SubComponent.

Mapping resolution will need either (a) a hand-curated mapping in the script, or (b) inference from incoming-edge neighbours of the candidate's existing edges (DynamicImporter has a `contains` edge to ModuleLoader → infer DynamicImporter belongs under whichever L1 Component should contain ModuleLoader, then chase upward).

### Fix #2 — Writer-side enforcement

When the consolidator / ontology-classifier mints a node with `entityType ∈ {Component, SubComponent, Detail}`, require a `parent` argument and emit the `contains` edge atomically — same pattern as Phase 59-02's Digest→Observation `derivedFrom` fix (capture mintedId from putEntity, emit edge in the same try-block).

Touch points:
- `src/live-logging/ObservationConsolidator.js` — wherever Components/SubComponents/Details get minted from observation context.
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` — Wave-analysis path (batch UKB run).
- Reject mints that arrive without a resolvable parent → log + skip (don't half-write).

## Why a new phase

This is substantial cross-cutting work that affects two ingestion pipelines (online consolidator + batch wave-analysis), needs a one-shot repair sweep, and touches viewer rendering downstream. Per `discuss-phase` → `plan-phase` → `execute-phase` cadence, route through `/gsd-phase` to schedule.

## Suggested phase metadata

- **Phase number:** 60.5 or 61 (depending on Phase 60's UI rendering work — if Phase 60 surfaces the L2 lower-ontology groupings, this hierarchy work is a prerequisite).
- **Goal:** Every hierarchy node (Component, SubComponent, Detail) is reachable via `contains` edges from its Project root in `:3848/api/v1/graph`. Writers reject orphan mints. One-shot sweep brings the 24 currently-orphan hierarchy nodes into the graph topology.
- **Requirements:** New (e.g., HIERARCHY-WIREUP-01, HIERARCHY-ENFORCE-01).
- **Depends on:** Phase 57 (lower-ontology classes); Phase 59 (writer-atomicity pattern reusable).

## Investigation evidence saved

- Diagnostic queries: `MEMORY.md` references this TODO; query exact form is in this file (above).
- Dry-run output from Phase 59-04 repair script can be reused as a pattern reference: `.data/phase59-04-dry-runs/` (moved here during Phase 59 Wave 2 cleanup).
