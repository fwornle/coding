# Phase 60-09 Context — L2 Entity Classification so the Ontology Filter's L1→L2 Tree Lights Up

**Created:** 2026-06-20 — during the 60-07 Task 3 operator checkpoint walkthrough.
**Decision locked (operator, 2026-06-20):** classify entities at L2 (the *correct* fix), not a display-only tree or a rescope. Entities must carry an L2 ontology class so the filter shows real per-L2 counts and L2 selection actually filters.

## Why this exists — the 60-07 Task 3 checkpoint FAILED (SC#5 still PARTIAL)

The checkpoint asked: confirm `/viewer/coding` Ontology Class filter renders L0→L1→L2 (`labelCount ≥ ~15`). Observed: **4 flat checkboxes only** — `System(1)`, `Component(8)`, `Detail(671)`, `SubComponent(326)`. No L2 children, no disclosure triangles, no `Project` L0 anchor.

Important correction to the 60-07-SUMMARY's prediction: the SUMMARY blamed "Deviation 3" (obs-api sourcing its registry from bundled km-core instead of `.data/ontologies/`). **That blocker is RESOLVED** — the API on `:12436/api/v1/ontology/classes?withDisplay=true` now serves the full hierarchy (1 L0, 3 L1, 10 L2) and the viewer fetches it (confirmed via perf entries). The gap moved entirely to a **viewer + classification data** problem.

## Root cause (two defects)

In `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx`, API-driven path (coding tab, `groupingSchema` omitted), the L0/L1/L2 tree is built by intersecting the registry classes with `availSet` — the `ontologyClass` values that **actual entities carry**:

```js
// ~line 457 (L2 children):
if (c.level === 2 && c.parent && availSet.has(c.name)) { ... }   // availSet never has L2 names
// ~line 466 (L0 anchors):
.filter((c) => c.level === 0 && availSet.has(c.name))
```

Data probe (km-core export) — distinct `ontologyClass` actually on entities:
```
Project:4, Component:8, SubComponent:326, Detail:672, Insight:46, System:1, Digest:86
any entity carries an L2 class name? -> NONE
```

1. **L2 wipeout (primary):** entities are only classified at L1 (Component/SubComponent/Detail). No entity has `ontologyClass === "LiveLoggingSystem"` etc., so the `availSet.has()` guard empties `l2ByParent`; every L1 falls through to `l1Flat`. → the 4 flat rows.
2. **level-None drop (secondary):** the API returns `Project`, `Insight`, `Digest` with `level: null`, so they match no level bucket and are dropped from the filter **despite having entities** (Project 4, Insight 46, Digest 86). `Project` should be an L0 anchor.

## The L2 → L1 taxonomy (from the live API)

| L2 class | L1 parent |
|----------|-----------|
| LiveLoggingSystem, ConstraintMonitor, KnowledgeManagement, BatchSemanticAnalysis, RapidLlmProxy, DockerizedServices | Component |
| OnlineObservation, OnlineDigest, OnlineInsight | Detail |
| EtmDaemon | SubComponent |

(L1 chain in the registry: Component=root, SubComponent=root, Detail→parent SubComponent.)

## Scope the plan must cover (4 work areas — cross-system)

1. **Classification pipeline (System B, submodule + Docker rebuild):** extend `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` to assign an L2 sub-class consistent with the entity's L1 class, drawn from the closed L2 vocabulary above. **Open Q:** LLM-semantic classification (L2 taxonomy in the prompt) vs path/keyword heuristics vs hybrid — and how an entity's content maps to e.g. RapidLlmProxy vs DockerizedServices.
2. **Re-classification migration:** backfill L2 on the existing ~1140 entities. **Open Q:** dedicated one-shot repair script (cf. Plan 60-04's `repair-ck-ontology-class.mjs`) vs a full wave-analysis/ukb re-run. Cost matters if LLM-driven.
3. **Upstream data fix:** make `Project` `level: 0` (HIERARCHY_ROOTS / `.data/ontologies/`) so it surfaces as an L0 anchor alongside System.
4. **Viewer fix (`OntologyFilter.tsx`):** once entities carry L2, the existing `availSet.has()` guards work for L2; ALSO render level-None classes entities carry (Insight/Digest as flat selectable rows) and surface Project as L0. Add tests; re-run the SC#5 eval checks.

## Acceptance (re-run 60-07 Task 3 checks after)
- `labelCount ≥ ~15`; L0 = {System, Project}; L1 = {Component, SubComponent, Detail} expandable; the 10 L2 children render with real non-zero counts under their parents; `Typed Views` absent.
- Selecting an L2 class filters the graph to that L2's entities (now meaningful).
- Then flip 60-VERIFICATION.md SC#5 PARTIAL→PASS and close Phase 60.

## Notes
- `autonomous: false` — has live re-classification + operator visual re-verify checkpoints.
- Submodule rule: `cd integrations/mcp-server-semantic-analysis && npm run build` + Docker rebuild (CLAUDE.md).
- Evidence screenshots: `screenshots/sc5-ontology-section-2026-06-20.png` (the 4-flat-row state), `screenshots/sc5-ontology-filter-2026-06-20.png`.
