# Phase 44 — REST API & Git Snapshots (Common Contract)

## Context
Three knowledge systems (A=Online-Learning, B=UKB, C=OKM) each have independent APIs.
Phase 44 extracts a **common REST router** into km-core so all three expose the same
entity/relation/search/ontology/snapshot endpoints. Domain-specific endpoints stay in each system.

## Decisions

### D1: Common vs Domain-Specific Endpoint Split
**Common (km-core router):** Entity CRUD, Relations, Search, Clusters, Ontology metadata,
Snapshots/Restore, Export/Stats, Query.
**Domain-specific (stays per-system):** Cleanup/PII, RCA, Proxy, Source Documents,
LLM settings, Ingestion, Patterns/Correlations, Confidence scoring.

### D2: System A Backward Compatibility
A's existing endpoints (`/api/observations`, `/api/digests`, `/api/insights`) remain as
**thin views** that delegate to the common entity router with `?ontologyClass=` filters.
No breaking changes to existing consumers.

### D3: System B Gets REST
B currently has no REST API (MCP-only). The common router will be mounted in B's Docker
service, enabling the unified viewer (Phase 45) to query B identically to A and C.

### D4: Git Snapshot Implementation
C's existing snapshot pattern (`git add + commit` on exports dir, `git checkout` for restore)
moves into km-core as a `SnapshotManager` class. All three systems inherit snapshot/restore
capability through the common router.

### D5: Packaging
km-core remains a `.tgz` vendored dependency (no npm publish for v7.1).
Express is a peerDependency of the router module — each system provides its own Express instance.

## Prior Art
- Phase 37: km-core GraphKMStore API
- Phase 42: System B migration to km-core (reference pattern)
- Phase 43: System C migration to km-core (IGraphStore adapter)
