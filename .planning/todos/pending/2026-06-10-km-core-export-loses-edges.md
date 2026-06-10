---
created: 2026-06-10T21:30:00.000Z
title: km-core export has 1174 nodes / 0 edges; unified /viewer/coding renders shotgun-blast of orphans
area: km-core / wave-analysis / graph export
relates_to_phase: 55 (surfaces the bug) + cross-cuts Phase 10 ("Embeddings not reaching GraphDB" — likely same root cause class)
files:
  - .data/knowledge-graph/exports/general.json   (the canonical export; 0 edges)
  - integrations/mcp-server-semantic-analysis/src/wave-controller.ts   (wave persist path)
  - integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts   (relation persist)
  - integrations/mcp-server-semantic-analysis/src/storage/graphology-export.ts (or equivalent — the exporter)
  - scripts/observations-api-server.mjs   (serves /api/v1/relations — returns [])
  - integrations/unified-viewer/src/   (consumer — correctly shows the broken state)
---

## Problem

The canonical Phase 44 km-core export at `.data/knowledge-graph/exports/general.json` has **1174 nodes and 0 edges**:

```bash
$ python3 -c "import json; d=json.load(open('.data/knowledge-graph/exports/general.json')); print('nodes:', len(d['nodes']), 'edges:', len(d['edges']))"
nodes: 1174  edges: 0
```

The Phase 44 REST endpoint inherits this:

```bash
$ curl -s http://localhost:12436/api/v1/relations
{"success":true,"data":[]}
```

The unified viewer at `/viewer/coding` correctly reports the broken state: `1115 nodes / 0 edges / 1115 orphans / 0% connectivity` in its StatsBar.

The legacy VKB viewer at `localhost:8080` shows the same coding KG with **1000+ relations** because it reads from its **own legacy SQLite store** (`/api/relations` on :8080), not from km-core:

```bash
$ curl -s http://localhost:8080/api/relations | jq '.relations | length'
1000
$ curl -s http://localhost:8080/api/relations | jq '[.relations[].relation_type] | group_by(.) | map({type: .[0], count: length})'
[{"contains": 791}, {"related_to": 201}, {"parent-child": 7}, {"includes": 1}]
```

So the relations exist somewhere — just not in the km-core unified backing store / export. Phase 55's unified viewer is the messenger surfacing this; the bug is upstream.

## Likely root causes

1. **wave-analysis persist step doesn't write relations to LevelDB.** The wave controller may be writing entities only and skipping the relation graph. Trace `wave-controller.ts` `persistEntities` / `persistRelations` and confirm relations actually land in the LevelDB graph.
2. **`exportToGraphology()` (or the equivalent exporter) drops relations.** The store may have edges but the export step iterates only nodes. Confirm whether the LevelDB graph itself has edges; if yes, the bug is in the exporter.
3. **Phase 42.x ingest migration may have lost relations.** When the km-core migration from the legacy SQLite store ran, the relation table may have been dropped or unmapped.

Likely class: same as the "Embeddings not reaching GraphDB" item in MEMORY.md / Phase 10 — relations don't reach the unified backing store, just like embeddings.

## Reproduction

```bash
# 1) Confirm export is edge-less
python3 -c "import json; d=json.load(open('.data/knowledge-graph/exports/general.json')); print('edges:', len(d.get('edges', [])))"
# Expected: 0

# 2) Confirm REST endpoint is empty
curl -s http://localhost:12436/api/v1/relations
# Expected: {"success":true,"data":[]}

# 3) Confirm VKB legacy still has them
curl -s http://localhost:8080/api/relations | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('relations', [])))"
# Expected: 1000+

# 4) Confirm unified viewer reports the broken state
# Open localhost:5173/viewer/coding — StatsBar shows orphans=N, connectivity=0%
```

## Why this matters

Every consumer of the Phase 44 km-core unified API is currently rendering a relation-less graph:

- Unified `/viewer/coding`: looks like a shotgun blast of 1115 isolated dots
- Any downstream insight generation that walks relations gets `[]`
- The whole "unified KM-Core" narrative is broken — the legacy stores still hold the truth
- Phase 55's effort to bring the unified viewer to VOKB/VKB parity is permanently blocked at the "show me a connected graph" layer because there are no edges to show

This is the **largest single blocker** to Phase 55 closing — bigger than the OKB contract bridge, bigger than any of the C-1..C-8 VKB-feature gaps.

## Suggested first step

1. Read `wave-controller.ts` `persistEntities` / `persistRelations` / `persistFromOperator`. Confirm whether `persistRelations` is even called, and whether it writes to LevelDB.
2. Probe LevelDB directly (not via the export):
   ```bash
   ls -la .data/knowledge-graph/leveldb/
   # then use a leveldb CLI to count edges OR add a debug script
   ```
3. If LevelDB has edges but `general.json` doesn't → bug is in the exporter.
4. If LevelDB has no edges → bug is in the persist step (wave-analysis isn't writing relations).
5. Compare to Phase 41 (online-learning adapter) — does the online ingest persist relations correctly?

## Scope

Cross-cuts at least Phase 10 (graph completion / pre-export integrity), Phase 42.x (km-core migration), and Phase 55 (viewer). May warrant a dedicated phase or a debug session via `/gsd-debug` once root cause is localized.
