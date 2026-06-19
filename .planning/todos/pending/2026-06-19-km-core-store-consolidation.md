---
title: km-core store consolidation — collapse :3848 + :12436 into one source of truth
created: 2026-06-19
priority: high
type: design-proposal
resolves_phase: null
context:
  - scripts/observations-api-server.mjs            # obs-api :12436 (host, launchd) — the writer
  - integrations/mcp-server-semantic-analysis/src/sse-server.ts   # :3848 (container) — SSE/MCP + vestigial /api/v1
  - integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts
  - integrations/mcp-server-semantic-analysis/src/tools.ts
  - integrations/unified-viewer/src/config/system-endpoints.ts
  - docker/docker-compose.yml                       # .data bind mount (line 77)
  - memory/reference_viewer_reads_12436.md
---

# km-core store consolidation

## Problem (one sentence)

Two+ `GraphKMStore` instances back the coding knowledge graph from the same on-disk
directory but maintain **independent in-memory graphs** that race to overwrite a single
shared JSON export — so repairs land on "the wrong graph," metrics disagree with the
rendered view, and edge-only repairs can be silently erased on restart.

## Findings (verified 2026-06-19)

### The two (really N) stores

| Store | Port | Process | LevelDB lock | Role |
|---|---|---|---|---|
| obs-api `GraphKMStore` | **12436** | host launchd `com.coding.obs-api` | **HOLDS** the lock | the **writer** (ObservationConsolidator/Writer) + typed views `/api/coding/*` + **what unified-viewer reads** |
| sse-server `GraphKMStore` | **3848** | Docker `coding-services` | cannot lock → `LEVEL_NOT_FOUND` | SSE/MCP workflow surface (`/sse`, `/workflow-events`) + **vestigial** `/api/v1` km-core REST |
| wave-controller / tools | (in `coding-services`) | per-operation `new GraphKMStore(...)` | cannot lock → JSON hydrate | wave-analysis / UKB entity persistence |

### Why it clobbers

- `docker/docker-compose.yml:77` bind-mounts host `.data` → `/coding/.data`. Every store's
  `dbPath` and `exportDir` therefore resolve to the **same host directory**.
- LevelDB requires an exclusive lock. obs-api (host) wins it; every in-container store
  gets `LEVEL_NOT_FOUND` and hydrates from the JSON export instead (container logs:
  `hydrated from JSON: 1000 nodes ... preferring JSON`).
- **But all of them call `exporter.scheduleExport()` on every mutation** → they all write
  the same `.data/knowledge-graph/exports/general.json`. Last writer wins. obs-api's
  1016-node graph and sse-server's 1000-node graph overwrite each other (observed live:
  the export flipped between 1001 and 1017 nodes during this session's repairs).
- The km-core hydrate patch prefers JSON only when it has **more nodes** than LevelDB
  (`persistence.js:79` — node-count heuristic). An **edge-only** repair (node count
  unchanged) is therefore **not guaranteed to survive an obs-api restart**.

### Who actually consumes each port

