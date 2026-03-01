---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Hierarchical Knowledge Restructuring
status: roadmap_ready
last_updated: "2026-03-01T00:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
current_phase: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-01)

**Core value:** Knowledge graph organized as navigable hierarchy — not a flat soup of disconnected entities
**Current focus:** Phase 4 — Schema & Configuration Foundation

## Current Position

Phase: 4 — Schema & Configuration Foundation
Plan: Not started
Status: Roadmap defined, ready to plan Phase 4
Last activity: 2026-03-01 — Roadmap created for v2.0

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

## Accumulated Context

### Decisions

- [v1.0]: Fix existing pipeline surgically — architecture is sound
- [v1.0]: Batched execution mode preserved
- [v2.0]: Defer v1.0 Phases 2-3 to focus on hierarchy restructuring
- [v2.0]: Selective merge — generic entities rolled into parents, high-value kept as leaves
- [v2.0]: User's named components (LSL, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns) as L1 nodes
- [v2.0]: Frontend builds tree from flat `/api/entities` response using `parentId` — no new backend endpoint needed
- [v2.0]: Manifest-first, LLM-fallback classification — keyword aliases cover ~80%, LLM handles ~20% ambiguous entities
- [v2.0]: Phase 7 (VKB) depends on Phase 5 (Migration) not Phase 6 (Pipeline) — can run after migration data exists

### Critical Pitfalls (from research)

- **KGEntity/SharedMemoryEntity disconnect**: Hierarchy fields added to `KGEntity` but not to `SharedMemoryEntity`'s explicit object literal in `processEntity()` are silently discarded — same mechanism as v1.0 entityType/type bug. Fix: update all four interfaces simultaneously in Phase 4.
- **Dedup collapse of parent nodes**: `mergeEntities()` spread overwrites `parentId` with undefined on second pipeline run. Fix: null-coalesce in `mergeEntities()` + add component nodes to `PROTECTED_ENTITY_TYPES`.
- **LevelDB/JSON export sync**: Migration script must use `GraphDatabaseAdapter` (not `GraphDatabaseService` directly) to keep JSON export in sync.
- **Docker rebuild after TS changes**: Container runs stale `dist/` without rebuild. Phase 6 requires Docker rebuild; Phases 4, 5, 7 do not.
- **D3 force layout collapse**: Filter `contains` edges from D3 link force — tree navigation uses React, not D3.

### New Packages Required

- `graphology-traversal` ^0.3.1 — BFS from root node (MCP server submodule)
- `react-arborist` ^3.4.3 — Virtualized tree panel in VKB viewer

### Pending Todos

- Verify `queryEntities()` snake_case handling for `parentId` (may return as `parent_id`) before finalizing migration script
- Run `grep -c '\*\*' .data/knowledge-export/coding.json` = 0 before migration to confirm no bold formatting in source data
- 20-entity classification spike recommended in Phase 6 before committing to full HierarchyClassifier implementation

### Blockers/Concerns

None at start of Phase 4.

## Session Continuity

Last session: 2026-03-01
Stopped at: Roadmap creation for v2.0
Resume with: `/gsd:plan-phase 4`
