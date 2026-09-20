# ViolationCaptureService

**Type:** SubComponent

[Architecture Notes] ViolationCaptureService is decoupled from the hook system's own session identity (CLAUDE_SESSION_ID/COPILOT_SESSION_ID) by minting its own session-${Date.now()}-${random} IDs, creating a correlation gap between violation records and live agent sessions; Dual-store persistence (append log + aggregate) trades write complexity for crash durability and dashboard read performance, with no evident reconciliation path if the two drift; Violation capture sits in the synchronous dispatch path of pre-tool/post-tool hooks, coupling monitoring-layer latency/failure to live tool execution unless isolated by the try/catch in triggerHook(); Redaction in sanitizeParams() is pattern-name-based, not structural, leaving it vulnerable to sensitive data under unrecognized field names — consistent with a project-wide redaction gap noted elsewhere

# ViolationCaptureService — Technical Insight Document

## What It Is

`ViolationCaptureService` is implemented in `scripts/violation-capture-service.js`, exposing exactly two top-level members per the code graph: the `ViolationCaptureService` class itself and a `getViolationCaptureService()` factory function. As a member of ConstraintSystem, it serves as the durability and dashboard-facing layer of the broader constraint monitoring architecture — the component responsible for capturing, sanitizing, and persisting violation events generated as agents interact with tools during a session. Where its sibling ContentValidationAgent focuses on detecting staleness in documentation/entity references, and UnifiedHookManager/HookConfigLoader manage hook lifecycle and configuration, ViolationCaptureService's job is narrower and more operational: turn live violation signals into durable, dashboard-consumable records.

![ViolationCaptureService — Architecture](images/violation-capture-service-architecture.png)

## Architecture and Design

The service follows a singleton/factory accessor pattern: `getViolationCaptureService()` returns a shared instance rather than requiring callers to construct `ViolationCaptureService` directly. This mirrors `getHookManager()` in `lib/agent-api/hooks/hook-manager.js`, suggesting a codebase-wide convention for stateful services accessed from multiple call sites (most plausibly the hook bridges — `claude-bridge.js` and an analogous Copilot bridge). Because state is process-wide rather than per-call, rolling statistics and the 1000-entry cap apply across all sessions handled by one process, not per invocation.

Persistence follows a dual-store design: an append-only `session-violations.jsonl` log and an aggregated `violation-history.json` stats file computed by `calculateStatistics()`. This is a deliberate durability-over-normalization trade-off — the JSONL log guarantees no write is lost mid-crash, while the aggregate is a derived, rebuildable view. The cost is synchronization burden: every violation-producing path must update both stores, and there is no evidence of a reconciliation function to resync the aggregate if it drifts from the log.

Statistics use two independently-bounding mechanisms layered on the same dataset: a 24-hour rolling window (for statistical relevance) and a 1000-entry cap (for memory/file-size protection). No code-graph evidence indicates which mechanism wins when they conflict — e.g., a violation burst exceeding 1000 within 24 hours would silently drop entries the time window would otherwise still consider current.

## Implementation Details

`sanitizeParams()` redacts tool-call parameters before persistence using a fixed denylist of keywords (`password`, `token`, `key`, `secret`, `auth`). This is a name-pattern match, not a structural/type-based one, meaning fields like `apiSecretValue` or `bearer`, or secrets nested in objects, could pass through unredacted into `session-violations.jsonl` — which then feeds the constraint-monitor dashboard. This echoes a known project-wide redaction gap already tracked elsewhere in memory regarding pattern-based redaction under- and over-matching.

`calculateStatistics()` derives `mostCommonViolation` via frequency-sorting on `constraint_id`, alongside severity breakdowns and per-session averages, all capped at 1000 entries.

Session identifiers are generated internally as `session-${Date.now()}-${random}` rather than reusing the hook system's own session context (`CLAUDE_SESSION_ID`/`COPILOT_SESSION_ID`, seen in `triggerHook()` in `lib/agent-api/hooks-api.js` and mirrored in `claude-bridge.js`'s `transformContext()`). This means ViolationCaptureService mints its own identity independent of live agent session tracking, requiring timestamp-proximity joins to correlate a violation back to a specific session — a correlation pattern that has caused bugs elsewhere in the project.

