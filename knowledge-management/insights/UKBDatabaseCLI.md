# UKBDatabaseCLI

**Type:** Detail

[Code References] lib/ukb-database/cli.js:15-16 - imports DatabaseManager and UKBDatabaseWriter for direct DB writes; lib/ukb-database/cli.js:33-40 - isVKBRunning() liveness probe with 1000ms timeout; lib/ukb-database/cli.js:44-59 - sendToVKB() unguarded response.json() error parsing; lib/ukb-database/cli.js:64-101 - initializeDatabase() composite SQLite+Qdrant+graph DB setup and singleton caching; lib/ukb-database/cli.js:97-100 - process.exit(1) on database init failure; lib/ukb-database/cli.js:170-186 - displayStatus() reads databaseManager.getHealth() per-subsystem; lib/ukb-database/cli.js:190-260 - addEntityFromStdin/addRelationFromStdin/updateEntityFromStdin stdin handlers; lib/ukb-unified/cli.js:14-19 - imports TeamCheckpointManager, GapAnalyzer, ConfigManager, WorkflowOrchestrator; lib/ukb-unified/cli.js:150-260 - defaultCommand() checkpoint/gap-analysis state machine; lib/ukb-unified/core/VkbApiClient.js:18-31 - isServerAvailable() 2000ms timeout, ignores graph health field; lib/ukb-unified/core/VkbApiClient.js:105-119 - updateEntity() PUT counterpart to cli.js's local update path

# UKBDatabaseCLI — Technical Insight Document

## What It Is

UKBDatabaseCLI is implemented in `lib/ukb-database/cli.js` and provides the low-level, direct-write entry point into the knowledge graph substrate shared across ManualLearning. Unlike its sibling `UKBUnifiedCLI` (lib/ukb-unified/cli.js), which orchestrates incremental workflows through `TeamCheckpointManager` and `GapAnalyzer`, UKBDatabaseCLI writes straight to storage via `DatabaseManager` and `UKBDatabaseWriter` (imported at cli.js:15-16). It exposes three stdin-driven commands — `addEntityFromStdin`, `addRelationFromStdin`, and `updateEntityFromStdin` (cli.js:190-260) — plus a status/health command (`displayStatus`, cli.js:170-186). As the parent ManualLearning summary notes, this is one of at least three code paths (direct DB, HTTP via `VkbApiClient`, and orchestrated workflow) capable of mutating the same entities/relations, with nothing enforcing mutual exclusion.

## Architecture and Design

The core initialization pattern is a composite health dependency: `initializeDatabase()` (cli.js:64-101) constructs a single `DatabaseManager` wired simultaneously to SQLite (via `SQLITE_PATH` or a `.data/knowledge.db` default), Qdrant (env-configured host/port, toggled by `QDRANT_ENABLED`), and a graph DB path, then awaits one `initialize()` call before instantiating `UKBDatabaseWriter`. This writer is cached as a module-level lazy singleton (`if (writer) return writer;`), so every command within a process shares one connection set — an instance of the "lazy singleton initialization" pattern also noted architecturally for this component.

A second key pattern is liveness-probe-gated write path selection: `isVKBRunning()` (cli.js:33-40) checks a running VKB server before deciding between local and HTTP write paths. Critically, this gating is applied asymmetrically — only `updateEntityFromStdin` consults `isVKBRunning()`; `addEntityFromStdin` and `addRelationFromStdin` unconditionally write to the local DB, bypassing any live server. This is a deliberate but incomplete split-brain avoidance design: the author protected updates but not creates.

The CLI also diverges from its sibling in failure semantics — it calls `process.exit(1)` directly in async error paths (e.g., cli.js:97-100, and validation inside `addEntityFromStdin`), whereas `UKBUnifiedCLI`'s `defaultCommand()` writes to stderr and returns normally. This gives UKBDatabaseCLI simple, scriptable exit-code semantics at the cost of abrupt process termination.

## Implementation Details

`initializeDatabase()` is the linchpin: it performs three-way composite setup (SQLite + Qdrant + graph DB) in one call and swallows per-subsystem failure until later inspected via `displayStatus()`'s `databaseManager.getHealth()`/`writer.getStatistics()` calls (cli.js:170-186) — meaning write commands have no pre-flight health gate, only the status command surfaces partial failures.

