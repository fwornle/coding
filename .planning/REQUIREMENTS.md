# Milestone v7.1 Requirements — Knowledge Management Unification

**Goal:** Extract a shared KM-Core from three knowledge-management systems (A: Online Learning, B: Offline UKB, C: OKM) so each application uses a common codebase parameterized by per-system configuration.

**Research seed:** `.planning/research/v7.1-km-unification.md`

---

## v7.1 Requirements

### Core types & storage (CORE)

- [ ] **CORE-01:** KM-Core package exports canonical entity and relation TypeScript types consumed by all three systems.
- [ ] **CORE-02:** GraphKMStore adapter (Graphology in-memory + LevelDB durable + git-tracked JSON export) is consumed by B and C without code duplication.
- [ ] **CORE-03:** All cross-system entity references use a stable UUID-keyed identifier scheme.

### Ontology system (ONTO)

- [ ] **ONTO-01:** OntologyRegistry auto-discovers upper + lower ontologies from a configured directory (`ontology/*.json`).
- [ ] **ONTO-02:** Lower ontologies extend upper ontologies via an `extends` field with property merging.

### Consolidation framework (PIPE)

- [ ] **PIPE-01:** 4-stage ingest-time consolidation pipeline (extract → dedup → store → synthesize) is defined in KM-Core; A's daily-digest/weekly-insight roll-up and B's wave-agents both implement against it.
- [ ] **PIPE-02:** Post-hoc entity resolution is exposed as a KM-Core maintenance operation that scans the existing graph by `ontologyClass` and runs LLM semantic matching across the whole class (not just the current batch). All three systems gain this via the shared API; pattern lifted from OKM `pipeline.resolveEntities()` + `POST /api/cleanup/resolve-entities`.

### Deduplication (DEDUP)

- [ ] **DEDUP-01:** Layered dedup pipeline (exact name → embedding cosine → LLM semantic) defined in KM-Core; A, B, and C each plug system-specific implementations into the shared stages.

### Entity data model (DATA)

- [ ] **DATA-01:** All entities carry `validFrom`, `validUntil`, and `supersedes` fields.
- [ ] **DATA-02:** Structured provenance fields (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) are present on every entity.

### Query API & snapshots (API)

- [ ] **API-01:** Common REST contract (entity CRUD, search, clusters, snapshots, ontology metadata) is exposed by all three systems.
- [ ] **API-02:** Git snapshot + restore on `.data/exports/` works identically in all three systems.

### Unified viewer (UI)

- [ ] **UI-01:** A single web viewer renders any KM-Core graph parameterized by ontology config; both VKB (B) and VOKB (C) users migrate to it without functional regression.

### Per-system integration (INT)

- [ ] **INT-01:** A (Online Learning) keeps its SQLite hot path; a thin KM-Core adapter exposes observations/digests/insights as KM-Core entities.
- [ ] **INT-02:** B (Offline UKB) migrated to KM-Core; the Phase 10 embeddings-not-reaching-GraphDB issue and the `workflow-runner.ts:469–530` wave-analysis race condition are fixed during migration.
- [ ] **INT-03:** C (OKM in `~/Agentic/_work/rapid-automations`) migrated to KM-Core via cross-repo refactor; rapid-automations CI remains green.

### Documentation (DOC)

- [ ] **DOC-01:** Each system has a README documenting which configurations it owns (ontology files, LLM provider config, ingest adapter config, domain eval logic); KM-Core has an architecture diagram + onboarding guide.

---

## Future Requirements (deferred)

- Migrate A's SQLite hot path to the graph model — defer until KM-Core has proven hot-write performance under ETM load.
- Real-time bidirectional sync between systems via event bus — premature until each system is on KM-Core and the event shape is stable.
- Embedding/vector-store unification (Qdrant) — keep as optional sidecar in v7.1; converge in a later milestone if A/B/C diverge meaningfully on retrieval semantics.

## Out of Scope

- Rewriting the MCP server interface for B — `ukb full` invocation contract stays.
- Replacing Graphology, LevelDB, or the existing JSON export format — KM-Core wraps these, doesn't replace them.
- Breaking changes to existing `.data/observation-export/*.json` and `.data/knowledge-export/coding.json` paths — established commit hygiene (OKB-baseline guard, two-commit pattern) is preserved.
- Cross-repo dependency injection between coding/ and rapid-automations/ via private npm — out for v7.1; OKM consumes KM-Core via the agreed packaging strategy (decided in INT-03's discuss phase).
- New ingest adapters for A/B/C — each system keeps its existing source set; adding new sources is a follow-on milestone.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 37 | Complete |
| CORE-02 | Phase 37 | Pending |
| CORE-03 | Phase 37 | Complete |
| ONTO-01 | Phase 38 | Pending |
| ONTO-02 | Phase 38 | Pending |
| DATA-01 | Phase 39 | Pending |
| DATA-02 | Phase 39 | Pending |
| PIPE-01 | Phase 40 | Pending |
| DEDUP-01 | Phase 40 | Pending |
| INT-01 | Phase 41 | Pending |
| PIPE-02 | Phase 41 | Pending |
| INT-02 | Phase 42 | Pending |
| INT-03 | Phase 43 | Pending |
| API-01 | Phase 44 | Pending |
| API-02 | Phase 44 | Pending |
| UI-01 | Phase 45 | Pending |
| DOC-01 | Phase 46 | Pending |

**Coverage:** 17/17 v7.1 requirements mapped, no orphans.