## Integration Points

![ViolationCaptureService — Relationship](images/violation-capture-service-relationship.png)

ViolationCaptureService sits in the hook dispatch path, invoked via `HookEvent.PRE_TOOL`/`POST_TOOL` through `UnifiedHookManager`/`HooksManager.triggerHook()` (`lib/agent-api/hooks-api.js`). Because `triggerHook()` wraps each handler in a per-hook try/catch that logs and continues, a slow or failing capture write won't block tool execution — but there's no evidence of alerting on persistence failures within the service itself, so repeated silent failures could go unnoticed. This places the service's I/O (two file writes plus `calculateStatistics()`) squarely in the critical path of every tool call across every registered agent, unless effectively isolated by that surrounding try/catch.

The service's outputs feed the constraint-monitor dashboard, tying it operationally to ConstraintSystem's broader goal of session-wide constraint visibility.

## Usage Guidelines

The parent-context description explicitly frames this layer as prioritizing "durability and dashboard consumability over strict schema enforcement" — consistent with `HookConfigLoader.validateConfig()`'s fail-open philosophy of warning rather than throwing. Developers should treat this as a monitoring/observability sidecar: losing a violation record is worse than recording a malformed one, but downstream dashboard code should not assume strict schema guarantees when reading `session-violations.jsonl` or `violation-history.json`.

Anyone extending `sanitizeParams()` should recognize its denylist limitations and consider structural/typed redaction rather than adding more keywords reactively. Anyone relying on session correlation should be aware that ViolationCaptureService's self-generated session IDs are not joinable with `CLAUDE_SESSION_ID`/`COPILOT_SESSION_ID` without a timestamp-based heuristic. Finally, because there's no reconciliation path between the JSONL log and the aggregate stats file, any tooling built on `violation-history.json` should treat it as a best-effort snapshot rather than an authoritative source, falling back to the append log when precision matters.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ViolationCaptureService (class) in violation-capture-service.js
- getViolationCaptureService (function) in violation-capture-service.js

**Other:**
- The code graph identifies exactly two top-level members of scripts/violation-capture-service.js: the `ViolationCaptureService` class and a `getViolationCaptureService` factory function. This factory-plus-class shape is the standard singleton-accessor pattern used elsewhere in this codebase (mirrored by `getHookManager()` in lib/agent-api/hooks/hook-manager.js referenced from claude-bridge.js), and it implies that callers — most plausibly the hook bridges (claude-bridge.js, and an analogous copilot bridge) — obtain one shared instance per process rather than constructing `ViolationCaptureService` directly, so violation state (rolling statistics, the 1000-entry cap) is process-wide rather than per-call.
- Per the parent observations, `ViolationCaptureService` writes to two physically separate persistence artifacts — an append-only `session-violations.jsonl` log and an aggregated `violation-history.json` stats file — rather than a single source of truth with derived views. This is a durability-over-normalization trade-off: the JSONL append log can never lose a write mid-crash (each line is a complete, independently-parseable record), while the aggregated JSON file is rebuilt/updated by `calculateStatistics()` and can be regenerated from the log if it becomes corrupted. The cost is a synchronization burden — every violation-producing code path must remember to update both stores, and there is no code-graph evidence of a reconciliation/repair function that would resync the aggregate from the append log if they drift.
- `sanitizeParams()` redacts tool-call parameters using a fixed keyword list (`password`, `token`, `key`, `secret`, `auth`) before anything is persisted to disk. This is a denylist/blocklist sanitization strategy rather than an allowlist — it only catches sensitive fields whose *names* match a known pattern, so a secret stored under an unrecognized key (e.g. `apiSecretValue`, `bearer`, or a nested object) would pass through unredacted into `session-violations.jsonl`, which is consumed by the constraint-monitor dashboard. This mirrors a known project-wide gap already captured in memory ([[redact observations]] / [[redaction false positive quality]]) where redaction regexes are pattern-based and have previously both under- and over-matched.
- `calculateStatistics()` computes rolling 24-hour violation windows and derives `mostCommonViolation` via frequency-sorting on `constraint_id`, capped at 1000 entries overall. The 1000-entry cap combined with a 24-hour rolling window suggests two independent bounding mechanisms are layered on the same dataset — a count-based cap (protecting memory/file size) and a time-based cutoff (protecting statistical relevance) — but there is no code-graph evidence of which one is authoritative when they disagree (e.g., a burst of >1000 violations within 24 hours would silently drop older entries from the count cap before the time window would have expired them naturally).
- Session identifiers are generated as `session-${Date.now()}-${random}`, a timestamp-plus-random-suffix scheme rather than a UUID or a session ID sourced from the calling agent's own session context (e.g. `CLAUDE_SESSION_ID` / `COPILOT_SESSION_ID`, both referenced in lib/agent-api/hooks-api.js's `triggerHook()`). This means `ViolationCaptureService` mints its own identity independent of the hook system's session tracking, so correlating a captured violation back to a specific live Claude Code or Copilot session (as done elsewhere via `sessionId: context.sessionId || process.env.CLAUDE_SESSION_ID`) requires an explicit join on timestamp proximity rather than a shared key — a pattern that has caused correlation bugs elsewhere in this project (see [[etm dedup cursor identity]], [[context explainer illustrative identity mismatch]]).


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides constraint monitoring and enforcement across Claude Code sessions through a layered hook architecture. At its core is a unified hook management system (lib/agent-api/hooks/) that loads configuration from user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) sources, merges them with project config taking precedence, and dispatches lifecycle events (startup, shutdown, pre-tool, post-tool, pre-prompt, post-prompt, error) to registered handlers sorted by priority.

