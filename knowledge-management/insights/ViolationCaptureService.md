# ViolationCaptureService

**Type:** SubComponent

Session tracking within violation-history.json implies the service keys records by session ID, consistent with the sessionId field pattern seen in hook contexts (e.g., claude-bridge.js's transformContext sessionId derivation).

# ViolationCaptureService: Technical Insight Document

## What It Is

ViolationCaptureService is implemented in `scripts/violation-capture-service.js`, centered on the `ViolationCaptureService` class and its accompanying factory function `getViolationCaptureService`. As a subcomponent of the broader ConstraintSystem, its responsibility is narrow and well-defined: capture violation detection results generated elsewhere in the constraint pipeline and persist them durably for later analysis. It writes two distinct artifacts — an append-only raw log at `.mcp-sync/session-violations.jsonl` and a computed aggregate at `violation-history.json` — establishing a clear separation between raw event capture and derived analytics.

![ViolationCaptureService — Architecture](images/violation-capture-service-architecture.png)

## Architecture and Design

The core architectural pattern here is the separation of raw log and aggregate view. Rather than requiring downstream dashboard consumers to replay or recompute statistics from the JSONL stream, ViolationCaptureService performs aggregation logic itself — computing severity breakdowns, most-common-constraint, and average-violations-per-session before writing to `violation-history.json`. This is a deliberate design decision to push computational cost to write-time rather than read-time, trading slightly higher per-violation write latency for cheap, ready-to-consume dashboard reads.

A second notable decision is the bounded-growth policy: the aggregate file is explicitly capped at 1000 entries. This reflects an awareness that unbounded aggregate growth would degrade both file I/O performance and consumer parsing time, at the cost of eventually discarding older historical data — an intentional trade-off favoring operational stability over complete historical retention.

Within the parent ConstraintSystem, this service occupies the "capture and persistence" tier, distinct from orchestration (HookManager) and configuration (HookConfigLoader). It complements those siblings by acting purely on results, not on the detection or dispatch logic itself.

## Implementation Details

The `ViolationCaptureService` class encapsulates all persistence logic — the JSONL append operation, the aggregate computation, and the redaction step. Sensitive parameter values are redacted before being written to logs, implying a preprocessing pass over tool/hook context data that strips or masks sensitive fields prior to any disk write. This redaction must occur upstream of both the raw JSONL append and the aggregate computation, since either artifact could otherwise leak sensitive data.

Session tracking is a key organizing principle: records in `violation-history.json` appear to be keyed or grouped by session ID, consistent with the `sessionId` field pattern seen elsewhere in the system (e.g., `claude-bridge.js`'s `transformContext` sessionId derivation). This shared identifier convention allows violation data to be correlated with the same session semantics used across the hook infrastructure.

The `getViolationCaptureService` function suggests a singleton-style accessor pattern, providing a shared instance of the service rather than requiring callers to construct and manage their own instance — likely to ensure consistent, non-conflicting writes to the shared log and aggregate files.

![ViolationCaptureService — Relationship](images/violation-capture-service-relationship.png)

## Integration Points

ViolationCaptureService sits downstream of violation detection within ConstraintSystem, consuming detection results rather than performing detection itself. Its session-keyed data model implicitly depends on the sessionId conventions established in hook context transformation logic (as seen in `claude-bridge.js`). While it doesn't directly interact with `UnifiedHookManager` (`lib/agent-api/hooks/hook-manager.js`) or `HookConfigLoader` (`lib/agent-api/hooks/hook-config.js`), it shares the same parent ConstraintSystem and the same overall hook-driven session lifecycle that those siblings orchestrate. The output files it produces — `.mcp-sync/session-violations.jsonl` and `violation-history.json` — serve as the integration surface for external dashboard consumers, which rely on the pre-computed statistics rather than needing to implement their own aggregation.

## Usage Guidelines

Consumers of violation data should read from `violation-history.json` for aggregate statistics rather than reprocessing the raw JSONL log, since aggregation logic (severity breakdowns, most-common-constraint, averages) is already handled internally. Developers extending this service should preserve the redaction step as a mandatory precondition to any new write path, to avoid accidentally persisting sensitive parameter values. Any change to the 1000-entry cap should be considered carefully, as it directly affects historical completeness versus file size and read performance. Finally, new capture logic should continue to key records by session ID to remain consistent with the sessionId conventions used across the ConstraintSystem's hook infrastructure.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ViolationCaptureService (class) in violation-capture-service.js
- getViolationCaptureService (function) in violation-capture-service.js


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement of code actions and file operations during Claude Code sessions, spanning hook configuration loading, hook dispatch orchestration, and violation capture/persistence. It is built around a unified hook architecture that merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configurations, with project config taking precedence, and dispatches events (pre-tool, post-tool, pre-prompt, post-prompt, startup, shutdown, error) to registered handlers of type script, command, or module.

Core orchestration lives in UnifiedHookManager (lib/agent-api/hooks/hook-manager.js), which maintains a Map of event names to sorted handler arrays (by priority), supports duplicate-ID overwrite semantics, and exposes registerHandler/unregisterHandler APIs bridging agent-native hook systems to a common HookEvent enum. Configuration parsing and structural validation is handled separately by HookConfigLoader (lib/agent-api/hooks/hook-config.js), which loads, merges, and validates settings/hooks blocks, logging warnings (not throwing) on malformed entries.

Violation detection results are captured and persisted via ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL violation records to .mcp-sync/session-violations.jsonl and maintains an aggregated violation-history.json with session tracking and computed statistics (severity breakdowns, most common constraint, average violations per session) for dashboard consumption. Sensitive parameter values are redacted before being written to logs, and history is capped at 1000 entries to bound file growth.

### Siblings
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.
- [HookConfigLoader](./HookConfigLoader.md) -- loadConfig() in hook-manager.js applies config.settings.enableLogging, stopOnError, and timeout only when explicitly defined in the file (`!== undefined` checks), preserving constructor defaults otherwise.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js's isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and treats only '0'/'false'/'off' (case-insensitive) as disabling, defaulting to enabled for unset values.
- [HealthPromptHook](./HealthPromptHook.md) -- checkHealthStatus() uses existsSync(VERIFIER_SCRIPT) as a heuristic to detect 'outside the coding repo' and returns servicesAvailable:false rather than attempting a network call in that case (Q3 carve-out).


---

*Generated from 7 observations*
