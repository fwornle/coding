# Phase 41: Online Learning Adapter & Post-Hoc Resolution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 41-online-learning-adapter-post-hoc-resolution
**Areas discussed:** G1 Adapter direction, G2 Ontology mapping, G3 PIPE-02 surface, G4 PIPE-02 writeback

---

## G1: Adapter direction (INT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Pure pull | Adapter maps SQLite rows → KM-Core Entity on every read. No GraphKMStore projection. PIPE-02 scans via the adapter's iterator (slower, no sync skew). | |
| Push (dual-write) | A's ObservationWriter also writes to a GraphKMStore alongside SQLite. Live graph. Violates D-45 (A's writer untouched) and adds latency risk to SC#2. | |
| Hybrid | Pull-on-read for hot path (zero ETM latency impact); periodic batch reproject from SQLite → GraphKMStore so PIPE-02 + future graph queries have a typed graph to scan. Explicit eventually-consistent contract. | ✓ |

**User's choice:** Hybrid
**Notes:** Recommended option. SC#2 (ETM latency unchanged) is the binding constraint — Hybrid honors it while still giving PIPE-02 something useful to scan. The reprojection is the explicit eventual-consistency knob; idempotency via Phase 39 legacyId resolver + checkpoints.

---

## G1 follow-up: Reprojection cadence

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand only | Explicit command (library fn + CLI script); runs before PIPE-02 / after big consolidator runs / on operator trigger. No daemon. | ✓ |
| Periodic cron (every N min) | Background process runs reprojection on a schedule. Adds long-running process that must coexist with observations-api-server single-writer pattern. | |
| Both cron + on-demand | Default cadence + on-demand trigger. Most coverage, most moving parts. | |
| Triggered by consolidator | Auto-reproject the affected slice after each `consolidateDay()` / `synthesizeInsights()` run. Tight coupling to A's daily cron. | |

**User's choice:** On-demand only
**Notes:** Minimises moving parts. Reprojection ergonomics are operator-controlled — if a higher-level cron is wanted, it lives in coding/ ops scripts, not in km-core. Mirrors A's existing "daemon only for ObservationConsolidator" pattern.

---

## G2: Ontology mapping for A's three native types

| Option | Description | Selected |
|--------|-------------|----------|
| A: Three sibling uppers | `Observation`, `Digest`, `Insight` as flat top-level classes — no `extends`. Shared properties (createdAt, project, provenance) declared three times. | |
| B: Single upper + type discriminator | `LearningEvent` upper with `tier: 'observation'|'digest'|'insight'` field. Bypasses ONTO-02's class system; PIPE-02 can't easily scan one tier. | |
| C: Abstract upper + 3 lowers via `extends` | Upper `LearningArtifact` (never instantiated); `Observation`/`Digest`/`Insight` each declare `extends: LearningArtifact`. Aggregation lives on graph edges, not class hierarchy. | ✓ |
| Skip — you decide later | Defer to planner / researcher. | |

**User's choice:** C: Abstract upper + 3 lowers (Recommended)
**Notes:** Matches ONTO-02 (`extends` mechanism) as designed. PIPE-02 can scan one tier (`resolveEntities({classes:['Insight']})`) or all tiers (`resolveEntities({classes:['LearningArtifact']})` walks subclasses). Future tiers (WeeklyReport, etc.) extend the upper without ontology surgery. Aggregation relationships (observationIds, digestIds) become graph edges.

---

## G3: PIPE-02 surface in km-core

| Option | Description | Selected |
|--------|-------------|----------|
| Method on LayeredDeduplicator | `dedup.resolveEntities(store, opts)`. Reuses LLM stage cleanly but couples a per-entity per-batch class to a graph-wide op. | |
| Method on IngestPipeline | `pipeline.resolveEntities(opts)` — literal port of OKM's shape. Conflates per-batch ingest with graph maintenance. | |
| New MaintenanceOps class | `new MaintenanceOps(store, {llmMatcher}).resolveEntities(opts)`. Introduces a class where Phase 39 used a top-level fn — inconsistent. | |
| Top-level fn at `@fwornle/km-core/maintenance` | `import { resolveEntities } from '@fwornle/km-core/maintenance'`. Matches Phase 39 D-36 precedent. Future post-hoc ops (prune, compact, exportSnapshot) share the namespace. | ✓ |