Violation capture and persistence is handled by a dedicated service (scripts/violation-capture-service.js) that bridges live session logging with the constraint monitor dashboard, sanitizing sensitive parameters, writing to a JSONL violation log, and maintaining rolling statistics (severity breakdowns, most common violations, per-session averages) capped at 1000 entries. Content validation, a related enforcement concern, is implemented via ContentValidationAgent which parses entity observations/diagrams for file, command, and API references, checks them against the live codebase, and produces staleness/validation reports with git-based correlation via GitStalenessDetector.

The architecture emphasizes agent-agnostic extensibility: hook handlers can be scripts, commands, or modules, scoped to specific agents, and dynamically registered/unregistered at runtime. Configuration validation is lenient (warnings rather than hard failures) to avoid blocking agent execution, while the violation capture layer prioritizes durability and dashboard consumability over strict schema enforcement.

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [ContentValidationAgent](./ContentValidationAgent.md) -- [LLM] ContentValidationAgent (integrations/semantic-analysis/src/agents/content-validation-agent.ts) is described as using regex-based filePathPatterns and commandPatterns to extract file/command references from entity observations, then cross-checking them against GitStalenessDetector and CommitEntityCorrelation for staleness scoring. This is a text-mining-over-structured-metadata design: rather than requiring entities to declare typed, machine-readable pointers to the code they describe, the agent infers those pointers by pattern-matching free-text observation strings. The trade-off is clear — authoring an observation stays as simple as writing a sentence, but the accuracy of staleness detection is bounded by how well the regexes generalize across phrasing (e.g. backticked paths, inline code spans, shell snippets with flags). Any observation that references a file or command in a way the patterns don't anticipate silently escapes validation, producing false negatives rather than errors — consistent with the broader constraint-system philosophy noted in the parent context of favoring non-blocking degradation over hard failures.
- [HealthPromptHook](./HealthPromptHook.md) -- checkHealthStatus() fetches from HEALTH_COORDINATOR_URL (default http://localhost:3034)/health/state and never falls back to 'healthy' on error, per SPEC R6 — exceptions and non-OK responses surface as overallStatus: 'unknown'
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- isInjectionEnabled() in knowledge-injection-hook.js reads CODING_KNOWLEDGE_INJECTION from process.env, defaulting to enabled unless explicitly '0'/'false'/'off', scoped per-process for experiment-cell avenue toggling


---

*Generated from 12 observations*