- **:12436** — unified-viewer `coding` tab (`/api/v1` + `/api/coding/*`); the writer itself. **Authoritative.**
- **:3848** — `stdio-proxy.ts` (MCP→SSE bridge) + dashboard `/workflow-events` SSE + dashboard liveness check. These need the **SSE/workflow** surface, NOT a graph store.
- **:3848 `/api/v1`** — only the repair scripts + `poll-orphan-floor-soak.mjs` (both default to `KMCORE_REST_BASE=:3848`, which is **wrong** — they should hit the writer's graph). The unified-viewer was explicitly retargeted OFF :3848 (`system-endpoints.ts:6`). **The `/api/v1` mount on :3848 has no production UI consumer — it is vestigial.**

## Recommended design — single-owner store

**obs-api (:12436) becomes the SOLE `GraphKMStore` owner.** Everything else reads/writes
the graph through its REST API (`host.docker.internal:12436/api/v1`); no other process
constructs a `GraphKMStore` against the shared dir.

```
                 ┌───────────────────────────── host ─────────────────────────────┐
  unified-viewer ─┤                                                                 │
  (:5173) ────────┤   obs-api :12436  ── OWNS leveldb lock + general.json export    │
  repair scripts ─┤   (writer + typed views + /api/v1)  = SINGLE SOURCE OF TRUTH    │
  soak harness  ──┘            ▲                                                     │
                               │ REST (/api/v1/entities, /relations)                │
   coding-services container   │                                                    │
   ┌───────────────────────────┼──────────────────────────────────────────────┐   │
   │  sse-server :3848  — SSE/MCP workflows ONLY, NO GraphKMStore                │   │
   │  wave-controller / tools  — persist via REST to :12436, NOT in-proc store   │   │
   └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                      │
   └──────────────────────────────────────────────────────────────────────────────┘
```

### Why single-owner (not "separate export dirs")

- Separate export dirs (Option B) stops the clobber but leaves two graphs that drift —
  the viewer would still show data the workflow can't see and vice-versa. It treats the
  symptom, not the cause.
- Single-owner makes "the graph" mean one thing. The recurring "which graph did I repair?"
  confusion (hit 3× in one session) disappears by construction.

## Task breakdown (proposed phase)

1. **Audit workflow persistence** — confirm every in-container `new GraphKMStore` site
   (`wave-controller.ts:554`, `tools.ts:978`, `tools.ts:2584`) and the exact methods used
   (`putEntity`, `addRelation`, `mergeAttributes`, `findByOntologyClass`, dedup sweep).
   Decide REST-equivalent for each. **Gate:** no in-container `new GraphKMStore` survives.

2. **REST-backed persistence adapter** — introduce a `RemoteKmCoreStore` (or extend the
   existing `KmCoreAdapter`) that implements the store methods the workflow uses against
   `:12436/api/v1`. Point wave-controller/tools at it via the container's
   `host.docker.internal:12436`. Verify wave-analysis writes land in obs-api's graph.

3. **Strip the vestigial store from sse-server** — remove `sse-server.ts:71` GraphKMStore
   + the `/api/v1` mount (keep the SSE/workflow routes + the JSON-404 fallback). If any
   `/api/v1` consumer remains, replace the mount with a thin reverse-proxy to :12436.

4. **Re-point repair scripts + soak harness** — change `KMCORE_REST_BASE` default to
   `:12436` in `repair-orphan-digest-insight-edges.mjs` and `poll-orphan-floor-soak.mjs`;
   correct their now-stale "—:3848 is the graph the viewer reads" comments.

5. **Durability hardening** (folds in this session's open items):
   - Fix km-core `entities.js` so the documented `limit=0` opt-out actually works
     (`hasCallerLimit = Number.isFinite(callerLimit) && callerLimit >= 0`).
   - Improve the hydrate heuristic to prefer JSON on higher **edge** count at equal node
     count (so edge-only repairs survive restart). Re-apply note for the node_modules patch.

6. **Verify** — single export writer; obs-api restart preserves repairs; wave-analysis
   run visible in the viewer without a second graph; orphan/island counts stable across a
   restart cycle.

## Risks

- **Workflow write latency** — REST round-trips per entity could slow wave-analysis vs
  in-process writes. Mitigate with a batch endpoint (`POST /api/v1/relations:batch`) if needed.
- **obs-api as single point of failure** — already true for the viewer; launchd auto-respawn
  + the JSON export fallback cover it. Document the restart procedure.
- **Container→host networking** — `host.docker.internal:12436` must be reachable from
  `coding-services` (already used for the LLM proxy at :12435, so the pattern is proven).

## Out of scope

- Retiring the standalone vokb viewer (:8080) — separate, lower-value cleanup; can follow
  once the store is unified.

## This-session stopgaps already applied (not the full fix)

- Orphan + island repairs run against BOTH :12436 and :3848 to keep them consistent for now.
- JSON-404 fallback added to both servers' `/api/v1` (jq robustness).
- unified-viewer `listEntities()` now passes an explicit large limit (works around the
  km-core `limit=0` bug) so >1000-node graphs render fully.
