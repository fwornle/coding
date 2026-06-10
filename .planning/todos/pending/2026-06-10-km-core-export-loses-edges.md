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

## Root cause (confirmed 2026-06-10T21:50Z via investigation)

**The Phase 44 migration ported entity nodes but NOT relations from the legacy store into the new km-core LevelDB. VKB at :8080 still reads from a frozen 2026-05-24 legacy export, which is why it still shows 1124 relations and looks "fine"; the unified viewer correctly reads the new km-core store, which never received the relations.**

### Evidence chain

| Source | Schema | Nodes | Edges | Date |
|--------|--------|-------|-------|------|
| `.data/exports/coding.json` (read by VKB at :8080 via `memory-visualizer/api-server.py` → `lib/vkb-server/db-query-cli.js`, symlinked at `.data/knowledge-export/coding.json`) | LEGACY `{entities, relations}` with `from/to/relationType` keys | 928 | **1124** | 2026-05-24 (frozen) |
| `.data/knowledge-graph/leveldb/` (live km-core store; read by `/api/v1/*` on :12436 and by `/viewer/coding` on :5173) | km-core Phase 44 graphology `{nodes, edges, attributes, options}` | 1177 | **0** | 2026-06-10 (live) |
| `.data/knowledge-graph.legacy-pre-42.2.bak*` (both backups) | km-core graphology, opened via `GraphKMStore` | 0 | 0 | empty stubs (12K / 9.5M files but `store.open()` reports 0/0) |

Key facts:
- The two schemas have **zero node-key overlap** — the legacy export uses entity-name keys; the new store uses UUIDv7 keys. So a relation in the legacy export referring to `from: "CollectiveKnowledge"` does NOT resolve to the new node `019e5559-69cf-75e2-9e01-2bdc4bdab936` (also named CollectiveKnowledge) without a name-resolution pass.
- `/api/v1/stats` → `{nodeCount: 1177, edgeCount: 0, orphanCount: 1177, connectivity: 0}`. The unified viewer is faithfully reporting reality.
- `/api/v1/snapshots` returns two snapshots: `phase-44-verify-A` (2026-06-04) and `phase-44-verify-B` (2026-06-05). Both inspected via `git show --stat` are **metadata-only commits** (no files diff in git — actual snapshot data lives elsewhere). Both already had 0 edges when created.
- The store's `lastUpdated: 2026-06-10T19:30:36Z` — it IS being written to. Live ObservationWriter / Digest / Insight paths add nodes (consistent with node count growth 928 → 1177) but **none of them call `addRelation`**. Verified via grep:
  - `src/live-logging/ObservationWriter.js` — zero `addRelation` calls
  - `src/observations/`, `src/consolidation/` — zero `addRelation` calls
  - `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` — zero `addRelation` calls
- The only live edge-writing paths in the codebase are:
  - `wave-controller.persistWithKmCore` (batch wave-analysis pipeline)
  - `lib/km-core/dist/adapters/online/reprojectFromOnlineStore.js:295`
  - `lib/km-core/dist/maintenance/mergeEntities.js:157, 193`
  - REST `POST /api/v1/relations`
- **Last `wave-analysis` trace: 2026-05-29** (12 days ago). The traces store summaries only; the recorded `entityCounts` per wave are non-zero (wave1=8, wave2=23, wave3=19), but the trace doesn't reveal whether `relationshipsStored` was non-zero. We can't directly check from disk evidence whether the May-29 wave persisted any relations.

### Diagnosis split

Two non-exclusive possibilities:

**A) "Run wave-analysis" path.** If wave-controller's relation persist is functional today, then simply running a fresh `wave-analysis` will repopulate edges (`contains` from anchor-pass + agent-emitted relationships). The store's apparent "edges=0" reflects "wave-analysis hasn't run since the schema cutover."

**B) "Persist path is broken" path.** If wave-controller's relation persist silently fails (or `storeRelationship` throws but is swallowed by the try/catch wrapper at `wave-controller.ts:2466`), then running wave-analysis won't fix it. The `relationshipErrors` count would be high in the logs but the trace summary wouldn't necessarily surface it.