**User's choice:** Top-level fn at @fwornle/km-core/maintenance (Recommended)
**Notes:** Consistent with Phase 39's `backfillEntityDataModel` (top-level fn pattern). Adds `./maintenance` to the package.json exports map; future-proofs the namespace. Avoids putting graph-maintenance methods on per-batch-ingest classes.

---

## G4: PIPE-02 writeback semantics

| Option | Description | Selected |
|--------|-------------|----------|
| a: Pure supersession via Phase 39 putEntity | `putEntity(survivor, {supersedes:[id]})` per pair. Uses only Phase 39 primitives. Caller owns edge rewiring + segment merging. High risk of dangling edges. | |
| b: New `mergeEntities()` primitive + dryRun on resolveEntities | `mergeEntities(store, survivorId, duplicateIds[], opts)` atomic via D-17 batch — close validUntil + rewire edges + merge segments + bump confirmation. resolveEntities calls it; `dryRun:true` skips. | ✓ |
| c: Plan-and-return only | resolveEntities returns `{merges:[...]}`; caller applies. Pushes 3-step atomicity to every caller. | |
| Skip — you decide later | Defer to planner / researcher. | |

**User's choice:** b: New mergeEntities() primitive + dryRun on resolveEntities (Recommended)
**Notes:** Atomic 3-step (supersession + edge rewire + segment merge) MUST live in one batch op or the graph gets dangling edges. Lands as a top-level fn in /maintenance alongside resolveEntities — same pattern as Phase 39 D-36. Reused by Phase 42 (B migration) and Phase 43 (C migration) to delete their local `mergeEntityGroup` implementations.

---

## Closing decision

User selected "Ready for context" — no further gray areas needed. CONTEXT.md written with 4 locked decisions + Claude's discretion items.

## Claude's Discretion

Items the planner / researcher resolves without re-asking:
- Reprojection checkpoint format + chunk size (reuse Phase 39 D-38 patterns).
- Legacy-id mapping for A's SQLite ids → km-core UUIDs (Phase 39 D-37 `legacyId` resolver with `system: 'online'`; UUIDv5-from-system+id vs UUIDv4-with-lookup is planner choice).
- LLM concurrency + batch size defaults for resolveEntities (start from OKM's 3 / 30 per `deduplicator.ts:651-654`).
- Aggregation edge predicate names (`aggregates` / `derivedFrom` / `summarizes` — pick based on existing edge-predicate conventions in coding.json).
- Adapter file layout under `src/adapters/online/`.
- Survivor-selection heuristic (OKM uses `getDegree`-based; planner may tune).
- Return-shape verbosity of ResolveResult / MergeResult (must be superset of OKM's; planner adds tracing fields).

## Deferred Ideas

- A's `ObservationConsolidator` migration onto IngestPipeline — defer indefinitely (D-45 co-exist).
- PII filter / governance hooks on adapter read path.
- Push / dual-write adapter (explicitly rejected this discussion).
- Reprojection daemon / cron (explicitly rejected this discussion).
- Cross-class merging via PIPE-02 (D-46 same-class lock applies).
- Survivor-selection beyond `getDegree`.
- Additional `/maintenance` siblings (`pruneEntities`, `compactGraph`, `exportSnapshot`).
- REST surface for resolveEntities + mergeEntities → Phase 44 (API-01).
- B's name-Jaccard deletion → Phase 42 (INT-02).

## Reviewed Todos (not folded)

- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.6) — libc++ mutex crash on observations-api-server.mjs SIGTERM. Same file the adapter consumes data from, but a process-shutdown bug, not an adapter / maintenance concern. Kept on backlog.
