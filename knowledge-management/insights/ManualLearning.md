# ManualLearning

**Type:** SubComponent

lib/ukb-database/cli.js exposes add-entity, update-entity, add-relation, import, and export commands that read JSON from stdin and pass it through UKBDatabaseWriter, a manual-authoring entry point distinct from the batch pipeline

# ManualLearning

## What It Is

ManualLearning is the hand-authoring pathway of the KnowledgeManagement system, providing two parallel entry points for humans (or tooling acting on their behalf) to create and modify knowledge graph entities and relations outside the automated extraction pipeline. It is implemented across two files: `lib/ukb-database/cli.js`, a command-line tool exposing `add-entity`, `update-entity`, `add-relation`, `import`, and `export` commands that read JSON from stdin, and `lib/vkb-server/api-routes.js`, which registers `POST`/`PUT`/`DELETE` routes under `/api/entities` and `/api/relations` for programmatic and dashboard-driven edits. Both converge on the same underlying writer abstraction, `UKBDatabaseWriter`, ensuring that whether a change originates from a terminal or a UI, it is persisted consistently.

As the sibling of OnlineLearning (which drives `WorkflowOrchestrator.executeIncrementalWorkflow()` for automated incremental analysis) and VkbServer (the broader HTTP surface), ManualLearning represents the deliberate, curated counterpart to automated knowledge acquisition within the parent KnowledgeManagement component.

## Architecture and Design

![ManualLearning — Architecture](images/manual-learning-architecture.png)

The design centers on a dual-entry, single-writer pattern: two distinct interfaces — UKBDatabaseCLI and EntityMutationRoutes — both funnel through UKBDatabaseWriter, avoiding divergent write logic between CLI and HTTP paths. `cli.js`'s `initializeDatabase()` wires a full `DatabaseManager` stack (SQLite for analytics, optional Qdrant for vector search, and a `graphDbPath` for the graph store), meaning manual writes get the exact same storage backends as automated learning rather than a lightweight or divergent path.

A notable architectural decision is routing preference: `sendToVKB()`/`isVKBRunning()` in `cli.js` detect whether the VKB HTTP server is already running and prefer routing manual mutations through it, falling back to direct database writes only when the server is unavailable. This avoids write contention between a live server process and a concurrently-invoked CLI touching the same SQLite/graph files, while still allowing offline/scripted usage when no server is up.

Team-scoping is handled defensively: `ApiRoutes._getWriter(team)` lazily instantiates a `UKBDatabaseWriter` per team on demand rather than defaulting silently to `'coding'`, which prevents cross-team data leakage (e.g., edits intended for `rapid-automations` incorrectly landing in the coding team's scope).

## Implementation Details

UKBDatabaseCLI's `cli.js` documents its expected JSON input format via `showHelp()`, giving operators a canonical reference for the stdin payloads accepted by `add-entity`, `update-entity`, and `add-relation`. Internally, it imports `UKBDatabaseWriter` from `../../src/knowledge-management/UKBDatabaseWriter.js` and constructs it with `{ team, debug }` options, keeping the writer's construction parameters minimal and explicit.

On the HTTP side, EntityMutationRoutes' `registerRoutes()` wires `app.post('/api/entities')`, `app.put('/api/entities/:name')`, and `app.delete('/api/entities/:name')` to dedicated handlers (`handleCreateEntity`, `handleUpdateEntity`, `handleDeleteEntity`), mirroring the CLI's command set as REST verbs. This symmetry (CLI commands ↔ REST endpoints) keeps the two entry points conceptually aligned even though they're implemented separately.

Downstream, `data-processor.js`'s `exportOnlineKnowledge()` distinguishes provenance at export time: entities with `entity.metadata.source === 'auto'` are tagged `'online'`, while everything else — including manually authored entities — is tagged `'batch'`. This means the visualizer/export layer relies on this metadata convention to render manual contributions distinctly from automated ones.

## Integration Points

![ManualLearning — Relationship](images/manual-learning-relationship.png)

ManualLearning's children — UKBDatabaseCLI, UKBDatabaseWriter, and EntityMutationRoutes — form its complete implementation surface: the CLI and routes are the entry points, and UKBDatabaseWriter is the shared persistence mechanism both depend on. Both entry points integrate with the same `DatabaseManager` (SQLite + optional Qdrant + graph DB), tying ManualLearning directly into the storage stack shared with OnlineLearning's automated pipeline.

The CLI's optional routing through the running VKB server links ManualLearning operationally to VkbServer, since `sendToVKB()` requires detecting and communicating with that live HTTP process. Metadata produced by manual writes (implicitly non-`'auto'` `source` values) is consumed downstream by `data-processor.js`'s export/visualization logic, forming an integration contract between ManualLearning and the broader KnowledgeManagement reporting layer.

## Usage Guidelines

When authoring entities or relations manually, use the CLI's stdin JSON format as documented by `showHelp()`, or call the REST endpoints directly for programmatic/dashboard integrations — both are equivalent, sanctioned paths. Always ensure the correct `team` is supplied to `_getWriter(team)`; since there is no silent default, calls to team-scoped write paths must be explicit to avoid orphaned or misrouted data.

Prefer letting the CLI auto-detect and route through a running VKB server (`isVKBRunning()`) when one is active, rather than forcing direct DB writes, to reduce risk of concurrent-write conflicts. Since exported/visualized knowledge distinguishes `'auto'` vs. everything-else as `'batch'`, do not set `metadata.source = 'auto'` on manually created entities, as this would misclassify them as automated in downstream tooling.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component centers around a VKB (Virtual Knowledge Base) server that exposes graph-based storage operations to the rest of the Coding infrastructure. This server acts as the primary access point for entity CRUD operations, query resolution, and relationship traversal across the knowledge graph, decoupling consumers (agents, CLI tools, other components) from the underlying storage engine. This abstraction layer is critical because it has allowed the project to migrate storage backends (LevelDB to KMCore) without requiring downstream consumers to change their integration code, as evidenced by the dedicated migration test suite.

### Children
- [UKBDatabaseCLI](./UKBDatabaseCLI.md) -- showHelp() in cli.js documents the JSON input format expected on stdin for add-entity, update-entity and add-relation commands
- [UKBDatabaseWriter](./UKBDatabaseWriter.md) -- lib/ukb-database/cli.js imports UKBDatabaseWriter from '../../src/knowledge-management/UKBDatabaseWriter.js' and constructs it with { team, debug } options
- [EntityMutationRoutes](./EntityMutationRoutes.md) -- registerRoutes() wires app.post('/api/entities'), app.put('/api/entities/:name'), app.delete('/api/entities/:name') to handleCreateEntity, handleUpdateEntity, handleDeleteEntity

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- lib/ukb-unified/core/WorkflowOrchestrator.js executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' parameters from a gap scope (sinceCommit, commits, sessions) and calls mcp__semantic_analysis__execute_workflow to run automated extraction
- [VkbServer](./VkbServer.md) -- lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers


---

*Generated from 6 observations*
