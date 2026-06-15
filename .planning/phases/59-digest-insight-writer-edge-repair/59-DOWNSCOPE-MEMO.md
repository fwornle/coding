# Phase 59 — Downscope Memo

**Date:** 2026-06-15
**Original title:** Long-Tail Orphan Fixes & Baseline Reduction
**New title:** Digest / Insight Writer-Edge Repair & Orphan-Floor Maintenance
**Trigger:** Pre-discuss reality check against the live km-core graph showed 3 of 4 original success criteria already met by upstream work.

---

## Original scope (ROADMAP entry as of 2026-06-14)

> Drive the live km-core graph's orphan ratio from ~12 % (157 of 1262 nodes) down to ≤3 %, by closing the three known orphan-producing paths — server-side System-type stripping, online-learned Detail/SubComponent without parent edges, and per-team Project anchors missing the `CollectiveKnowledge --includes-->` edge — at both the writer path AND via a one-shot repair migration for the existing instances.

Requirements: ORPHAN-01, ORPHAN-02, ORPHAN-03, ORPHAN-04.

## Reality check (2026-06-15 21:46, live km-core via `:3848/api/v1/stats`)

| Metric | Baseline (2026-06-14) | Live now | Delta |
|---|---|---|---|
| nodes | 1262 | 840 | −422 |
| edges | — | 1675 | — |
| **orphanCount** | **157 (~12%)** | **7 (~0.83%)** | **−150** |
| connectivity | — | 98.5% | — |
| componentCount | — | 11 | — |

`orphanCount` is defined by km-core as `graph.degree(id) === 0` (`lib/km-core/src/api/handlers/query.ts:237`). Strict topological orphans, not a UI heuristic.

### Per-requirement closure evidence

| Req | Status | Evidence |
|---|---|---|
| **ORPHAN-01** | Closed-upstream | The target file (`integrations/memory-visualizer/src/api/databaseClient.ts:262`) has been refactored — line 262 is now `loadKnowledgeGraph()`, not the per-team `queryEntities` strip code. memory-visualizer is no longer the operator surface; `unified-viewer @ :5173` reads km-core `/api/v1/*` directly and has no System-strip (`integrations/unified-viewer/src/` grep for System-type filtering returns no strip logic). Only 1 `System` entity exists in the live graph (`CollectiveKnowledge`) and it carries 6 outgoing + 10 incoming edges. |
| **ORPHAN-02** | Closed-upstream | 326 `SubComponent` + 312 `Detail` entities exist in the live graph; **zero** of them are in the `/api/v1/graph/orphans` response. The 122-orphan instance set was repaired by the Phase 57 regression-recovery work on 2026-06-15 06:24 (LevelDB wipe + JSON rehydrate + export filter). |
| **ORPHAN-03** | Closed-upstream | `CollectiveKnowledge` (id `019eb7c3-e339-7799-9967-664b1a71a3ea`) has `parent-child` outgoing edges to all 4 Project anchors: `Coding` (team=coding), `Normalisa` (team=resi), `Timeline` (team=ui), `DynArch` (team=ui). Edge type is `parent-child`, not `--includes-->` as written in the requirement — wording mismatch but structurally equivalent (CK is the topological parent of every Project). |
| **ORPHAN-04** | Met-upstream | `orphanCount=7 ≤ 30` (≤3% target met by 4× margin). Restated below as ORPHAN-FLOOR with a tighter ≤10 sustained-24h target. |

## The 7 remaining orphans (`/api/v1/graph/orphans`, 2026-06-15 21:46)

All are recent Digests/Insights from 2026-06-15, **none** are from the original ORPHAN-01/02/03 categories:

1. `Digest` — GSD Phase 57: Lower-Ontology Project Tagging Foundation
2. `Digest` — Phase 57 Regression Recovery and Knowledge Graph Repair
3. `Digest` — Phase 58 Plan-Phase Workflow Initiation and Research Gating
4. `Digest` — Phase 58 Code Review Initiation via gsd-code-reviewer
5. `Digest` — Live Backfill Execution with Pre-flight Validation
6. `Digest` — SC#1 Upstream Fix Sequencing and SC#2/SC#3 Planning
7. `Insight` — Live Backfill Pre-flight Procedure and Wave-Analysis Routing

## Root cause (writer-path probe)

`src/live-logging/ObservationConsolidator.js:1293-1296`:

```js
const entity = legacyDigestToEntity(row, this._runId, now);
await kmStore.putEntity(entity, { skipOntologyCheck: true });
createdCount++;
for (const obsId of d.observationIds) digestedObsIds.add(obsId);
```

The Digest entity is written via `putEntity`. The observation IDs that the Digest summarizes are recorded in `row.observation_ids` (line 1279) and end up in the entity's `metadata.observation_ids` JSON array. **But `kmStore.addRelation` is never called** to materialize the `Digest -[derivedFrom]-> Observation` edges. The Digest lands as a zero-degree node.

The Insight case (1 orphan in 100) is a tighter race: `_pushInsightToKG` at `:577-694` routes through `ObservationWriter.writeInsight` (which lands the entity) AND then probes for an existing `has_insight` edge before calling `kmStore.addRelation` (`:684-690`). Comment at `:679` notes: *"km-core addRelation is NOT idempotent on duplicates"*. The probe-then-write race can false-negative when an upstream concurrent write inserts the entity but the probe misfires, leaving the Insight without its anchor edge.

## New scope (downscoped Phase 59)

Goal: Eliminate the Digest writer-edge bug, harden the `has_insight` follower against the probe race, run a one-shot repair against the 7 baseline orphans, and hold `orphanCount ≤ 10` sustained.

Requirements: ORPHAN-DIG-01, ORPHAN-DIG-02, ORPHAN-INS-01, ORPHAN-FLOOR (see REQUIREMENTS.md §"Digest/Insight writer-edge repair").

ORPHAN-01..04 are marked Closed-upstream / Met-upstream in REQUIREMENTS.md traceability.

## Canonical refs for downstream agents

- `src/live-logging/ObservationConsolidator.js:1149-1320` — Digest stage 1 (parsing → insert)
- `src/live-logging/ObservationConsolidator.js:1372-1700` — Insight synthesis stage 2
- `src/live-logging/ObservationConsolidator.js:677-694` — consolidator-side `has_insight` follower (probe-then-write)
- `lib/km-core/src/api/handlers/query.ts:222-288` — `/stats` handler defining `orphanCount`
- `lib/km-core/src/api/handlers/query.ts:403+` — `/graph/orphans` handler
- `.data/knowledge-graph/exports/general.json` — live JSON snapshot read by unified-viewer
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts:46-103` — km-core REST mount at port 3848
