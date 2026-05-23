# Phase 42: Offline UKB Migration (B) - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 42 migrates **B** (`integrations/mcp-server-semantic-analysis` — the multi-agent wave-analysis pipeline behind `ukb full`) to KM-Core while discharging two carry-forward bugs that have lived in active memory for months:

1. **Phase 10 embeddings issue** — entity embeddings (384-dim fastembed vectors) are computed but never reach the GraphDB. Memory note: "Use direct `graph.mergeNodeAttributes()` after operators instead of 7-layer persist pipeline."
2. **`workflow-runner.ts:469–530` race condition** — Docker logs spam "Race condition detected (0/0 steps) but no valid cache available"; the dashboard stays "running" indefinitely after a successful `ukb full`; `writeProgressPreservingDetails` calls likely conflict with wave-controller's own progress updates.

Both bugs are folded into Phase 42 by SC#2 and SC#3 — fixing them is part of the migration, not a side track.

**In scope:**
- Replace B's storage trio (`GraphDatabaseService` + `KnowledgeStorageService` + `QdrantSyncService` + the 7-layer `persistence-agent` pipeline) with a km-core `GraphKMStore` adapter, via a **strangler migration**.
- Phase 10 embeddings fix lands in the persistence-layer plan (direct `graph.mergeNodeAttributes` after the embedding-operator runs).
- `workflow-runner.ts:469-530` race condition fix lands in its own plan (shape is planner's discretion — implementation detail).
- Add `embedding?: number[]` to km-core's canonical `Entity` (Phase 39 schema extension — optional field, no-op for A).
- Add a `syncQdrantFromStore(store, opts)` km-core maintenance op so Qdrant becomes a derived rebuildable index.
- Repackage B's existing ontology JSON files (`coding/.data/ontologies/{upper,lower,...}/`) so km-core's `OntologyRegistry` can auto-discover them (per SC#5).
- One-time in-place LevelDB key migration: rewrite each entity in `.data/knowledge-graph/` from B's current attribute shape to canonical km-core `Entity` shape. Idempotent.
- Final plan: delete the legacy storage modules + the strangler feature flag.

**Out of scope (deferred):**
- C migration (Phase 43, INT-03).
- Unified REST API (Phase 44, API-01/02).
- Unified web viewer (Phase 45, UI-01).
- The 8 orphan-edge warnings surfaced during Phase 41 (`.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md`) — folded as a reviewed-but-not-acted-on todo (Phase 42 will surface similar orphans from B's wave-emitted relations; remediation is the same backlog item, post-v7.1).
- `mockLLM` / `singleStepMode` / `debug` workflow flags — preserved as-is in B's controller layer (B-specific concerns).
- Migration of B's MCP interface (`mcp__semantic-analysis__execute_workflow` and friends) — SC#1 says it stays unchanged.
- A new generic embedding API in km-core beyond the existing Phase 40 `EmbeddingClient` interface — defer if it grows.

</domain>

<decisions>
## Implementation Decisions

### G1 — Migration Strategy (D-51)

- **D-51: Strangler migration.** Phase 42's persistence layer comes online while the legacy code stays in place behind a feature flag. Sequence:
  1. **Plan 1 — Persistence layer:** km-core `GraphKMStore` adapter replaces `persistence-agent.ts` writes and `GraphDatabaseService` reads. Phase 10 embeddings fix lands HERE (direct `graph.mergeNodeAttributes()` after the embedding-operator step). New entities flow through km-core; existing reads still go through `GraphDatabaseService` until later plans.
  2. **Plan 2 — Race condition fix:** `workflow-runner.ts:469–530` progress-write race is fixed atomically. Shape is planner's discretion; the constraint is SC#3 ("the workflow no longer logs 'Race condition detected (0/0 steps) but no valid cache available'; dashboard reflects true terminal state").
  3. **Plan 3+ — Wave-controller + agent emit shapes:** Wave-controller, wave1/2/3 agents, KG-Ops, hierarchy-classifier all migrate to emit canonical `Entity` shapes (top-level `legacyId`, `ontologyClass`, `descriptionSegments`, segment provenance).
  4. **Plan N (final) — Cleanup:** `GraphDatabaseService` + `KnowledgeStorageService` + `QdrantSyncService` + the 7-layer `persistence-agent` pipeline + the feature flag are all deleted in the same plan. Phase 42 closes with a clean tree — no dead code carried into Phase 43+.

- **D-51a: Feature flag during transition.** A single config switch (shape is planner's discretion — likely `config.persistence.backend: 'km-core' | 'legacy'` or `process.env.KM_CORE_PERSISTENCE`) gates the new path during the strangler phase. Flag deleted in the final cleanup plan.

- **D-51b: MCP interface unchanged (SC#1, locked).** `mcp__semantic-analysis__execute_workflow` and all tool surfaces in `tools.ts` keep their current signatures and return shapes. The migration is internal.

### G2 — Embedding Storage (D-52)

- **D-52: km-core native + Qdrant as a derived rebuildable index.** Add `embedding?: number[]` to km-core's canonical `Entity` (Phase 39 schema extension; optional so A — which doesn't compute embeddings — is a no-op). `GraphKMStore` persists embeddings on every entity write. Qdrant ceases to be a primary store; it becomes a search index rebuilt on demand from km-core.

- **D-52a: New km-core maintenance op `syncQdrantFromStore(store, opts)`** under `@fwornle/km-core/maintenance` (alongside Phase 41's `resolveEntities` + `mergeEntities`). Reads all entities with embeddings, writes them to a configured Qdrant collection. Idempotent. Caller passes the Qdrant client; km-core stays Qdrant-agnostic at the type level (mirrors the Phase 40 `LLMClient` pattern).

- **D-52b: Phase 10 fix lands in Plan 1.** The 7-layer persist pipeline collapses to direct `graph.mergeNodeAttributes()` after the embedding-operator runs. The fix is mechanical once the km-core adapter replaces `persistence-agent.persistEntity`. SC#2 verification: every entity returned by `findByOntologyClass('Detail')` after a `ukb full` run has `embedding.length === 384`.

- **D-52c: Embedding model standardised at fastembed all-MiniLM-L6-v2 (384-dim).** km-core gains a default `EmbeddingClient` implementation wrapping fastembed. B's existing embedding wiring becomes a thin pass-through. C's migration (Phase 43) re-embeds its corpus once to match — enables unified cross-system vector search in Phase 44+45. Memory note pinning the model is honored ("fastembed with all-MiniLM-L6-v2 (384-dim) pinned").

### G3 — Existing Ontology Subsystem (D-53)

- **D-53: Replace OntologyManager only; keep OntologyClassifier + OntologyValidator + OntologyQueryEngine.** km-core's `OntologyRegistry` (Phase 38) takes over auto-discovery, `extends` chain resolution, and storage of class definitions. B's three remaining ontology modules survive because they encode B-specific intelligence:
  - **OntologyClassifier** — LLM-based class assignment (Project/Component/SubComponent/Detail) for new entities. No km-core equivalent. Stays B-specific.
  - **OntologyValidator** — content-validation rules beyond the registry's shape check. Stays B-specific.
  - **OntologyQueryEngine** — B-specific traversal patterns. Stays B-specific.

- **D-53a: Ontology files stay at `coding/.data/ontologies/`** — no file moves. km-core's `OntologyRegistry` is constructed with `ontologyDir: '<repo-root>/.data/ontologies'` (or the appropriate absolute path inside Docker). SC#5 satisfied unchanged. If km-core's `OntologyRegistry` only walks one directory level today and B's layout is multi-level (`upper/`, `lower/`, `schemas/`, `suggestions/`), the planner decides: either (a) one-time flatten the layout, OR (b) extend the registry to walk subdirs (a small km-core prerequisite plan). Planner picks based on current registry behavior.

- **D-53b: B's existing ontology files are NOT a one-time conversion.** They become km-core lower-ontology JSONs in place. If a file needs schema tweaks to fit km-core's `OntologyFile` shape (e.g., adding `extends` declarations on classes that currently use inheritance implicitly), those are made directly in `.data/ontologies/`.

### G4 — Existing GraphDB Data (D-54)

- **D-54: In-place LevelDB key migration.** A one-shot migration plan (between Plan 1's adapter landing and the wave-controller migration in later plans) walks `.data/knowledge-graph/` and rewrites every entity to canonical km-core `Entity` shape:
  - Top-level `legacyId = { system: 'B', id: <existing-entity-id> }` (Phase 39 CF-D37).
  - `metadata.subsystem = 'wave-analysis'` (Phase 41 pattern; B's hot path is the wave pipeline).
  - `ontologyClass` set from B's existing class assignment (Project / Component / SubComponent / Detail / etc.).
  - `descriptionSegments[0]` initialized from existing `description` text via Phase 39 D-39 `mergeDescriptionSegment` building block; provenance stamp = `{ provider: 'phase-42-migration', model: 'b-to-km-core', runId, timestamp }`.
  - `validFrom = entity.createdAt`, `validUntil = null`.
  - `createdBy` carried from existing provenance where present; falls back to the migration provenance stamp.
  - `embedding` field added if present in the existing attribute set; otherwise left undefined and will be filled by the next `ukb full` run.
- Migration is idempotent. Running twice produces the same result. Acceptance: a property-based test that walks the post-migration LevelDB and asserts every entity satisfies the canonical `Entity` shape.

- **D-54a: Qdrant is fully rebuilt from km-core after the in-place migration.** No Qdrant migration; `syncQdrantFromStore` is invoked once at the end of the migration plan to reconstruct the vector index.

- **D-54b: Continuity over cleanliness.** The user explicitly chose in-place over replay (a fresh `ukb full` rebuild). Rationale: preserves whatever classification / naming / hierarchy work has been done by past runs; avoids hours of rebuild time; non-replayable data (manual learnings, cross-system entries from A's reprojection if any) is preserved. Risk acknowledged: residue from the buggy pipeline (e.g., orphan refs similar to the 8 surfaced in Phase 41) carries forward; addressed via the post-v7.1 orphan-edge cleanup backlog.

### Carrying Forward from Phase 37 + 38 + 39 + 40 + 41 (locked, not re-debated)

- **From 37:** Canonical `Entity`/`Relation`/`UUIDv7` types; `GraphKMStore` adapter wrapping Graphology + LevelDB + git-tracked JSON export; CORE-01/02/03 satisfied.
- **From 38:** `OntologyRegistry` with auto-discovery + `extends` chain resolution; ONTO-01/02 satisfied. Replaces B's `OntologyManager`.
- **From 39:** `Entity` shape locks in `legacyId` top-level + `ontologyClass` + `descriptionSegments` + segment provenance + `validFrom`/`validUntil`/`supersedes`/`createdBy`/`lastConfirmedBy`/`confirmationCount` (CF-D37); DATA-01/02 satisfied.
- **From 40:** 4-stage `extract → dedup → store → synthesize` pipeline + layered dedup (`ExactNameLayer` + `EmbeddingLayer` + `LLMSemanticLayer`); B's wave-agents will be re-shaped as Stage 1 (`extract`) and Stage 4 (`synthesize`) operators against this framework. `EmbeddingClient` interface used by D-52c.
- **From 41:** `defaultOntologyDir()` helper + `/maintenance` sub-path + `resolveEntities()` + `mergeEntities()` atomic primitive (D-50a). B's existing `deduplication.ts:342 mergeEntityGroup` and `coordinator.ts` merge calls are deleted, replaced by `mergeEntities` from km-core. LLM proxy convention `POST /api/complete` + improved error messages + `km-core-graphkmstore-needs-ontology-dir` constraint warn.

### Folded Todos (auto-matched, score >= 0.4)

- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` (reviewed during cross-reference; **not folded into Phase 42 scope**). Same orphan-edge pattern will surface from B's wave-emitted relations during the in-place LevelDB migration. The reproject-style `warnings[]` array handling already exists in km-core (Phase 41 D-50 surface); B's migration leverages it. The actual orphan REMEDIATION (janitor pass / pruner co-update) remains a post-v7.1 backlog item.

</decisions>

<canonical_refs>
## Canonical References (MUST READ during planning)

- `.planning/ROADMAP.md` — Phase 42 entry (lines 444-457). SC#1–5 are the goal-backward verification anchors.
- `.planning/REQUIREMENTS.md` — INT-02 (lines covering "B (Offline UKB) migrated to KM-Core; Phase 10 embeddings + workflow-runner race fixed").
- `.planning/phases/41-online-learning-adapter-post-hoc-resolution/41-CONTEXT.md` — D-47 through D-50a (especially D-50a: `mergeEntities` is the shared primitive for B + C migrations).
- `.planning/phases/40-ingest-pipeline-layered-dedup/40-01-PLAN.md` through `40-10-PLAN.md` — 4-stage pipeline + dedup layer interfaces (`ExactNameLayer`, `EmbeddingLayer`, `LLMSemanticLayer`, `EmbeddingClient`, `LLMClient`).
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` — Entity shape lock (CF-D37 top-level legacyId, D-39 descriptionSegments, D-33 supersession, D-38 checkpoint pattern).
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` — OntologyRegistry contract; ONTO-01 auto-discovery, ONTO-02 extends-chain resolution.
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` — D-17 atomic batch contract; KGEntity vs SharedMemoryEntity distinction (relevant for the migration mapping in D-54).
- `~/Agentic/km-core/src/store/GraphKMStore.ts` — adapter target.
- `~/Agentic/km-core/src/maintenance/{resolveEntities,mergeEntities}.ts` — Phase 41 surfaces B reuses.
- `~/Agentic/km-core/src/ontology/{registry,defaultDir}.ts` — registry contract + Phase 41 helper.
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts:469-530` — race condition site (SC#3 anchor).
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` — 7-layer pipeline being collapsed (SC#2 / Phase 10 fix anchor).
- `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` line 1050 (dedup type filter) — already-fixed reference per memory; do not re-touch.
- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` + `wave1-project-agent.ts` / `wave2-component-agent.ts` / `wave3-detail-agent.ts` — emit-shape migration targets in later plans.
- `integrations/mcp-server-semantic-analysis/src/knowledge-management/{GraphDatabaseService,KnowledgeStorageService,QdrantSyncService}.js` — modules deleted in the final cleanup plan.
- `integrations/mcp-server-semantic-analysis/src/ontology/{OntologyManager,OntologyClassifier,OntologyValidator,OntologyQueryEngine}.ts` — OntologyManager deleted; the other three survive.
- `coding/.data/ontologies/{upper,lower,schemas,suggestions}/*.json` — registry source. May need layout flattening (planner's call).
- `coding/.data/knowledge-graph/` — LevelDB target of the D-54 in-place migration.
- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` — reviewed, deferred.
- `CLAUDE.md` — Submodules & Build Pipeline section (CRITICAL: B is in Docker — `cd integrations/mcp-server-semantic-analysis && npm run build` followed by `cd docker && docker-compose build coding-services && docker-compose up -d coding-services` is required after every code change; this is the recurring failure mode the planner must plan around).

</canonical_refs>

<code_context>
## Codebase Snapshot

**B's storage trio (deleted in final plan):**
- `GraphDatabaseService.js` (~knowledge-management/) — Graphology + LevelDB primary
- `KnowledgeStorageService.js` (same dir) — higher-level write API
- `QdrantSyncService.js` (same dir) — Qdrant sync (currently buggy per Phase 10)
- `persistence-agent.ts` (~agents/) — the 7-layer pipeline (extract → validate → classify → enrich → dedup → persist → export) — currently swallows the embedding write per memory; D-52b collapses to direct mergeNodeAttributes.

**B's ontology trio (survives, except OntologyManager):**
- `OntologyManager.ts` — DELETED, replaced by km-core OntologyRegistry
- `OntologyClassifier.ts` — STAYS, LLM-driven class assignment
- `OntologyValidator.ts` — STAYS, content-rule validation
- `OntologyQueryEngine.ts` — STAYS, B-specific traversals

**Wave pipeline (emit-shape migrated in later plans):**
- `coordinator.ts` — orchestrator (line 1050 dedup type filter already fixed per memory; don't re-touch)
- `wave-controller.ts` — drives wave1/2/3, owns progress writes
- `wave1-project-agent.ts`, `wave2-component-agent.ts`, `wave3-detail-agent.ts` — emit class-typed entities
- `kg-operators.ts` — has KGEntity interface (memory note: lacks `entityType`/`metadata`, coordinator casts via `as KGEntity` after adding extra fields; persistence-agent uses SharedMemoryEntity with `entityType`)
- `deduplication.ts:342 mergeEntityGroup` — DELETED, replaced by km-core `mergeEntities` (Phase 41 D-50a)

**Race condition site (SC#3 anchor):**
- `workflow-runner.ts:469-530` — wave-analysis progress writing path; `writeProgressPreservingDetails` conflicts with wave-controller's own progress updates per memory.

**Embedding pipeline (Phase 10 anchor):**
- `embedding-operator` referenced from `persistence-agent.ts:62` (entity.embedding field comment) and again at lines 355, 1606, 3545, 3620, 3621 — multiple paths the embedding can take, none of which actually reaches GraphDB consistently per Phase 10.
- `src/utils/embedding_generator.py` — needs `numpy` + `sentence-transformers` in Docker per memory note (non-fatal QdrantSync error). Status worth confirming during research.

</code_context>

<scope_guardrail>
## What's NOT in this phase

- Touching B's MCP tool surface or invocation shape — SC#1 locks it.
- Changes to A's pipeline — A migrated in Phase 41; B doesn't touch A.
- C's migration — Phase 43.
- Generic unified REST API / unified viewer / docs — Phases 44/45/46.
- Embedding model swap, embedding dimension change, or alternative vector stores beyond Qdrant — D-52c locks the model.
- The 8 orphan-edge warnings from Phase 41 — backlog item, post-v7.1.
- ObservationWriter image-attachment handling (Phase 47), VKB System-node filter (Phase 48), VKB orphan project anchors (Phase 49), LSL-grounded resolver (Phase 50) — all out-of-milestone bug-fix phases.

</scope_guardrail>

<deferred>
## Deferred Ideas (not in Phase 42)

- A generic embedding API in km-core beyond the Phase 40 `EmbeddingClient` interface — defer unless C's migration requires it.
- Migration of the `mockLLM` / `singleStepMode` / `debug` workflow flags into km-core — these stay B-specific; the user's CLAUDE.md memory notes (sticky-debug-state bug, reset commands) keep applying.
- Orphan-edge janitor (digests / wave-emitted relations citing missing entities) — see `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md`. Post-v7.1.
- Hierarchical Knowledge Restructuring (memory NEXT note: Project → Component → SubComponent → Detail tree) — B already emits this hierarchy from wave agents; restructuring the GRAPH around it is its own initiative.
- Removing `index_codebase` step path bug (`/path/to/coding/repo/integrations/code-graph-rag` should be `/coding/integrations/code-graph-rag` per memory) — small fix, not phase-42 scope; can ride along if encountered during the strangler plans.

</deferred>