The fastest disambiguation is to **run wave-analysis end-to-end and watch the docker logs for the `[WaveController] km-core persistence complete` line + check `relationshipsStored` count**.

### Why VKB looks healthy and unified doesn't

VKB at :8080 (`memory-visualizer`) is a frozen artifact. It reads `.data/exports/coding.json` (last refreshed 2026-05-24 by `chore: refresh knowledge-graph export` commit `576122898`) and has 1124 relations baked in. It has not been re-synced from the post-Phase-44 km-core store. So:

- VKB shows a connected graph because it's looking at a 2.5-week-old snapshot
- Unified viewer shows a disconnected graph because it's looking at live truth
- The unified viewer is the more honest of the two; VKB is showing stale data

After this bug is fixed, VKB and unified-viewer would converge — or VKB should be retired in favor of unified.

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

## Two viable fix paths

### Path 1 — TRIED 2026-06-10T19:53Z — FAILED INSTANTLY (and the failure IS the diagnosis)

Triggered wave-analysis via `mcp__semantic-analysis__execute_workflow` with `{workflow_name: "wave-analysis", async_mode: true, parameters: {team: "coding"}}`. Sticky debug state reset first. Workflow runner spawned PID 23747 inside coding-services container, lasted <700ms, exit code 1.

Failure log (`/coding/.data/workflow-logs/wf_1781121216243_lqju8p.log`):
```
[2026-06-10T19:53:37.040Z] ERROR: [WaveController] km-core adapter bootstrap failed (fatal — no legacy fallback)
  error: "Database failed to open"
[2026-06-10T19:53:37.040Z] ERROR: [WaveController] Fatal error during wave execution
  error: "Database failed to open"
[2026-06-10T19:53:37.051Z] EXIT: code=1
```

Root cause: **LevelDB lock contention.** Phase 44 Plan 12 made `obs-api` the single owner of `.data/knowledge-graph/leveldb/` to prevent concurrent-opener WAL corruption. That obs-api process runs continuously on the HOST and holds an exclusive LevelDB write lock 24/7. The wave-analysis pipeline runs INSIDE the coding-services Docker container, and `WaveController` initialization opens its own `GraphKMStore` against the same `.data/knowledge-graph/leveldb/` path via the bind-mount. Result: `LEVEL_LOCKED` → `Database failed to open` → wave-controller bootstrap aborts before any agent runs.

**Implication:** wave-analysis has been STRUCTURALLY BROKEN since the Phase 44 cutover (~2026-06-04). The "last successful run was 2026-05-29" timing exactly matches the pre-cutover state. Every attempt since cutover has failed at bootstrap. No edges have been added since.

This also explains the earlier prober probe failure: when I tried `node scripts/.tmp-probe-kmstore-edges.mjs` earlier in this investigation, it threw the same `Database failed to open` / `LEVEL_LOCKED` error. obs-api on host is grabbing the lock the moment the container starts (or never releases it across runs).

The TODO has thus pivoted from "data integrity bug" to "wave-analysis pipeline is structurally incompatible with the Phase 44 single-owner design." Both are true; the single-owner conflict is the IMMEDIATE blocker. The Phase 44 migration not porting legacy relations is a SEPARATE prior bug — even if Path 2 backfill restored edges, every subsequent wave-analysis run would still fail until the lock contention is resolved.

### Path 1.5 — Resolved fix paths (in priority order)

Three options for the lock contention:

**1.5a — Wave-analysis pushes through obs-api REST.** Replace `WaveController`'s direct `GraphKMStore` init with calls to `POST /api/v1/relations` (and `POST /api/v1/entities` if needed). Same API contract the unified-viewer uses. Architecturally clean. Estimated change: ~1 day in `wave-controller.ts` + `km-core-adapter.ts` swap.

**1.5b — Shared GraphKMStore handle via IPC.** obs-api exposes a Unix domain socket or in-process RPC; wave-controller connects to that instead of opening LevelDB directly. More invasive; touches km-core itself.

**1.5c — Operational workaround (NOT a real fix).** Stop obs-api → run wave-analysis → restart obs-api. Works once. Leaves the structural bug. Useful as a one-shot to get edges populated NOW while 1.5a is being planned.

