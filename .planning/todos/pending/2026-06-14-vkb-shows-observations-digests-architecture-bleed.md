---
created: 2026-06-14T07:00:00.000Z
title: VKB graph displays Observation + Digest entities — architecture bleed from observations pipeline
area: knowledge-graph / VKB ingest pipeline / unified-viewer entity-type filter
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — out of scope of 56.1 bidirectional bridge)
relates_to_prior_work: 2026-06-11 digest "Prune km-core Graph and Fix VKB Source Labeling" — surgically removed 4066 Observation + 1343 Digest entities from km-core, preserved 82 Insights. If counts are now back, that cleanup was incomplete or a re-ingest path is re-adding them.
files:
  - integrations/unified-viewer/src/store/viewer-store.ts (the entity-type filter checkboxes — Observations/Insights/Digests)
  - integrations/unified-viewer/src/graph/visibility.ts (or wherever the entity-type filter applies)
  - integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts (does this still write Observation/Digest entity types into km-core?)
  - integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts (ontology classification — does it still produce Observation/Digest?)
  - lib/km-core/ (post-cleanup state of the graph)
  - .data/knowledge-graph/exports/general.json (canonical export — count current Observation/Digest entries)
---

## Operator-reported behavior

In `localhost:5173/viewer/coding` (VKB tab), filter row shows counts that include:
- 1 Observation
- 5 Insights
- 55 Digests

Operator's architectural objection (paraphrased): the semantic-analysis "Batch/Manual" learning system does not produce Observations; the Online "Auto" learning system should only produce Insights. Observations and Digests live in the observations pipeline (`.observations/observations.db`), not in the knowledge graph. So why does VKB carry any of these entity types?

Operator also reported the filter toggles produce no visible filtering effect — toggling redraws the entire graph unchanged.

## Verification recipe — DO before forming a theory

```bash
# 1. Count current Observation / Digest / Insight entities in canonical export
jq '[.nodes[] | .attributes.entityType] | group_by(.) | map({type: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 2. Same but filtered to coding team
jq '[.nodes[] | select(.attributes.team == "coding") | .attributes.entityType] | group_by(.) | map({type: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 3. Inspect the specific Observation node
jq '.nodes[] | select(.attributes.team == "coding" and .attributes.entityType == "Observation") | {label: .attributes.label, source: .attributes.source, created: .attributes.created_at, parent: .attributes.parent}' \
  .data/knowledge-graph/exports/general.json

# 4. Inspect a few Digest nodes
jq '[.nodes[] | select(.attributes.team == "coding" and .attributes.entityType == "Digest") | {label: .attributes.label, created: .attributes.created_at}] | .[0:5]' \
  .data/knowledge-graph/exports/general.json

# 5. Check if persistence-agent + coordinator still tag entities as Observation/Digest
grep -rn "entityType.*Observation\|entityType.*Digest" integrations/mcp-server-semantic-analysis/src/

# 6. Check the dedup type filter mentioned in MEMORY.md (coordinator.ts line 1050 area)
sed -n '1040,1070p' integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts
```

## Open questions

1. Was the 2026-06-11 cleanup complete? Has anything re-introduced Observation/Digest entities since? (Compare `.attributes.created_at` against the cleanup date.)
2. If the entities exist in km-core, the entity-type filter UI exposing them is correct — the question is whether they SHOULD exist. If the answer is "no", the fix is upstream in the ingest pipeline, not in the viewer.
3. If the entity-type filter UI does not actually filter (operator reported no-op), that is a separate filter-wiring bug similar to the Evidence/Pattern filter asymmetry already filed in `2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md`.

## Acceptance

- Documented decision: do Observation + Digest entities belong in km-core at all?
- If NO: ingest path stops writing them; existing ones purged; viewer UI hides the filter checkboxes for those types
- If YES (with rationale): the entity-type filter toggle actually narrows the rendered graph to the selected types
- Either way: filter toggles produce a visible change in the rendered graph

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. Third in a series of out-of-scope viewer issues surfaced in the same smoke session (the other two are filed as separate TODOs in this directory dated 2026-06-14).
