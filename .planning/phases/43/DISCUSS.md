# Phase 43 — OKM (OKB) Cross-Repo Migration onto KM-Core

## Context

OKB (`rapid-automations/integrations/operational-knowledge-management/`) is a fully independent knowledge management system with its own GraphStore, PersistenceManager, OntologyRegistry, EntityDeduplicator, 7 intelligence modules, source adapters (MkDocs, Confluence, CodeBeamer, ServiceNow), and a React viewer.

It shares the same architectural pattern as KM-Core (Graphology + LevelDB + ontology-driven entities) but has **zero dependency** on `@fwornle/km-core`. This phase migrates OKB's core graph/ontology layer to KM-Core while preserving OKB-specific features.

**Reference:** System B (UKB in `coding/`) was already migrated in Phases 37-42. OKB is System C.

## Decisions

### D-01: KM-Core Packaging → npm pack .tgz

OKB lives in a different repo (`rapid-automations`). Private npm registry is out-of-scope for v7.1.

**Decision:** Pack `@fwornle/km-core` to a `.tgz` and commit it to `rapid-automations/` (same pattern as `@rapid/llm-proxy`).

**Rationale:** Simple, versioned, no build-time coupling, CI-friendly. Already proven with `@rapid/llm-proxy`.

### D-02: Store Migration → Replace core, keep OKB extras

| OKB Layer | Action |
|-----------|--------|
| `GraphStore` (382 lines) | **Replace** with `GraphKMStore` |
| `PersistenceManager` (LevelDB + per-domain JSON) | **Replace** — km-core has LevelDB+JSON |
| `SyncManager` (debounced write-through) | **Keep** — OKB-specific write strategy, composes with GraphKMStore |
| `SourceDocumentStore` (LevelDB for source docs) | **Keep** — no km-core equivalent |

**Rationale:** Core graph+persistence is the canonical km-core responsibility. SyncManager and SourceDocumentStore are domain-specific to OKB's ingestion pipeline.

### D-03: Dedup/Pipeline → Keep OKB dedup, retype store

OKB's `EntityDeduplicator` (952 lines) is richer than km-core's `resolveEntities`:
- Segment-level dedup (paragraph matching)
- Description synthesis (multi-source merge)
- Provenance tracking per resolution
- 3-phase: within-batch → cross-graph → LLM semantic

**Decision:** Keep OKB's dedup as-is. Retype it to use `GraphKMStore` instead of `GraphStore`. No upstream into km-core.

**Rationale:** OKB's dedup is domain-specific (segment consensus, provenance chains). Forcing it into km-core would bloat the core package. Retyping the store interface is minimal effort.

### D-04: Intelligence Layer → Interface adapter (IGraphStore)

7 intelligence modules (clustering, confidence, connectivity, correlation, rca-lookup, search, temporal) all take `GraphStore`.

**Decision:** Define a thin `IGraphStore` interface that both OKB's old `GraphStore` and km-core's `GraphKMStore` satisfy. Intelligence modules code to the interface.

**Rationale:** Decouples intelligence modules from the specific store implementation. Allows incremental migration — modules can be retyped one at a time. The interface is small (both stores wrap Graphology with similar API surface).

## Gray Areas Resolved

| Question | Resolution |
|----------|-----------|
| How does OKB consume km-core? | `.tgz` in rapid-automations repo |
| Which store layers migrate? | GraphStore + PersistenceManager → km-core; SyncManager + SourceDocumentStore stay |
| Dedup convergence? | Keep OKB's richer dedup, retype to use km-core store |
| Intelligence wiring? | IGraphStore interface adapter |

## Scope Boundaries

**In scope:**
- Pack km-core .tgz, add as OKB dependency
- Replace GraphStore + PersistenceManager with GraphKMStore
- Define IGraphStore interface
- Retype EntityDeduplicator to use GraphKMStore
- Retype 7 intelligence modules to IGraphStore
- Retype IngestionPipeline to use GraphKMStore
- Retype API routes to use GraphKMStore
- Ensure OKB's ontology JSON files load via km-core's registry
- All existing OKB tests pass (34 tests: 23 unit + 11 integration)

**Out of scope:**
- Upstreaming OKB features into km-core
- Modifying km-core's API surface
- Source adapters (unchanged)
- React viewer (unchanged)
- PII filter / governance (unchanged)
- Docker/deployment changes (Phase 44)