### Path 2 — Backfill from legacy export, then debug persist (if Path 1 reveals broken persist)

(Still valid as a complementary fix to repopulate the 1124 pre-cutover legacy relations into the new graph schema with name-resolution. Should be sequenced AFTER 1.5a so the new wave-analysis adds NEW edges on top of the backfilled legacy ones.)

```bash
# Reset sticky debug state (MEMORY.md warning)
curl -s -X POST http://localhost:3033/api/ukb/mock-llm        -H "Content-Type: application/json" -d '{"enabled": false}'
curl -s -X POST http://localhost:3033/api/ukb/single-step-mode -H "Content-Type: application/json" -d '{"enabled": false}'

# Trigger wave-analysis (PRODUCTION mode, not debug)
# Via MCP: mcp__semantic-analysis__execute_workflow workflow_name="wave-analysis" async_mode=true parameters={"team":"coding"}

# Watch docker logs in another terminal
docker logs -f coding-services 2>&1 | grep -E "WaveController|persistence complete|relationshipsStored"

# After completion, re-check:
curl -s http://localhost:12436/api/v1/stats | python3 -m json.tool
# If edgeCount > 0 → Path 1 worked, this is just "wave hasn't run since cutover"
# If edgeCount == 0 → Path 2 needed (persist path is broken)
```

### Path 2 — Backfill from legacy export, then debug persist (if Path 1 reveals broken persist)

```bash
# Two sub-paths:
# 2a) Write a backfill script that reads .data/exports/coding.json (1124 legacy relations),
#     name-resolves from/to against the live km-core store (entity name → UUIDv7), and
#     issues store.addRelation() for each. This restores connectivity immediately.
#     Risk: legacy relations are 17 days old; some entities may have been renamed/merged
#     and the legacy from/to names won't resolve cleanly. Errors should be logged not thrown.
#
# 2b) Bisect persist path. Read wave-controller.persistWithKmCore (line 2380+ in src/agents/wave-controller.ts).
#     The relationship sweep iterates over relationships (line 2450) and calls
#     this.kmCoreAdapter.storeRelationship → store.addRelation. If storeRelationship
#     throws and the try/catch at 2466 swallows it, the trace would still show
#     "completed". Add structured logging of relationshipErrors > 0 to surface the swallow.
#     Look at storeRelationship in km-core-adapter.ts:493-516 — it requires that BOTH
#     from-entity and to-entity already exist in the store. If wave persists entities in
#     parallel and the relationship sweep runs before the entity sweep completes for some
#     entity, the findEntityByName fails. That would explain partial-or-zero edge persist.
```

## Suggested investigation order

1. **Run Path 1 first.** It's the cheapest disambiguator.
2. **Read MEMORY.md for the 2026-05-26 "Knowledge Base Edge Regression Root Cause Identified and Fixed" digest details.** That fix may have been reverted by a subsequent commit (worth checking `git log --all --grep="edge"` since 2026-05-26 for any revert).
3. **If Path 1 doesn't restore edges:** spawn a `/gsd-debug` session focused on `wave-controller.persistWithKmCore` relationship sweep. The hypothesis to test first is "storeRelationship is throwing on findEntityByName because the entity sweep hasn't fully committed before the relationship sweep starts."

## Why this matters (updated)

Without edges, ALL unified-viewer surfaces that depend on graph topology are broken:
- KG mode renders a shotgun blast of 1177 orphans
- Issue Triage (OKB) can't walk Symptoms / Root Causes / Resolutions chains because there are no edges
- Trending Patterns can't show entity → trend relationships
- HierarchyNavigator can't render the Project → Component → SubComponent → Detail tree

This is **the single largest blocker** to Phase 55's parity goal. The 8 VKB-feature gaps and the 6 OKB-feature gaps in 55-VERIFICATION.md are downstream cosmetics by comparison.

## Scope

Cross-cuts at least Phase 10 (graph completion / pre-export integrity), Phase 42.x (km-core migration), and Phase 55 (viewer). May warrant a dedicated phase or a debug session via `/gsd-debug` once root cause is localized.
