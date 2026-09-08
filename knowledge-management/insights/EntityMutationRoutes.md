# EntityMutationRoutes

**Type:** Detail

These handlers use this._getWriter(team) to obtain the correct per-team UKBDatabaseWriter instance before mutating, mirroring the manual-entry semantics of the CLI's add-entity/add-relation commands

# EntityMutationRoutes: Technical Insight Document

## What It Is

EntityMutationRoutes is the HTTP routing layer responsible for exposing entity and relation mutation operations as REST endpoints. Its implementation centers on a `registerRoutes()` function that wires Express-style routes—`app.post('/api/entities')`, `app.put('/api/entities/:name')`, `app.delete('/api/entities/:name')`—to corresponding handlers: `handleCreateEntity`, `handleUpdateEntity`, and `handleDeleteEntity`. A parallel set of routes, `app.post('/api/relations')` and `app.delete('/api/relations')`, handles relation-level mutations. Together, these routes form the HTTP-facing counterpart to manual knowledge-base authoring, sitting alongside the CLI-based entry point defined in its parent component, ManualLearning.

## Architecture and Design

The architecture reflects a thin-controller pattern: routing logic is deliberately decoupled from the underlying persistence mechanics. Route handlers do not directly manipulate data; instead, they call `this._getWriter(team)` to resolve a per-team `UKBDatabaseWriter` instance before performing any mutation. This indicates a multi-tenant design where each team's knowledge base is isolated behind its own writer instance, and the routing layer's job is purely to authenticate the correct context and delegate.

Notably, this design explicitly mirrors the semantics of the CLI's `add-entity` and `add-relation` commands (implemented in `lib/ukb-database/cli.js`), meaning EntityMutationRoutes is essentially an HTTP-accessible restatement of the same manual-authoring capabilities already available via UKBDatabaseCLI. This dual-interface approach (CLI + HTTP routes) suggests a conscious decision to provide the same manual-entry semantics through multiple access channels while funneling both through the same underlying writer abstraction, avoiding logic duplication at the persistence layer.

## Implementation Details

The core mechanic is `registerRoutes()`, which performs declarative route-to-handler binding for both entities and relations. Entity mutations support the full CRUD triad relevant to authoring: create (POST), update (PUT, parameterized by `:name`), and delete (DELETE, parameterized by `:name`). Relation mutations are simpler, supporting only create and delete—there is no observed update route for relations, implying relations are treated as atomic, replaceable facts rather than mutable records.

Each handler's dependency on `this._getWriter(team)` is the critical implementation seam: this method resolves a `UKBDatabaseWriter` instance scoped to the requesting team before any mutation proceeds. This is structurally identical to how `lib/ukb-database/cli.js` constructs `UKBDatabaseWriter` with `{ team, debug }` options, reinforcing that the writer abstraction—not the routing or CLI layer—is the authoritative gatekeeper for mutation logic.

## Integration Points

EntityMutationRoutes integrates most directly with `UKBDatabaseWriter` (imported in the CLI from `../../src/knowledge-management/UKBDatabaseWriter.js`), which serves as the shared persistence interface for both the CLI and HTTP paths. It is a sibling to UKBDatabaseCLI and UKBDatabaseWriter under the parent ManualLearning component, and its design intentionally parallels UKBDatabaseCLI's `add-entity`, `update-entity`, and `add-relation` commands—meaning any change to the expected JSON input format documented in `showHelp()` likely has implications for both interfaces. Since ManualLearning is explicitly described as distinct from the batch pipeline, EntityMutationRoutes should be understood as part of the manual, human/agent-driven authoring surface rather than automated ingestion.

## Usage Guidelines

Developers extending or consuming EntityMutationRoutes should treat the per-team `_getWriter(team)` resolution as mandatory and non-bypassable—mutations should never touch a writer instance without going through this resolution step, since it enforces team isolation. Because relation mutations lack an update route, changing a relation requires delete-then-create semantics rather than in-place modification. When modifying route behavior, maintain parity with the CLI's `add-entity`/`update-entity`/`add-relation` semantics, since both are documented as mirroring each other's manual-entry intent; divergence between the two interfaces would create inconsistent authoring behavior across access channels.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- lib/ukb-database/cli.js exposes add-entity, update-entity, add-relation, import, and export commands that read JSON from stdin and pass it through UKBDatabaseWriter, a manual-authoring entry point distinct from the batch pipeline

### Siblings
- [UKBDatabaseCLI](./UKBDatabaseCLI.md) -- showHelp() in cli.js documents the JSON input format expected on stdin for add-entity, update-entity and add-relation commands
- [UKBDatabaseWriter](./UKBDatabaseWriter.md) -- lib/ukb-database/cli.js imports UKBDatabaseWriter from '../../src/knowledge-management/UKBDatabaseWriter.js' and constructs it with { team, debug } options


---

*Generated from 3 observations*
