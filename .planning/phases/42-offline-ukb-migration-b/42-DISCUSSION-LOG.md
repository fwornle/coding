# Phase 42 Discussion Log — Offline UKB Migration (B)

**Session date:** 2026-05-23
**Phase goal (from ROADMAP.md):** Migrate B (`integrations/mcp-server-semantic-analysis`) to KM-Core, fix Phase 10 embeddings-not-reaching-GraphDB bug + `workflow-runner.ts:469-530` race condition during the migration.

## Areas Selected for Discussion

All four gray areas selected (multiSelect): G1 (Migration strategy), G2 (Embedding storage), G3 (Existing ontology hierarchy), G4 (Existing GraphDB data).

---

## G1 — Migration Strategy

**Question 1 of 2:** Which migration strategy for B?

**Options presented:**
- Strangler — persist layer first, then wave-controller, then agents (recommended)
- Cutover — one phase, rip out all 3 storage modules
- Hybrid — strangler for storage, cutover for race-condition

**User selected:** Strangler — persist layer first, then wave-controller, then agents.

**Rationale shared with user:** B's current storage path is exactly what's broken (Phase 10 + race condition); co-exist (A's pattern) doesn't fit because B IS the writer (no separate writer process to leave untouched). Strangler isolates risk per plan and lets each agent migrate independently.

**Captured as:** D-51, D-51a, D-51b.

---

**Question 2 of 2:** When does the legacy storage code get deleted?

**Options presented:**
- Last plan of Phase 42 (recommended)
- Deferred to a Phase 42.1 cleanup phase
- Keep both indefinitely behind the flag

**User selected:** Last plan of Phase 42.

**Captured as:** D-51 (final plan = cleanup plan deleting `GraphDatabaseService` + `KnowledgeStorageService` + `QdrantSyncService` + 7-layer pipeline + feature flag).

---

## G2 — Embedding Storage

**Question 1 of 2:** Where do entity embeddings live after the migration?

**Options presented:**
- km-core native + Qdrant rebuildable from km-core (recommended)
- Qdrant primary, km-core stores Qdrant point ID only
- Hybrid — embeddings native AND Qdrant kept in lockstep via dual-write

**User selected:** km-core native + Qdrant rebuildable from km-core.

**Rationale shared with user:** Single source of truth = km-core; Qdrant becomes a derived index. Eliminates the dual-write failure mode (root cause of Phase 10). Forces C migration (Phase 43) to use the same field — unification goal.

**Captured as:** D-52, D-52a, D-52b.

---

**Question 2 of 2:** Embedding model — standardize in km-core, or stay per-system?

**Options presented:**
- Standardize — fastembed all-MiniLM-L6-v2 (384-dim) in km-core (recommended)
- Per-system — each system declares its own model
- Defer — leave the model decision to Phase 43/44

**User selected:** Standardize — fastembed all-MiniLM-L6-v2 (384-dim) in km-core.

**Captured as:** D-52c. Memory note pinning the model is honored.

---

## G3 — Existing Ontology Hierarchy

**Question 1 of 2:** What survives of B's ontology subsystem?

**Options presented:**
- Replace registry + validator; keep classifier (recommended)
- Replace registry only; keep classifier + validator + query engine
- Replace all four; port classifier into km-core as a generic class

**User selected:** Replace registry only; keep classifier + validator + query engine.

**Notes:** Higher survivor count than the recommendation. User wants B's intelligence preserved; only the storage/discovery layer comes from km-core. OntologyManager dies; OntologyClassifier, OntologyValidator, OntologyQueryEngine stay B-specific.

**Captured as:** D-53.

---

**Question 2 of 2:** Where do B's ontology JSON files live after migration?

**Options presented:**
- Stay in coding/.data/ontologies/; km-core registry points there (recommended)
- Move to km-core package ontology dir (~/Agentic/km-core/ontology/)
- Hybrid — shared in km-core, B-specific stays in coding/

**User selected:** Stay in coding/.data/ontologies/; km-core registry points there.

**Captured as:** D-53a, D-53b. Planner picks: flatten the directory layout one-time OR extend km-core OntologyRegistry to walk subdirs (small prerequisite plan).

---

## G4 — Existing GraphDB Data

**Question 1 of 1:** What happens to the existing GraphDB data?

**Options presented:**
- Replay — wipe + re-extract via `ukb full` after migration (recommended)
- In-place key migration — rewrite LevelDB attributes to km-core schema
- Hybrid — in-place for entities, drop relations + Qdrant, replay those

**User selected:** In-place key migration — rewrite LevelDB attributes to km-core schema.

**Notes:** User chose continuity over cleanliness. Risk acknowledged: residue from the buggy pipeline may carry forward (e.g., orphan refs similar to the 8 surfaced in Phase 41). Addressed via post-v7.1 orphan-edge cleanup backlog. Qdrant is fully rebuilt from km-core via `syncQdrantFromStore` after the in-place LevelDB migration.

**Captured as:** D-54, D-54a, D-54b.

---

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section.

## Carried Forward (Not Re-Asked)

Captured in CONTEXT.md `<decisions>` "Carrying Forward from Phase 37 + 38 + 39 + 40 + 41" subsection.

## Claude's Discretion (Planner Decides)

- The exact shape of the feature flag (D-51a) — env var vs config field.
- The exact fix shape for the `workflow-runner.ts:469-530` race condition (D-51 Plan 2) — centralize progress writes through km-core events vs add a lock/queue inside B vs remove `writeProgressPreservingDetails` and let wave-controller own all progress writes.
- Whether to flatten `.data/ontologies/` subdirs or extend km-core's `OntologyRegistry` to walk subdirs (D-53a).
- The exact migration provenance shape (D-54) and how missing fields are filled in.
- Test strategy — TDD discipline assumed (RED → GREEN → REFACTOR) per project convention; planner picks fixtures and per-plan test depth.
- Docker rebuild orchestration — every B code change requires `npm run build` + `docker-compose build coding-services` per CLAUDE.md; planner must include these in each plan's acceptance criteria.
