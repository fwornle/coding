# UKBDatabaseWriter

**Type:** Detail

lib/vkb-server/api-routes.js's ApiRoutes constructor creates one UKBDatabaseWriter per team ('coding','ui','resi') stored in this.writers, and _getWriter() lazily creates writers for unrecognized teams

# UKBDatabaseWriter: Technical Insight Document

## What It Is

`UKBDatabaseWriter` is implemented at `src/knowledge-management/UKBDatabaseWriter.js` and serves as the shared persistence layer for knowledge-base mutations across two distinct entry points in the system: a command-line interface and an HTTP API. It is the direct child component of the **ManualLearning** subsystem, representing the manual-authoring path for entity and relation data as opposed to any automated batch ingestion mechanism. The class is instantiated in two places with different configuration shapes: `lib/ukb-database/cli.js` constructs it with `{ team, debug }` options, while `lib/vkb-server/api-routes.js` constructs one instance per known team.

## Architecture and Design

The architecture centers on **team-scoped writer instances** — rather than a single global writer, both consumers instantiate `UKBDatabaseWriter` per team context, implying that the underlying persistence (likely per-team knowledge stores or namespaces) is partitioned by team identity. In the HTTP server, `ApiRoutes`'s constructor eagerly creates writers for the three known teams (`'coding'`, `'ui'`, `'resi'`), storing them in `this.writers`, while a `_getWriter()` method provides lazy instantiation as a fallback for unrecognized teams. This is a **cache-with-fallback pattern**: known cases are pre-provisioned for performance/predictability, while an escape hatch handles dynamic/unexpected team names without requiring code changes.

A key architectural distinction called out explicitly is that `UKBDatabaseWriter` is the common persistence path for **manual, synchronous mutation flows** (CLI authoring and HTTP entity/relation routes) and is **distinct from the batch WorkflowOrchestrator pipeline**. This separation suggests a deliberate design boundary between human-driven, low-volume, immediate-consistency operations and automated, high-volume, pipeline-driven operations — each with its own write path, even though they presumably converge on the same underlying data store.

## Implementation Details

On the CLI side, `lib/ukb-database/cli.js` (the **UKBDatabaseCLI** sibling) exposes `add-entity`, `update-entity`, `add-relation`, `import`, and `export` commands. These commands read JSON from stdin and pass it directly through to `UKBDatabaseWriter`, making the writer the sole mutation gateway for manual authoring. The CLI's `showHelp()` function documents the expected JSON input schema for these commands, serving as the de facto contract for what `UKBDatabaseWriter`'s write methods expect as input.

On the HTTP side, the **EntityMutationRoutes** sibling's `registerRoutes()` wires REST endpoints — `app.post('/api/entities')`, `app.put('/api/entities/:name')`, and `app.delete('/api/entities/:name')` — to handler functions (`handleCreateEntity`, `handleUpdateEntity`, `handleDeleteEntity`). These handlers presumably delegate to the team-specific `UKBDatabaseWriter` instance obtained via `this.writers` or `_getWriter()`, translating HTTP request bodies into the same underlying write operations the CLI uses.

## Integration Points

`UKBDatabaseWriter` integrates with exactly two consumers per the observations: `lib/ukb-database/cli.js` and `lib/vkb-server/api-routes.js`. Both import it from `src/knowledge-management/UKBDatabaseWriter.js`, establishing this module as a shared library dependency rather than a duplicated implementation. Within the HTTP server, it integrates indirectly with **EntityMutationRoutes** via the `ApiRoutes` constructor's writer map and `_getWriter()` lookup. Within the CLI context, it integrates with **UKBDatabaseCLI**'s command dispatch and stdin-JSON parsing convention. Notably, it is explicitly decoupled from the **WorkflowOrchestrator** batch pipeline, indicating that automated ingestion does not flow through this class — a boundary future work should preserve unless a deliberate refactor unifies both write paths.

## Usage Guidelines

Developers extending either the CLI or the API routes should instantiate `UKBDatabaseWriter` with a `team` parameter to ensure writes are correctly scoped/partitioned — omitting or misconfiguring this could cause cross-team data contamination given the per-team instance model. When adding support for new teams in `api-routes.js`, rely on the `_getWriter()` lazy-creation fallback rather than hardcoding new entries into the constructor's eager `this.writers` map, unless the team is expected to be a permanent, high-traffic addition. For CLI usage, ensure JSON payloads conform to the schema documented in `showHelp()` before piping to `add-entity`, `update-entity`, or `add-relation`. Finally, do not attempt to reuse `UKBDatabaseWriter` as a substitute for the WorkflowOrchestrator batch pipeline — the two are architecturally separate and likely have different transactional/performance guarantees.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- lib/ukb-database/cli.js exposes add-entity, update-entity, add-relation, import, and export commands that read JSON from stdin and pass it through UKBDatabaseWriter, a manual-authoring entry point distinct from the batch pipeline

### Siblings
- [UKBDatabaseCLI](./UKBDatabaseCLI.md) -- showHelp() in cli.js documents the JSON input format expected on stdin for add-entity, update-entity and add-relation commands
- [EntityMutationRoutes](./EntityMutationRoutes.md) -- registerRoutes() wires app.post('/api/entities'), app.put('/api/entities/:name'), app.delete('/api/entities/:name') to handleCreateEntity, handleUpdateEntity, handleDeleteEntity


---

*Generated from 3 observations*