`sendToVKB()` (cli.js:44-59) handles the HTTP path when a server is live, but assumes every non-ok response body is parseable JSON with a `.message` field, with no try/catch around `response.json()`. A non-JSON error body (HTML 502, plaintext crash dump) will throw an unrelated JSON-parse error masking the real cause — a fragility mirrored identically across every method in `VkbApiClient.js` (getEntities, deleteEntity, createEntity, etc.), making this a systemic rather than local issue.

`isVKBRunning()` (1000ms timeout) duplicates `VkbApiClient.isServerAvailable()` (2000ms timeout, VkbApiClient.js:18-31) — both probe `/api/health` via GET with an AbortSignal timeout and reduce to a boolean on `response.ok` alone, discarding the JSON health payload (e.g., ignoring a `graph` health field). The two timeout values already show independently, uncoordinated tuning.

## Integration Points

UKBDatabaseCLI sits alongside `UKBUnifiedCLI`, `WorkflowOrchestrator`, and `VkbApiClient` as sibling automation surfaces under ManualLearning. It does not import or share code with `VkbApiClient.js` despite implementing a near-identical liveness check, and it has no dependency on `TeamCheckpointManager`/`GapAnalyzer`/`WorkflowOrchestrator`'s checkpoint-driven incremental model — the two CLIs are architecturally parallel, not layered. `updateEntityFromStdin`'s optional HTTP path effectively becomes a peer of `VkbApiClient.updateEntity()` (VkbApiClient.js:105-119), the PUT counterpart for the same operation via HTTP rather than local write.

## Usage Guidelines

Developers should not assume `add-entity`/`add-relation` commands respect a live VKB server — only updates are split-brain protected; concurrent server-based edits can be silently bypassed by direct-write creates. Callers scripting against this CLI can rely on non-zero exit codes for failure detection (unlike `UKBUnifiedCLI`'s `defaultCommand`), but should be aware that `sendToVKB()` failures on non-JSON error bodies may report misleading messages. Any future change to "server available" semantics (e.g., inspecting the `graph` field) must be made in both `isVKBRunning()` and `VkbApiClient.isServerAvailable()` to avoid divergence. Because `initializeDatabase()` doesn't gate writes on subsystem health, operators should proactively run the status command to check `databaseManager.getHealth()` before trusting writes succeeded across all backing stores.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- [LLM] The 'ManualLearning' component, as represented by the supplied files, is not a single cohesive module but a set of parallel entry points into the same knowledge-graph substrate: `lib/ukb-database/cli.js` writes via `DatabaseManager`/`UKBDatabaseWriter` directly to SQLite + Qdrant, `lib/ukb-unified/cli.js` orchestrates a higher-level incremental workflow via `WorkflowOrchestrator`/`TeamCheckpointManager`/`GapAnalyzer`, and `lib/ukb-unified/core/VkbApiClient.js` talks to the same data over HTTP against a running VKB server (`http://localhost:8080`). This means there are at least three distinct code paths capable of mutating the same knowledge entities/relations — direct DB writes, HTTP API writes, and an orchestrated incremental pipeline — and nothing in the shown code enforces that they can't race or diverge.

### Siblings
- [UKBUnifiedCLI](./UKBUnifiedCLI.md) -- [LLM] The 'UKBUnifiedCLI' component (lib/ukb-unified/cli.js) is a thin orchestration layer around four core managers instantiated in the UKBCli constructor: TeamCheckpointManager, GapAnalyzer, ConfigManager, and a lazily-initialized WorkflowOrchestrator (cli.js:36-42). The lazy init pattern for `this.orchestrator = null` deviates from the other three managers, which are constructed eagerly in the constructor — this is because WorkflowOrchestrator requires config loaded via `this.configManager.loadConfig()` (cli.js:229), an async call that can't happen in a synchronous constructor. This asymmetry means any code path that touches `this.orchestrator` before `defaultCommand()` or an equivalent init sequence runs will find it null, a subtle constructor-ordering trap for future maintainers adding new commands.
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- [CGR] WorkflowOrchestrator (class) in WorkflowOrchestrator.js
- [VkbApiClient](./VkbApiClient.md) -- [CGR] VkbApiClient (class) in VkbApiClient.js


---

*Generated from 9 observations*
